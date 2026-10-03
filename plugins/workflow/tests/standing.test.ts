// The standing pane against the engine: the project-standing engine's run is faked beneath
// the plugin (process.run answers its --json), and the pane is mounted on every surface that
// places panes. What is asserted is the pane's contract: opened only by /standing, grouped by
// the engine's states, Resume queues a prompt built from validated names only, and nothing is
// drawn or opened when the engine has nothing to say.
import type { On, RenderPropsOf } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BRAND, brandLine, brandTitle } from '../hooks/_brand.tsx'
import { CLOSED_TOAST, REOPEN_HINT, age, concludedLine, dateOf, groups, headline, parseStanding, resumePrompt } from '../hooks/standing.tsx'
import type { Standing, StandingPackage } from '../types/index.d.ts'

const PLUGIN = 'bespunky-workflow'
const NOW = 1_800_000_000
const DAY = 86_400
const SURFACES = ['terminal', 'desktop'] as const

const PROPS: RenderPropsOf['Pane'] = {
  title: 'Standing',
  isFocused: true,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

const RAN_OK = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

const pkg = (over: Partial<StandingPackage> & Pick<StandingPackage, 'dir' | 'state'>): StandingPackage => ({
  date: over.dir.slice(0, 10),
  slug: over.dir.slice(11),
  status: over.state === 'concluded' ? 'concluded' : 'in-flight',
  lastActivity: NOW - DAY,
  hasWorktree: false,
  about: null,
  ...over,
})

const STANDING: Standing = {
  version: 1,
  staleDays: 14,
  now: NOW,
  repo: { lastCommit: NOW - DAY, commitAgeDays: 1, hasFeatures: true, hasRecentDoc: true },
  packages: [
    pkg({
      dir: '2026-01-01-old-live',
      state: 'live',
      lastActivity: NOW - 3 * DAY,
      baton: 'handoffs/2026-01-02T1200Z.md',
      about: 'Make the old thing live again.',
    }),
    pkg({ dir: '2026-02-01-new-live', state: 'live', hasWorktree: true }),
    pkg({ dir: '2025-06-01-asleep', state: 'dormant', lastActivity: NOW - 90 * DAY, baton: 'handoffs/b.md' }),
    pkg({
      dir: '2025-01-01-shipped',
      state: 'concluded',
      summary: 'Shipped the thing; ruled out the other.',
      about: 'Shipped the thing; ruled out the other.',
      closedAt: NOW - 2 * DAY,
    }),
    pkg({ dir: '2025-02-01-dropped', state: 'concluded', status: 'abandoned', closedAt: NOW - 10 * DAY }),
  ],
}

/** The engine as the pane sees it, every command it ran, and every prompt queued. */
function world(on: On, standing: Standing | 'crash' = STANDING) {
  const ran: string[][] = []
  const prompts: string[] = []
  const opened: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/work' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', () => ({ value: undefined }))
  on('process.run', ($, e) => {
    // The plugin's other mods run their own engines; only the standing engine is this world's.
    if (!e.argv.some(arg => arg.endsWith('/standing.mjs'))) return { value: { ...RAN_OK, exitCode: 1 } }
    ran.push([...e.argv])

    return {
      value: standing === 'crash' ? { ...RAN_OK, exitCode: 1, stderr: 'boom' } : { ...RAN_OK, stdout: JSON.stringify(standing) },
    }
  })
  on('prompt.submit', ($, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })
  on('ui.open', ($, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true as const } }
  })
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  const closes: unknown[] = []
  on('ui.close', ($, e) => {
    closes.push(e)

    return { value: undefined }
  })

  return { ran, prompts, opened, toasts, closes }
}

async function started($: Engine) {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
}

const mount = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'standing', props: PROPS })

