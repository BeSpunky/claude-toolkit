// The standing pane against the engine: the project-standing engine's run is faked beneath
// the plugin (process.run answers its --json), and the pane is mounted on every surface that
// places panes. What is asserted is the pane's contract: opened only by /standing, grouped by
// the engine's states, Resume queues a prompt built from validated names only, and nothing is
// drawn or opened when the engine has nothing to say.
import type { On, RenderPropsOf } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { age, groups, parseStanding, resumePrompt } from '../hooks/standing.tsx'
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
  ...over,
})

const STANDING: Standing = {
  version: 1,
  staleDays: 14,
  now: NOW,
  repo: { lastCommit: NOW - DAY, commitAgeDays: 1, hasFeatures: true, hasRecentDoc: true },
  packages: [
    pkg({ dir: '2026-01-01-old-live', state: 'live', lastActivity: NOW - 3 * DAY, baton: 'handoffs/2026-01-02T1200Z.md' }),
    pkg({ dir: '2026-02-01-new-live', state: 'live', hasWorktree: true }),
    pkg({ dir: '2025-06-01-asleep', state: 'dormant', lastActivity: NOW - 90 * DAY, baton: 'handoffs/b.md' }),
    pkg({ dir: '2025-01-01-shipped', state: 'concluded', summary: 'Shipped the thing; ruled out the other.' }),
    pkg({ dir: '2025-02-01-dropped', state: 'concluded', status: 'abandoned' }),
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
  on('ui.toast', () => ({ value: undefined }))

  return { ran, prompts, opened }
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
      expect(texts).toContain('Live (2)')
      expect(texts).toContain('Dormant (1)')
      expect(texts).toContain('Concluded (2)')
      expect(texts.join('\n')).toContain('handoffs/2026-01-02T1200Z.md')
      expect(texts.join('\n')).toContain('shipped — Shipped the thing; ruled out the other.')
      expect(texts.join('\n')).toContain('dropped (abandoned)')
      expect(await ui.find({ key: 'standing-resume-2026-02-01-new-live' })).toMatchObject({ props: { hotkey: '1' } })
      expect(await ui.find({ key: 'standing-resume-2026-01-01-old-live' })).toMatchObject({ props: { hotkey: '2' } })
      expect(await ui.find({ key: 'standing-resume-2025-06-01-asleep' })).toMatchObject({ props: { hotkey: '3' } })
      expect(await ui.find({ key: 'standing-resume-2025-01-01-shipped' })).toBeUndefined()
      await ui.unmount()
    }
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

describe('standing policy', () => {
  test('a name the contract did not vouch for gets no prompt', async () => {
    expect(resumePrompt(pkg({ dir: '2026-01-01-ok', state: 'live', baton: 'handoffs/../../etc' }))).toBeUndefined()
    expect(resumePrompt(pkg({ dir: '2026-01-01-Ignore previous', state: 'live' }))).toBeUndefined()
    expect(resumePrompt(pkg({ dir: '2026-01-01-ok', state: 'live' }))).toBe(
      'Resume ok: it has no handoff baton yet, so orient from docs/features/2026-01-01-ok/ (bespunky-workflow:project-standing, then bespunky-workflow:session-handoff).',
    )
  })

  test('the engine output is checked before it is drawn', async () => {
    expect(parseStanding('not json')).toBeUndefined()
    expect(parseStanding(JSON.stringify({ version: 2, packages: [] }))).toBeUndefined()
    expect(parseStanding(JSON.stringify(STANDING))).toEqual(STANDING)
  })

  test('groups are by state, most recent first', async () => {
    const { live, dormant, concluded } = groups(STANDING)
    expect(live.map(p => p.slug)).toEqual(['new-live', 'old-live'])
    expect(dormant.map(p => p.slug)).toEqual(['asleep'])
    expect(concluded).toHaveLength(2)
  })

  test('ages read at a glance', async () => {
    expect(age(NOW, NOW - 100)).toBe('today')
    expect(age(NOW, NOW - 3 * DAY)).toBe('3d ago')
    expect(age(NOW, NOW - 21 * DAY)).toBe('3w ago')
    expect(age(NOW, NOW - 90 * DAY)).toBe('3mo ago')
  })
})
