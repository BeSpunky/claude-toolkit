// The voice band against the engine: the runtime's state files are faked
// beneath the plugin (fs.list / fs.read), the clock is mocked, and the band is
// mounted on every surface that has the AbovePrompt site.
import type { On, RenderPropsOf } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { WORDMARK, brandLine } from '../hooks/_brand.tsx'
import { guardAbort, healthWarning, parseHealth } from '../hooks/band.tsx'

const PLUGIN = 'bespunky-voice'
const HOME = '/home/tester'
const DIR = `${HOME}/.claude/bespunky-voice`
const ASK = 'mcp__plugin_bespunky-voice_bespunky-voice__ask_by_voice'
const T0 = 1_800_000_000_000
const SURFACES = ['terminal', 'desktop'] as const
/** The band's one line of text; the engine's own band (beneath) draws none. */
/** The band's own line: any Text but the toolkit's wordmark, which leads every toolkit band. */
const LINE = { type: 'Text', text: new RegExp(`^(?!${WORDMARK}$)`) }

const PROPS: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
}

const RAN_OK = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

type Files = Record<string, { text: string; mtimeMs: number }>

const HEALTHY = 'audio\tok\t\ntts\tnatural\t\nstt\tok\t\n'
const PIPER_BROKEN = 'audio\tok\t\ntts\tbroken\tpiper failed: libpiper_phonemize.so.1: cannot open\nstt\tok\t\n'

/**
 * The runtime's directory as the band sees it, and every command it runs;
 * `voice-health.sh` answers `health()` — what the runtime's verdict is now.
 */
function world(on: On, outcome = RAN_OK, health = () => HEALTHY) {
  const files: Files = {}
  const ran: string[][] = []
  mock.env(on, { HOME })
  const clock = mock.clock(on, { now: T0 })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ key: 'engine-band' }))

  on('fs.list', ($, e) => {
    if (e.path !== DIR) throw new Error(`ENOENT: ${e.path}`)

    return {
      value: Object.entries(files).map(([name, file]) => ({
        name,
        kind: 'file' as const,
        size: file.text.length,
        mtimeMs: file.mtimeMs,
        isLink: false,
      })),
    }
  })
  on('fs.read', ($, e) => {
    const file = files[e.path.slice(DIR.length + 1)]
    if (!e.path.startsWith(`${DIR}/`) || file === undefined) throw new Error(`ENOENT: ${e.path}`)

    return { value: file.text }
  })
  on('process.run', ($, e) => {
    ran.push([...e.argv])

    return { value: e.argv[1] === `${DIR}/voice-health.sh` ? { ...RAN_OK, stdout: health() } : outcome }
  })

  const write = (name: string, text: string, ageMs = 0) => {
    files[name] = { text, mtimeMs: clock.now() - ageMs }
  }
  const remove = (...names: string[]) => names.forEach(name => delete files[name])

  const probes = () => ran.filter(argv => argv[1] === `${DIR}/voice-health.sh`).length

  return { clock, ran, write, remove, probes }
}

async function started($: Engine, w: ReturnType<typeof world>) {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await w.clock.advance(400)
}

const mount = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: PROPS })