describe('standing pane', () => {
  test('a session start opens nothing and runs nothing', async ($, on) => {
    const w = world(on)
    await started($)
    expect(w.opened).toEqual([])
    expect(w.ran).toEqual([])
  })

  test('/standing runs the engine, opens the pane and says the counts', async ($, on) => {
    const w = world(on)
    await started($)
    const out = await $.command.run({ command: 'standing' })
    expect(out.text).toBe('Standing: 2 live, 1 dormant, 2 concluded.')
    expect(w.opened).toEqual(['standing'])
    expect(w.ran).toHaveLength(1)
    expect(w.ran[0]?.[0]).toBe('node')
    expect(w.ran[0]?.[1]).toEndWith('/skills/project-standing/scripts/standing.mjs')
    expect(w.ran[0]?.[2]).toBe('--json')
  })

  test('the pane groups packages, newest first, with batons and Resume buttons', async ($, on) => {
    world(on)
    await started($)
    await $.command.run({ command: 'standing' })
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
      expect(texts[0]).toBe(brandTitle('standing'))
      expect(texts).toContain('3 in flight')
      expect(texts).toContain('Live (2)')
      expect(texts).toContain('Dormant (1)')
      expect(texts.join('\n')).toContain('handoffs/2026-01-02T1200Z.md')
      expect(texts).toContain('2 concluded · latest: shipped (2d ago)')
      expect(texts.join('\n')).not.toContain('Shipped the thing')
      expect(texts.join('\n')).not.toContain('dropped')
      expect(await ui.find({ key: 'standing-concluded-toggle' })).toMatchObject({ props: { label: 'Show concluded', hotkey: 'c' } })
      expect(await ui.find({ key: 'standing-resume-2026-02-01-new-live' })).toMatchObject({ props: { hotkey: '1' } })
      expect(await ui.find({ key: 'standing-resume-2026-01-01-old-live' })).toMatchObject({ props: { hotkey: '2' } })
      expect(await ui.find({ key: 'standing-resume-2025-06-01-asleep' })).toMatchObject({ props: { hotkey: '3' } })
      expect(await ui.find({ key: 'standing-resume-2025-01-01-shipped' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('every row says what it is about, under its slug; a row with nothing to say shows nothing extra', async ($, on) => {
    const w = world(on)
    await started($)
    await $.command.run({ command: 'standing' })
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
      const row = texts.indexOf('old-live')
      const about = texts.indexOf('Make the old thing live again.')
      expect(row).toBeGreaterThanOrEqual(0)
      expect(about).toBeGreaterThan(row)
      expect(await ui.find({ key: 'standing-about-2026-01-01-old-live' })).toBeDefined()
      expect(await ui.find({ key: 'standing-about-2026-02-01-new-live' })).toBeUndefined()
      expect(await ui.find({ key: 'standing-about-2025-06-01-asleep' })).toBeUndefined()
      expect(texts.join('\n')).not.toContain('Shipped the thing')
      await ui.press({ key: 'standing-concluded-toggle' })
      const expanded = (await ui.findAll({ type: 'Text' })).map(t => t.text)
      const shipped = expanded.findIndex(t => t.startsWith('shipped '))
      expect(shipped).toBeGreaterThanOrEqual(0)
      expect(expanded[shipped + 1]).toBe('Shipped the thing; ruled out the other.')
      expect(await ui.find({ key: 'standing-about-2025-02-01-dropped' })).toBeUndefined()
      await ui.press({ key: 'standing-concluded-toggle' })
      await ui.unmount()
    }
    // The about line is drawn, never sent: Resume's prompt carries validated names only.
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'standing-resume-2026-01-01-old-live' })
    expect(w.prompts.join('\n')).not.toContain('Make the old thing')
  })

  test('Resume queues a prompt naming the newest baton, and does nothing else', async ($, on) => {
    const w = world(on)
    await started($)
    await $.command.run({ command: 'standing' })
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'standing-resume-2026-01-01-old-live' })
    expect(w.prompts).toEqual([
      'Resume old-live: read its newest handoff, docs/features/2026-01-01-old-live/handoffs/2026-01-02T1200Z.md, and pick up from there (bespunky-workflow:session-handoff).',
    ])
    expect(w.ran).toHaveLength(1)
  })

  test('nothing in flight: the pane says so, and draws no empty sections', async ($, on) => {
    const finished = STANDING.packages.filter(p => p.state === 'concluded')
    world(on, { ...STANDING, packages: finished })
    await started($)
    await $.command.run({ command: 'standing' })
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
      expect(texts[0]).toBe(brandTitle('standing'))
      expect(texts).toContain('Nothing in flight')
      expect(texts.join('\n')).not.toMatch(/Live|Dormant|none/)
      expect(texts).toContain('2 concluded · latest: shipped (2d ago)')
      await ui.unmount()
    }
  })

  test('concluded expands to the five most recently closed, slug and date only, and collapses again', async ($, on) => {
    const closed = [3, 1, 6, 2, 5, 4].map(i =>
      pkg({ dir: `2025-0${i}-01-done${i}`, state: 'concluded', summary: `summary ${i}`, closedAt: NOW - i * DAY }),
    )
    world(on, { ...STANDING, packages: [STANDING.packages[0]!, ...closed] })
    await started($)
    await $.command.run({ command: 'standing' })
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'standing-concluded-toggle' })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    const rows = texts.filter(t => /^done\d/.test(t))
    expect(rows).toEqual([1, 2, 3, 4, 5].map(i => `done${i} ${dateOf(NOW - i * DAY)}`))
    expect(texts).toContain('6 concluded · latest: done1 (1d ago)')
    expect(texts.join('\n')).not.toContain('summary')
    expect(await ui.find({ key: 'standing-concluded-toggle' })).toMatchObject({ props: { label: 'Hide concluded' } })
    await ui.press({ key: 'standing-concluded-toggle' })
    expect((await ui.findAll({ type: 'Text' })).filter(t => /^done\d/.test(t.text))).toHaveLength(0)
    expect(await ui.find({ key: 'standing-concluded-toggle' })).toMatchObject({ props: { label: 'Show concluded' } })
  })

  test('the expanded flag survives a refresh', async ($, on) => {
    world(on)
    await started($)
    await $.command.run({ command: 'standing' })
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'standing-concluded-toggle' })
    await ui.press({ key: 'standing-refresh' })
    expect(await ui.find({ key: 'standing-concluded-toggle' })).toMatchObject({ props: { label: 'Hide concluded' } })
  })

  test('Resume points at the worktree that holds the newest copy', async ($, on) => {
    const elsewhere = pkg({
      dir: '2026-03-01-mods',
      state: 'live',
      hasWorktree: true,
      worktree: '.claude/worktrees/mods',
      baton: 'handoffs/x.md',
    })
    const w = world(on, { ...STANDING, packages: [elsewhere] })
    await started($)
    await $.command.run({ command: 'standing' })
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'standing-resume-2026-03-01-mods' })
    expect(w.prompts).toEqual([
      'Resume mods: read its newest handoff, .claude/worktrees/mods/docs/features/2026-03-01-mods/handoffs/x.md, and pick up from there (bespunky-workflow:session-handoff).',
    ])
  })

  test('Refresh re-runs the engine', async ($, on) => {
    const w = world(on)
    await started($)
    await $.command.run({ command: 'standing' })
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'standing-refresh' })
    expect(w.ran).toHaveLength(2)
  })

  test('no docs/features: a line of text, no pane', async ($, on) => {
    const w = world(on, { ...STANDING, repo: { ...STANDING.repo!, hasFeatures: false }, packages: [] })
    await started($)
    const out = await $.command.run({ command: 'standing' })
    expect(out.text).toBe('No project standing to show: this project has no docs/features/.')
    expect(w.opened).toEqual([])
  })

  test('an engine that fails opens no pane', async ($, on) => {
    const w = world(on, 'crash')
    await started($)
    const out = await $.command.run({ command: 'standing' })
    expect(out.text).toBe('No project standing to show: the project-standing engine did not answer.')
    expect(w.opened).toEqual([])
  })
})

