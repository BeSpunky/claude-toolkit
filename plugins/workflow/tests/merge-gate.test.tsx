// The merge gate against the engine: git and branches.mjs are faked beneath the plugin (process.run), Claude's
// call is a `tool.call` of the registered tool, and the band is mounted above the prompt. What is asserted is
// the gate's contract: drawn only on Claude's proposal and only once the turn is over, its moves derived from
// the engine (promote only where `plan promote` plans one), a press sends ONE prompt built from vouched names
// and never Claude's note, and the person's next prompt — pressed or typed — takes it down.
import type { On, RenderPropsOf } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { WORDMARK } from '../hooks/_brand.tsx'
import { gateOf, parseProposal, refusedText } from '../hooks/merge-gate.tsx'
import { parseStatus } from '../hooks/branch-engine.ts'

const PLUGIN = 'bespunky-workflow'
const TOOL = 'mcp__bespunky-workflow__propose_move'

const STATUS = {
  state: 'declared',
  source: 'refs/heads/development',
  projection: { schema: 1, remote: 'origin', integration: 'development', chain: ['development', 'main'], summary: 'development → main' },
  protected: ['development', 'main'],
  protectedPatterns: [],
  notes: [],
  reason: null,
}
const TRUNK = {
  ...STATUS,
  projection: { ...STATUS.projection, integration: 'main', chain: ['main'], summary: 'main (trunk)' },
  protected: ['main'],
}

const BAND: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}

type World = {
  status?: unknown
  /** `<source>..<target>` → commits ahead; a missing key is a branch git does not know. */
  ahead?: Record<string, number>
  /** Stages `plan promote` plans. */
  promotable?: string[]
}

function world(on: On, w: World = {}) {
  const prompts: string[] = []
  const ran: string[][] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.log', () => ({ value: undefined }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__${PLUGIN}__${e.name}` } }))
  // The engine's own band beneath the plugins: nothing of its own to draw here.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    ran.push(argv)
    const answer = ((): { exitCode: number; stdout?: string } => {
      if (argv[0] === 'node' && argv[2] === 'status') return { exitCode: 0, stdout: JSON.stringify(w.status ?? STATUS) }
      if (argv[0] === 'node' && argv[2] === 'plan') return { exitCode: (w.promotable ?? ['main']).includes(argv[4] ?? '') ? 0 : 2 }
      if (argv[0] === 'git' && argv[1] === 'rev-list') {
        const [target, source] = (argv[3] ?? '').replace(/refs\/heads\//g, '').split('..')
        const n = (w.ahead ?? { 'development..feat/x': 3, 'main..development': 2 })[`${target}..${source}`]

        return n === undefined ? { exitCode: 128 } : { exitCode: 0, stdout: `${n}\n` }
      }

      // The plugin's other mods read git and the engine too; only the gate's reads are this world's.
      return { exitCode: 1 }
    })()

    return { value: { stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...answer } }
  })
  on('prompt.submit', ($, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })

  return { prompts, ran }
}

async function started($: Engine) {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
}

const propose = ($: Engine, input: Record<string, unknown>) =>
  $.tool.call({ tool: TOOL, ...input }).then(r => String((r as { result?: unknown }).result))

const mount = ($: Engine, props: Partial<RenderPropsOf['AbovePrompt']> = {}) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', requestId: 'above-prompt', props: { ...BAND, ...props } })

