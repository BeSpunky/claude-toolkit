// The house band against the engine: check-house-version.sh --json is faked
// beneath the plugin (process.run), and the band is mounted on every surface
// that has the AbovePrompt site. The script's own rules are tested by
// tools/test-scaffold/house-hook.test.sh; this pins only what the band does
// with what the script says.
import type { On, RenderPropsOf } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BRAND, WORDMARK, brandLine } from '../hooks/_brand.tsx'
import { DISMISSED_TOAST, parseNotices, promptFor } from '../hooks/band.tsx'

const PLUGIN = 'bespunky-project-starter'
const CWD = '/work/project'
const SURFACES = ['terminal', 'desktop'] as const

const PROPS: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
}

const MOVED = { kind: 'toolkit-moved', action: 'sync', summary: 'The toolkit moved on: 0.1.0 applied, 0.38.1 here.' }
const BEHIND = { kind: 'machine-behind', action: 'update-toolkit', summary: "This machine's toolkit is older." }
const MOUNTS = { kind: 'post-create-failed', action: 'fix-mounts', summary: 'Post-create most likely failed.' }

/** The band's notice lines: every Text but the toolkit's wordmark. */
const lines = async (ui: { findAll: (q: { type: string }) => Promise<{ text?: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text).filter(t => t !== WORDMARK)

const ok = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
const said = (...notices: object[]) => JSON.stringify({ notices })

/** The script as the band sees it: `out` is what the next run prints. */
function world(on: On, first: string) {
  const runs: { argv: string[]; env?: Record<string, string>; cwd?: string }[] = []
  const submitted: { text: string; asUser?: boolean }[] = []
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  const script = { out: ok(first) }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ key: 'engine-band' }))
  on('turn.complete', () => ({ text: '' }))
  on('process.run', ($, e) => {
    runs.push({ argv: [...e.argv], env: e.init?.env, cwd: e.init?.cwd })

    return { value: script.out }
  })
  on('prompt.submit', ($, e) => {
    submitted.push({ text: e.text, asUser: e.origin.kind === 'plugin' ? e.origin.asUser : undefined })

    return { text: e.text }
  })

  return { runs, submitted, script, toasts }
}

const start = ($: Engine) => $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
const mount = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: PROPS })
const endTurn = ($: Engine) =>
  $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId: 't1' })

describe('house band', () => {
  test('nothing to say draws nothing of its own', async ($, on) => {
    world(on, said())
    await start($)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await ui.find({ key: 'engine-band' })).toBeDefined()
      expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
      await ui.unmount()
    }
  })

  test('runs the hook script itself, in --json mode, against the project', async ($, on) => {
    const w = world(on, said())
    await start($)
    expect(w.runs).toHaveLength(1)
    expect(w.runs[0].argv.slice(-2)[1]).toBe('--json')
    expect(w.runs[0].argv[1]).toEndWith('/hooks/check-house-version.sh')
    expect(w.runs[0].cwd).toBe(CWD)
    expect(w.runs[0].env?.CLAUDE_PROJECT_DIR).toBe(CWD)
    expect(w.runs[0].env?.CLAUDE_PLUGIN_ROOT).toBeDefined()
  })

  test('a failed or garbled run degrades to silence', async ($, on) => {
    const w = world(on, 'not json')
    await start($)
    let ui = await mount($, 'terminal')
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    await ui.unmount()

    w.script.out = ok(said(MOVED), 1)
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    ui = await mount($, 'terminal')
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  })

  test('a sync notice shows its reason, Sync and Dismiss', async ($, on) => {
    world(on, said(MOVED))
    await start($)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await lines(ui)).toEqual([MOVED.summary])
      expect(await ui.find({ key: 'house-toolkit-moved' })).toMatchObject({ props: { label: 'Sync', hotkey: 's' } })
      expect(await ui.find({ key: 'house-dismiss' })).toMatchObject({ props: { label: 'Dismiss', hotkey: 'd' } })
      await ui.unmount()
    }
  })

  test('Sync submits a prompt asking for /sync; the band never runs it', async ($, on) => {
    const w = world(on, said(MOVED))
    await start($)
    for (const surface of SURFACES) {
      w.submitted.length = 0
      const ui = await mount($, surface)
      await ui.press({ key: 'house-toolkit-moved' })
      expect(w.submitted).toEqual([{ text: promptFor(MOVED as never), asUser: true }])
      expect(w.submitted[0].text).toContain('/sync')
      await ui.unmount()
    }
    expect(w.runs.every(run => run.argv.includes('--json'))).toBe(true)
  })

  test('a machine behind the project offers an update, never a sync', async ($, on) => {
    const w = world(on, said(BEHIND))
    await start($)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ key: 'house-machine-behind' })).toMatchObject({ props: { label: 'Update toolkit' } })
    await ui.press({ key: 'house-machine-behind' })
    expect(w.submitted[0].text).toContain('Do not run a sync')
  })

  test('two notices draw two rows, one Dismiss', async ($, on) => {
    world(on, said(MOUNTS, MOVED))
    await start($)
    const ui = await mount($, 'terminal')
    expect(await lines(ui)).toEqual([MOUNTS.summary, MOVED.summary])
    expect(await ui.findAll({ type: 'Text', text: WORDMARK })).toHaveLength(1)
    expect(await ui.find({ key: 'house-post-create-failed' })).toMatchObject({ props: { label: 'Fix' } })
    expect(await ui.findAll({ key: 'house-dismiss' })).toHaveLength(1)
  })

  test('Dismiss hides the band for the session, and stops the re-checks', async ($, on) => {
    const w = world(on, said(MOVED))
    await start($)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'house-dismiss' })
    expect(await lines(ui)).toEqual([])
    expect(w.toasts).toEqual([brandLine(DISMISSED_TOAST)])
    const before = w.runs.length
    await endTurn($)
    expect(w.runs).toHaveLength(before)
  })

  test('after a turn the band re-asks, so a sync that ran takes it down', async ($, on) => {
    const w = world(on, said(MOVED))
    await start($)
    const ui = await mount($, 'terminal')
    expect(await lines(ui)).toEqual([MOVED.summary])
    w.script.out = ok(said())
    await endTurn($)
    expect(await lines(ui)).toEqual([])
  })

  test('nothing shown, nothing re-run after a turn', async ($, on) => {
    const w = world(on, said())
    await start($)
    await endTurn($)
    expect(w.runs).toHaveLength(1)
  })

  test('the band is the toolkit\'s: a row below the transcript, led by the wordmark in the accent', async ($, on) => {
    world(on, said(MOVED))
    await start($)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect((await ui.find({ type: 'Box' }))?.props).toMatchObject({ marginTop: 1 })
      expect(await ui.find({ type: 'Text', text: WORDMARK })).toMatchObject({ props: { color: BRAND.accent, bold: true } })
      await ui.unmount()
    }
  })

  test('parseNotices keeps only well-formed notices with a known action', () => {
    expect(parseNotices('')).toEqual([])
    expect(parseNotices('{"notices":"x"}')).toEqual([])
    expect(parseNotices(said(MOVED, { kind: 'x', action: 'rm -rf', summary: 'no' }, { kind: 'y', action: 'sync', summary: '' }))).toEqual([
      MOVED,
    ])
  })
})