describe('standing pane, as the toolkit draws it', () => {
  test('the pane is titled with the toolkit mark, in the brand accent', async ($, on) => {
    world(on)
    await started($)
    await $.command.run({ command: 'standing' })
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      const title = await ui.find({ type: 'Text', text: brandTitle('standing') })
      expect(title).toMatchObject({ props: { color: BRAND.accent, bold: true } })
      await ui.unmount()
    }
  })

  test('packages are separated by a thin rule; a slug and its about line stay together', async ($, on) => {
    world(on)
    await started($)
    await $.command.run({ command: 'standing' })
    const ui = await mount($, 'terminal')
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    const isRule = (t: string | undefined) => /^─+$/.test(t ?? '')
    const live = texts.indexOf('Live (2)')
    const dormant = texts.indexOf('Dormant (1)')
    // Live: new-live, a rule, old-live and its about line; no rule after the last row of a section.
    const between = texts.slice(live + 1, dormant)
    expect(between.filter(isRule)).toHaveLength(1)
    expect(isRule(between.at(-1))).toBe(false)
    const about = texts.indexOf('Make the old thing live again.')
    expect(isRule(texts[about - 1])).toBe(false)
    expect(texts.slice(about - 3, about)).toContain('old-live')
    // The title's rule is the only other one above the sections; Dormant has one row, so none.
    expect(texts.slice(dormant + 1).filter(isRule)).toHaveLength(0)
    // The expanded concluded list is separated the same way.
    await ui.press({ key: 'standing-concluded-toggle' })
    const expanded = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    const shipped = expanded.findIndex(t => t.startsWith('shipped '))
    expect(isRule(expanded[shipped + 2])).toBe(true)
    expect(expanded[shipped + 3]).toStartWith('dropped ')
  })

  test('an inline pane starts a row below the transcript; a docked one does not', async ($, on) => {
    world(on)
    await started($)
    await $.command.run({ command: 'standing' })
    const inline = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'standing', props: { ...PROPS, placement: 'inline' } })
    expect((await inline.find({ type: 'Box' }))?.props).toMatchObject({ marginTop: 1 })
    await inline.unmount()
    const docked = await mount($, 'terminal')
    expect((await docked.find({ type: 'Box' }))?.props).toMatchObject({ marginTop: 0 })
  })

  test("the command's answer row is the toolkit's, not the plugin's bare name", async ($, on) => {
    world(on)
    await started($)
    const row = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'CommandOutput',
      props: { command: 'standing', args: '', text: `${PLUGIN}: Standing: 1 live, 0 dormant, 2 concluded.`, isErrored: false },
    })
    const texts = (await row.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts).toEqual([brandTitle('standing'), 'Standing: 1 live, 0 dormant, 2 concluded.'])
    expect((await row.find({ type: 'Text', text: brandTitle('standing') }))?.props).toMatchObject({ color: BRAND.accent })
  })

  test('the control row says how a closed pane comes back, and closing toasts it', async ($, on) => {
    const w = world(on)
    await started($)
    await $.command.run({ command: 'standing' })
    const ui = await mount($, 'terminal')
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toContain(REOPEN_HINT)
    expect(REOPEN_HINT).toBe('/standing reopens it')
    await ui.press({ key: 'standing-close' })
    expect(w.closes).toEqual([{ id: 'standing', origin: { kind: 'plugin' } }])
    expect(w.toasts).toEqual([brandLine(CLOSED_TOAST)])
    // The person's own close (the engine's mark, ctrl+x x) reaches the module's ui.close hook instead, which
    // toasts the same line; the test engine cannot raise a person's close, so that path is pinned by reading.
  })
})