describe('merge gate', () => {
  test('nothing is drawn until Claude proposes', async ($, on) => {
    world(on)
    await started($)
    const ui = await mount($)
    expect(await ui.find({ key: 'merge-gate-land' })).toBeUndefined()
    await ui.unmount()
  })

  test('a landing proposal draws Land, Land & promote, Push and Not yet, under the toolkit mark', async ($, on) => {
    world(on)
    await started($)
    const said = await propose($, { gate: 'land', branch: 'feat/x', note: 'Gate mod done; 48 tests pass.' })
    expect(said).toContain('Land on development · Land & promote to main · Push branch · Not yet')
    expect(said).toContain('End your turn')

    const ui = await mount($)
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts[0]).toBe(WORDMARK)
    expect(texts).toContain('feat/x → development · 3 commits')
    expect(texts).toContain('Gate mod done; 48 tests pass.')
    expect(await ui.find({ key: 'merge-gate-land' })).toMatchObject({ props: { label: 'Land on development', hotkey: 'l', variant: 'primary' } })
    expect(await ui.find({ key: 'merge-gate-land-promote' })).toMatchObject({ props: { label: 'Land & promote to main', hotkey: 'm' } })
    expect(await ui.find({ key: 'merge-gate-push' })).toMatchObject({ props: { label: 'Push branch', hotkey: 'p' } })
    expect(await ui.find({ key: 'merge-gate-dismiss' })).toMatchObject({ props: { label: 'Not yet', hotkey: 'n' } })
    await ui.unmount()
  })

  test('hidden while Claude is still working, and behind a survey', async ($, on) => {
    world(on)
    await started($)
    await propose($, { gate: 'land', branch: 'feat/x', note: '' })
    for (const props of [{ isWorking: true }, { hasSurvey: true }]) {
      const ui = await mount($, props)
      expect(await ui.find({ key: 'merge-gate-land' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('a press sends one prompt naming the move, never the note, and takes the gate down', async ($, on) => {
    const w = world(on)
    await started($)
    await propose($, { gate: 'land', branch: 'feat/x', note: 'SECRET NOTE' })
    const ui = await mount($)
    await ui.press({ key: 'merge-gate-land-promote' })
    expect(w.prompts).toEqual([
      'Land feat/x on development, then promote development to main — I pressed Land & promote in the merge gate. Follow bespunky-workflow:branch-and-release (plan land feat/x, then plan promote main).',
    ])
    expect(await ui.find({ key: 'merge-gate-land' })).toBeUndefined()
    await ui.unmount()
  })

  test('Not yet takes it down and sends nothing', async ($, on) => {
    const w = world(on)
    await started($)
    await propose($, { gate: 'land', branch: 'feat/x', note: '' })
    const ui = await mount($)
    await ui.press({ key: 'merge-gate-dismiss' })
    expect(w.prompts).toEqual([])
    expect(await ui.find({ key: 'merge-gate-land' })).toBeUndefined()
    await ui.unmount()
  })

  test('the person typing instead answers it too', async ($, on) => {
    world(on)
    await started($)
    await propose($, { gate: 'land', branch: 'feat/x', note: '' })
    await $.prompt.submit({ text: 'one more thing first', origin: { kind: 'composer' }, wait: false })
    const ui = await mount($)
    expect(await ui.find({ key: 'merge-gate-land' })).toBeUndefined()
    await ui.unmount()
  })

  test('no promote where the engine plans none (trunk)', async ($, on) => {
    world(on, { status: TRUNK, promotable: [], ahead: { 'main..feat/x': 1 } })
    await started($)
    const said = await propose($, { gate: 'land', branch: 'feat/x', note: '' })
    expect(said).toContain('Land on main · Push branch · Not yet')
    const ui = await mount($)
    expect(await ui.find({ key: 'merge-gate-land-promote' })).toBeUndefined()
    expect(await ui.find({ key: 'merge-gate-land' })).toBeDefined()
    await ui.unmount()
  })

  test('a promotion proposal offers Promote alone', async ($, on) => {
    const w = world(on)
    await started($)
    expect(await propose($, { gate: 'promote', note: '' })).toContain('Promote to main · Not yet')
    const ui = await mount($)
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toContain('development → main · 2 commits')
    await ui.press({ key: 'merge-gate-promote' })
    expect(w.prompts).toEqual([
      'Promote development to main — I pressed Promote in the merge gate. Follow bespunky-workflow:branch-and-release (plan promote main).',
    ])
    await ui.unmount()
  })

  test('refusals are said back to Claude and draw nothing', async ($, on) => {
    world(on, { ahead: { 'development..feat/empty': 0 } })
    await started($)
    expect(await propose($, { gate: 'land', branch: 'development', note: '' })).toBe(
      refusedText('development is a protected line; only a work branch lands'),
    )
    expect(await propose($, { gate: 'land', branch: 'feat/empty', note: '' })).toBe(refusedText('feat/empty has nothing development lacks'))
    expect(await propose($, { gate: 'land', branch: 'feat/gone', note: '' })).toBe(refusedText('there is no branch feat/gone'))
    expect(await propose($, { gate: 'land', branch: '--force', note: '' })).toBe(refusedText('`branch` must name the work branch to land'))
    const ui = await mount($)
    expect(await ui.find({ key: 'merge-gate-land' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('merge gate policy', () => {
  const model = parseStatus(JSON.stringify(STATUS))

  test('names that could smuggle anything into a prompt are refused', () => {
    for (const branch of ['-x', 'a..b', 'a b', 'a;rm', '/x', 'x//y', '']) {
      expect(typeof parseProposal({ gate: 'land', branch, note: '' })).toBe('string')
    }
    expect(parseProposal({ gate: 'land', branch: 'feat/merge-gate-mod', note: ' a\n b ' })).toEqual({
      gate: 'land',
      branch: 'feat/merge-gate-mod',
      note: 'a b',
    })
    expect(typeof parseProposal({ gate: 'ship' })).toBe('string')
  })

  test('an undeclared model offers nothing', () => {
    const undeclared = parseStatus(JSON.stringify({ ...STATUS, state: 'undeclared', projection: null }))
    expect(gateOf({ gate: 'land', branch: 'feat/x', note: '' }, { model: undeclared, ahead: 1, canPromote: false })).toHaveProperty('refusal')
  })

  test('a promotion with nothing to carry is refused', () => {
    expect(gateOf({ gate: 'promote', note: '' }, { model, ahead: 0, canPromote: true })).toEqual({ refusal: 'development has nothing main lacks' })
  })
})