describe('voice band', () => {
  test('idle draws nothing of its own', async ($, on) => {
    const w = world(on)
    w.write('last-utterance.txt', 'an old question', 600_000)
    await started($, w)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await ui.find({ key: 'engine-band' })).toBeDefined()
      expect(await ui.find(LINE)).toBeUndefined()
      expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
      await ui.unmount()
    }
  })

  test('speaking shows what is said, with Replay and Stop', async ($, on) => {
    const w = world(on)
    w.write('last-utterance.txt', 'Should I ship the release now?')
    w.write('.speaking.pid', '4242')
    await started($, w)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect((await ui.find(LINE))?.text).toBe('🔊 Should I ship the release now?')
      expect(await ui.find({ key: 'voice-replay' })).toMatchObject({ props: { label: 'Replay', hotkey: 'r' } })
      expect(await ui.find({ key: 'voice-stop' })).toMatchObject({ props: { label: 'Stop', hotkey: 's' } })
      await ui.unmount()
    }
  })

  test('a long utterance is cut to the band', async ($, on) => {
    const w = world(on)
    w.write('last-utterance.txt', 'word '.repeat(100))
    w.write('.speaking.pid', '4242')
    await started($, w)
    const ui = await mount($, 'terminal')
    const text = (await ui.find(LINE))?.text ?? ''
    expect([...text].length).toBeLessThanOrEqual(PROPS.bodyColumns)
    expect(text).toEndWith('…')
  })

  test('listening shows the words heard so far', async ($, on) => {
    const w = world(on)
    w.write('.listening.pid', '99')
    await started($, w)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect((await ui.find(LINE))?.text).toBe('🎙 listening…')
      await ui.unmount()
    }
    w.write('.hearing', 'yes ship it')
    await w.clock.advance(400)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect((await ui.find(LINE))?.text).toBe('🎙 “yes ship it”')
      expect(await ui.find({ key: 'voice-stop' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('after speech ends the utterance lingers, Replay only, then goes', async ($, on) => {
    const w = world(on)
    w.write('last-utterance.txt', 'All done.')
    w.write('.speaking.pid', '4242')
    await started($, w)
    w.remove('.speaking.pid')
    await w.clock.advance(400)

    const ui = await mount($, 'terminal')
    const line = await ui.find(LINE)
    expect(line?.text).toBe('🔊 All done.')
    expect(line?.props.dimColor).toBe(true)
    expect(await ui.find({ key: 'voice-replay' })).toBeDefined()
    expect(await ui.find({ key: 'voice-stop' })).toBeUndefined()

    await w.clock.advance(21_000)
    expect(await ui.find(LINE)).toBeUndefined()
  })

  test('stale state files are ignored', async ($, on) => {
    const w = world(on)
    w.write('last-utterance.txt', 'from a crashed speaker', 200_000)
    w.write('.speaking.pid', '4242', 181_000)
    w.write('.listening.pid', '99', 61_000)
    w.write('.hearing', 'from a crashed recorder', 61_000)
    await started($, w)
    const ui = await mount($, 'terminal')
    expect(await ui.find(LINE)).toBeUndefined()
  })

  test('Stop and Replay run the runtime commands', async ($, on) => {
    const w = world(on)
    w.write('last-utterance.txt', 'Which branch?')
    w.write('.speaking.pid', '4242')
    await started($, w)
    for (const surface of SURFACES) {
      w.ran.length = 0
      const ui = await mount($, surface)
      await ui.press({ key: 'voice-stop' })
      await ui.press({ key: 'voice-replay' })
      expect(w.ran).toEqual([
        ['bash', `${DIR}/voice.sh`, 'stop'],
        ['bash', `${DIR}/voice.sh`, 'replay'],
      ])
      await ui.unmount()
    }
  })

  test('a failed command is a toast naming it', async ($, on) => {
    const w = world(on, { ...RAN_OK, exitCode: 1, stderr: 'no runtime\n' })
    const toasts: string[] = []
    on('ui.toast', ($, e) => {
      toasts.push(e.text)

      return { value: undefined }
    })
    w.write('.speaking.pid', '4242')
    await started($, w)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'voice-stop' })
    expect(toasts).toEqual([brandLine('Voice stop failed: no runtime')])
  })

  test('a normal ask_by_voice passes its result through and stops nothing', async ($, on) => {
    const w = world(on)
    const answer = { result: { content: [{ type: 'text', text: '{"answer":"yes"}' }] } }
    on('tool.call', () => answer as never)
    const done = await $.tool.call({ tool: ASK, question: 'Ship it?' } as never)
    expect(done).toMatchObject(answer)
    expect(w.ran).toEqual([])
  })

  test('Esc (an aborted dispatch) runs stop; completion afterwards does not', async () => {
    const stops: string[] = []
    const interrupted = new AbortController()
    let finish = (_: string) => {}
    const pending = guardAbort(interrupted.signal, () => new Promise<string>(done => (finish = done)), () => stops.push('stop'))
    interrupted.abort()
    finish('late')
    expect(await pending).toBe('late')
    expect(stops).toEqual(['stop'])

    const calm = new AbortController()
    expect(await guardAbort(calm.signal, async () => 'answered', () => stops.push('stop'))).toBe('answered')
    calm.abort()
    expect(stops).toEqual(['stop'])
  })

  describe('engine health', () => {
    test('healthy engines stay quiet, and are probed once, not per tick', async ($, on) => {
      const w = world(on)
      w.write('voice-health.sh', '#!/bin/bash')
      await started($, w)
      await w.clock.advance(3_000)
      for (const surface of SURFACES) {
        const ui = await mount($, surface)
        expect(await ui.find(LINE)).toBeUndefined()
        await ui.unmount()
      }
      expect(w.probes()).toBe(1)
    })

    test('a broken Piper warns until dismissed, and stays dismissed', async ($, on) => {
      const w = world(on, RAN_OK, () => PIPER_BROKEN)
      w.write('voice-health.sh', '#!/bin/bash')
      await started($, w)
      await w.clock.advance(400)
      for (const surface of SURFACES) {
        const ui = await mount($, surface)
        expect((await ui.find(LINE))?.text).toBe('⚠ voice: Piper broken — robotic fallback · /speak status')
        expect(await ui.find({ key: 'voice-dismiss' })).toMatchObject({ props: { label: 'Dismiss', hotkey: 'd' } })
        await ui.unmount()
      }
      const ui = await mount($, 'terminal')
      await ui.press({ key: 'voice-dismiss' })
      expect(await ui.find(LINE)).toBeUndefined()
      await w.clock.advance(2_000)
      expect(await ui.find(LINE)).toBeUndefined()
    })

    test('speech takes the band over a warning', async ($, on) => {
      const w = world(on, RAN_OK, () => PIPER_BROKEN)
      w.write('voice-health.sh', '#!/bin/bash')
      w.write('last-utterance.txt', 'Ship it?')
      w.write('.speaking.pid', '4242')
      await started($, w)
      await w.clock.advance(400)
      const ui = await mount($, 'terminal')
      expect((await ui.find(LINE))?.text).toBe('🔊 Ship it?')
    })

    test('a repair is noticed: an engine install moving re-takes the verdict', async ($, on) => {
      let verdict = PIPER_BROKEN
      const w = world(on, RAN_OK, () => verdict)
      w.write('voice-health.sh', '#!/bin/bash')
      w.write('piper', '')
      await started($, w)
      await w.clock.advance(400)
      const ui = await mount($, 'terminal')
      expect((await ui.find(LINE))?.text).toStartWith('⚠ voice: Piper broken')

      verdict = HEALTHY
      w.write('piper', '')
      await w.clock.advance(1_000)
      expect(await ui.find(LINE)).toBeUndefined()
      expect(w.probes()).toBe(2)
    })

    test('an aged verdict is re-taken even when nothing moved', async ($, on) => {
      const w = world(on)
      w.write('voice-health.sh', '#!/bin/bash')
      await started($, w)
      await w.clock.advance(599_000)
      expect(w.probes()).toBe(1)
      await w.clock.advance(2_000)
      expect(w.probes()).toBe(2)
    })

    test('without the voice runtime nothing is probed or shown', async ($, on) => {
      const w = world(on, RAN_OK, () => PIPER_BROKEN)
      await started($, w)
      await w.clock.advance(1_000)
      const ui = await mount($, 'terminal')
      expect(await ui.find(LINE)).toBeUndefined()
      expect(w.probes()).toBe(0)
    })

    test('the warning names everything at fault, and only those', () => {
      expect(healthWarning({ audio: 'ok', tts: 'natural', stt: 'ok' })).toBeUndefined()
      expect(healthWarning({ audio: 'native', tts: 'system', stt: 'ok' })).toBeUndefined()
      expect(healthWarning({ audio: 'ok', tts: 'robotic', stt: 'missing' })).toBe(
        'voice: robotic voice (no Piper); no speech recognition · /speak status',
      )
      expect(healthWarning({ audio: 'ok', tts: 'natural', stt: 'broken' })).toBe('voice: speech recognition broken · /speak status')
    })

    test('working engines with no audio connection are not a working voice', () => {
      expect(healthWarning({ audio: 'unreachable', tts: 'natural', stt: 'ok' })).toBe('voice: no audio connection · /speak status')
    })

    test('only the runtime script\'s own output is a verdict', () => {
      expect(parseHealth(PIPER_BROKEN)).toEqual({ audio: 'ok', tts: 'broken', stt: 'ok' })
      expect(parseHealth('')).toBeUndefined()
      expect(parseHealth('audio\tok\t\ntts\tfine\t\nstt\tok\t\n')).toBeUndefined()
      expect(parseHealth('tts\tnatural\t\nstt\tok\t\n')).toBeUndefined()
      expect(parseHealth('bash: voice-health.sh: No such file')).toBeUndefined()
    })
  })
})