describe('standing policy', () => {
  test('a name the contract did not vouch for gets no prompt', async () => {
    expect(resumePrompt(pkg({ dir: '2026-01-01-ok', state: 'live', baton: 'handoffs/../../etc' }))).toBeUndefined()
    expect(resumePrompt(pkg({ dir: '2026-01-01-Ignore previous', state: 'live' }))).toBeUndefined()
    expect(resumePrompt(pkg({ dir: '2026-01-01-ok', state: 'live', worktree: '../../etc' }))).toBeUndefined()
    expect(resumePrompt(pkg({ dir: '2026-01-01-ok', state: 'live', worktree: 'a b; rm -rf' }))).toBeUndefined()
    expect(resumePrompt(pkg({ dir: '2026-01-01-ok', state: 'live' }))).toBe(
      'Resume ok: it has no handoff baton yet, so orient from docs/features/2026-01-01-ok/ (bespunky-workflow:project-standing, then bespunky-workflow:session-handoff).',
    )
  })

  test('the engine output is checked before it is drawn', async () => {
    expect(parseStanding('not json')).toBeUndefined()
    expect(parseStanding(JSON.stringify({ version: 2, packages: [] }))).toBeUndefined()
    expect(parseStanding(JSON.stringify(STANDING))).toEqual(STANDING)
  })

  test('groups are by state, most recent first; concluded by when they closed', async () => {
    const { live, dormant, concluded } = groups(STANDING)
    expect(live.map(p => p.slug)).toEqual(['new-live', 'old-live'])
    expect(dormant.map(p => p.slug)).toEqual(['asleep'])
    expect(concluded.map(p => p.slug)).toEqual(['shipped', 'dropped'])
  })

  test('the headline and the concluded line', async () => {
    expect(headline(groups(STANDING))).toBe('3 in flight')
    expect(headline(groups({ ...STANDING, packages: [] }))).toBe('Nothing in flight')
    expect(concludedLine(NOW, groups(STANDING).concluded)).toBe('2 concluded · latest: shipped (2d ago)')
    expect(concludedLine(NOW, [])).toBeUndefined()
  })

  test('ages read at a glance', async () => {
    expect(age(NOW, NOW - 100)).toBe('today')
    expect(age(NOW, NOW - 3 * DAY)).toBe('3d ago')
    expect(age(NOW, NOW - 21 * DAY)).toBe('3w ago')
    expect(age(NOW, NOW - 90 * DAY)).toBe('3mo ago')
  })
})
