// bespunky-voice — the VOICE BAND: one row above the prompt that says what is
// being said (🔊) or heard (🎙) right now, with Replay (r) and Stop (s).
//
// WHY IT IS A VIEW OVER STATE FILES. The audio does not live in the engine: an
// utterance is a detached process group started by speaker.sh, a recording is
// listen.sh's parecord, and either may be started by a command hook, the
// /speak command or the ask_by_voice MCP server — three separate processes,
// none of them this module. The runtime therefore publishes the truth as files
// under ~/.claude/bespunky-voice/ (`.speaking.pid` + `last-utterance.txt`,
// `.listening.pid` + `.hearing`), and the band only READS them: a poller folds
// them into one `$.state` value (types/index.d.ts) and the drawing reads that,
// so it redraws exactly when what it shows changes. Its two buttons and its
// Esc hook act through the runtime's own front door (`voice.sh stop|replay`),
// never by touching a process themselves.
//
// THE PLUGIN WORKS WITHOUT IT. Speaking, listening, /speak stop and replay are
// all command hooks, a command and an MCP tool; with mods disabled (or on a
// build without them) those remain the floor and nothing here is missed but
// the view. Never put behaviour here that the floor needs.
//
// ENGINE HEALTH. When nothing is said or heard, the band warns about an engine
// that will let the person down — a broken Piper about to speak in the robotic
// voice, no speech recognition for ask_by_voice — so the robotic voice is never
// a surprise. The verdict is the runtime's (`voice-health.sh`, the same probe
// /speak status runs); the band only reads it, once at the start and again when
// an engine's install moves or the verdict ages — never on the 300ms tick.

import type { EngineInterface, FsEntry, Register } from 'claude-code'

import type { VoiceBand, VoiceHealth } from '../types/index.d.ts'

import { BAND_GUTTER_CELLS, BrandFrame, brandLine } from './_brand.tsx'

/** The one value the band draws from; written by the poller alone. */
const BAND = { plugin: 'bespunky-voice', key: 'band' } as const
const IDLE: VoiceBand = { phase: 'idle' }

/**
 * The ask_by_voice tool, however the host spells the plugin's server
 * (`mcp__plugin_bespunky-voice_bespunky-voice__ask_by_voice` when installed).
 * Module-private on purpose: `claude plugin validate` reads a matcher only
 * from a const nothing else references.
 */
const ASK_BY_VOICE = /^mcp__(?:plugin_[^_]+_)?bespunky-voice__ask_by_voice$/

const POLL_MS = 300
/** A state file older than this is a crashed writer's leftover, not speech. */
const STALE_SPEAKING_MS = 180_000
const STALE_LISTENING_MS = 60_000
/** How long the last utterance stays up after speech ends. */
const LINGER_MS = 20_000
/** A health verdict is re-taken this often even when nothing on disk moved. */
const HEALTH_TTL_MS = 600_000
/** The runtime entries whose change means the verdict may have changed. */
const HEALTH_INPUTS = ['voice-health.sh', 'tts-engine.sh', 'stt-engine.sh', 'piper', 'voices', 'whisper']

type Verb = 'stop' | 'replay'

/** What the runtime's files say, one poll's worth. */
export type Snapshot = {
  /** `.speaking.pid`'s mtime, when it exists. */
  speakingSince?: number
  /** `.listening.pid`'s mtime, when it exists. */
  listeningSince?: number
  /** `last-utterance.txt`. */
  lastText: string
  /** `.hearing`. */
  heard: string
  /** The engines' last verdict, when one has been taken. */
  health?: VoiceHealth
  /** The warning the person dismissed this session. */
  dismissed?: string
}

/**
 * The band's next phase from the previous one, the files, and the time: the
 * whole policy, pure, so the poller is only plumbing.
 */
export function decide(previous: VoiceBand, files: Snapshot, now: number): VoiceBand {
  const isFresh = (since: number | undefined, bound: number) => since !== undefined && now - since <= bound

  if (isFresh(files.speakingSince, STALE_SPEAKING_MS)) {
    return { phase: 'speaking', text: oneLine(files.lastText) }
  }
  if (isFresh(files.listeningSince, STALE_LISTENING_MS)) {
    return { phase: 'listening', heard: oneLine(files.heard) }
  }
  if (previous.phase === 'speaking') {
    return { phase: 'lingering', text: previous.text, until: now + LINGER_MS }
  }
  if (previous.phase === 'lingering' && now < previous.until) {
    return previous
  }
  const warning = files.health && healthWarning(files.health)
  if (warning && warning !== files.dismissed) {
    return { phase: 'warning', text: warning }
  }

  return IDLE
}

/** What a healthy-enough voice says: nothing. Otherwise one short line. */
export function healthWarning(health: VoiceHealth): string | undefined {
  const tts = {
    natural: undefined,
    system: undefined,
    broken: 'Piper broken — robotic fallback',
    robotic: 'robotic voice (no Piper)',
    none: 'no speech engine',
  }[health.tts]
  const stt = {
    ok: undefined,
    broken: 'speech recognition broken',
    missing: 'no speech recognition',
  }[health.stt]
  const problems = [tts, stt].filter(Boolean)

  return problems.length === 0 ? undefined : `voice: ${problems.join('; ')} · /speak status`
}

/** `voice-health.sh`'s two lines, or undefined when they aren't its output. */
export function parseHealth(stdout: string): VoiceHealth | undefined {
  const verdicts = new Map(stdout.split('\n').map(line => line.split('\t', 2) as [string, string?]))
  const tts = verdicts.get('tts')
  const stt = verdicts.get('stt')
  const isTts = (v?: string): v is VoiceHealth['tts'] => ['natural', 'broken', 'robotic', 'system', 'none'].includes(v ?? '')
  const isStt = (v?: string): v is VoiceHealth['stt'] => ['ok', 'broken', 'missing'].includes(v ?? '')

  return isTts(tts) && isStt(stt) ? { tts, stt } : undefined
}

/**
 * Runs `onAbort` if `signal` aborts while `work` is in flight, and never
 * after: how the Esc hook reaches the voice without touching the result.
 */
export async function guardAbort<T>(signal: AbortSignal, work: () => Promise<T>, onAbort: () => void): Promise<T> {
  if (signal.aborted) {
    onAbort()
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await work()
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

export const register: Register = on => {
  let poller: { cancel: () => void } | undefined
  /** The warning dismissed this session: it stays down until it changes. */
  const dismissal = { text: '' }

  on('session.start', async ($, e, next) => {
    poller?.cancel()
    dismissal.text = ''
    poller = await startPolling($, dismissal)

    return next(e)
  })

  // Esc reaches the voice: an interrupted ask_by_voice silences the question
  // and ends the recording. The tool's own result passes through untouched.
  on('tool.call', { tool: ASK_BY_VOICE }, ($, e, next) =>
    guardAbort(next.signal, () => next(e), () => void runVoice($, 'stop')),
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { value: shown = IDLE } = await $.state.get(BAND)

    if (e.props.hasSurvey || shown.phase === 'idle') {
      return next(e)
    }

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    // The toolkit's frame (./_brand.tsx) leads the band with its wordmark: that gutter is not the line's.
    const columns = (e.props.bodyColumns || e.viewport?.columns || 80) - BAND_GUTTER_CELLS

    if (shown.phase === 'warning') {
      const room = columns - DISMISS_CELLS

      return (
        <BrandFrame ui={ui} site={e}>
        <Box flexDirection="row" gap={1}>
          <Box flexGrow={1} flexShrink={1}>
            <Text color="warning" wrap="truncate-end">
              {`⚠ ${fit(shown.text, room - 2)}`}
            </Text>
          </Box>
          <Button
            key="voice-dismiss"
            label="Dismiss"
            hotkey="d"
            role="dismiss"
            onPress={() => {
              dismissal.text = shown.text
              void $.state.set(BAND, IDLE)
            }}
          />
        </Box>
        </BrandFrame>
      )
    }

    const isLingering = shown.phase === 'lingering'
    const room = columns - (isLingering ? REPLAY_CELLS : BOTH_CELLS)
    const line =
      shown.phase === 'listening'
        ? shown.heard === ''
          ? '🎙 listening…'
          : `🎙 “${fit(shown.heard, room - 5)}”`
        : `🔊 ${fit(shown.text, room - 3)}`

    return (
      <BrandFrame ui={ui} site={e}>
      <Box flexDirection="row" gap={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text dimColor={isLingering} wrap="truncate-end">
            {line}
          </Text>
        </Box>
        <Button key="voice-replay" label="Replay" hotkey="r" onPress={() => void runVoice($, 'replay')} />
        {!isLingering && (
          <Button key="voice-stop" label="Stop" hotkey="s" variant="primary" onPress={() => void runVoice($, 'stop')} />
        )}
      </Box>
      </BrandFrame>
    )
  })
}

/** `[ Replay ]` and `[ Stop ]` with their gaps, in cells. */
const REPLAY_CELLS = 11
const BOTH_CELLS = 20
const DISMISS_CELLS = 12

/** Polls the runtime's files into `band`, writing only on a change. */
async function startPolling($: EngineInterface, dismissal: { text: string }) {
  const dir = await voiceDir($)

  if (dir === undefined) {
    $.ui.log('bespunky-voice: HOME is unset; the voice band stays down', { to: 'debug' })

    return undefined
  }

  const lastText = cachedText($, `${dir}/last-utterance.txt`)
  const heard = cachedText($, `${dir}/.hearing`)
  const health = healthProbe($, dir)
  let isPolling = false

  /** One `fs.list` per tick; a file's text is read only when it changed. */
  const snapshot = async (now: number): Promise<Snapshot> => {
    const entries: FsEntry[] = await $.fs.list(dir).catch(() => [])
    const of = (name: string) => entries.find(entry => entry.name === name)
    const speaking = of('.speaking.pid')
    const listening = of('.listening.pid')

    return {
      speakingSince: speaking?.mtimeMs,
      listeningSince: listening?.mtimeMs,
      lastText: speaking ? await lastText(of('last-utterance.txt')) : '',
      heard: listening ? await heard(of('.hearing')) : '',
      health: health(entries, now),
      dismissed: dismissal.text,
    }
  }

  return $.clock.every(POLL_MS, () => {
    if (isPolling) {
      return
    }
    isPolling = true
    void (async () => {
      try {
        const now = await $.clock.now()
        const [files, { value: previous = IDLE, version }] = await Promise.all([snapshot(now), $.state.get(BAND)])
        const next = decide(previous, files, now)

        if (JSON.stringify(next) !== JSON.stringify(previous)) {
          await $.state.set(BAND, next, { ifVersion: version })
        }
      } finally {
        isPolling = false
      }
    })()
  })
}

type TextFile = (entry: FsEntry | undefined) => Promise<string>

/**
 * The engines' last verdict from `voice-health.sh`, re-taken in the background
 * when one of HEALTH_INPUTS moved or the verdict is HEALTH_TTL_MS old — the
 * probe runs piper, so it never rides the tick. No runtime script, no verdict:
 * a machine without the voice installed sees nothing.
 */
function healthProbe($: EngineInterface, dir: string) {
  let verdict: VoiceHealth | undefined
  let takenFor = ''
  let takenAt = -Infinity
  let isProbing = false

  return (entries: FsEntry[], now: number) => {
    const inputs = HEALTH_INPUTS.map(name => {
      const entry = entries.find(each => each.name === name)

      return `${name}:${entry?.mtimeMs ?? '-'}`
    }).join(' ')
    const hasScript = entries.some(entry => entry.name === 'voice-health.sh')

    if (!hasScript) {
      verdict = undefined
    } else if (!isProbing && (inputs !== takenFor || now - takenAt >= HEALTH_TTL_MS)) {
      isProbing = true
      takenFor = inputs
      takenAt = now
      void $.process
        .run(['bash', `${dir}/voice-health.sh`], { timeoutMs: 20_000 })
        .then(ran => (verdict = ran.exitCode === 0 ? parseHealth(ran.stdout) : undefined))
        .catch(() => (verdict = undefined))
        .finally(() => (isProbing = false))
    }

    return verdict
  }
}

/** A file's text, re-read only when its mtime or size moved. */
function cachedText($: EngineInterface, path: string): TextFile {
  let stamp = ''
  let text = ''

  return async entry => {
    if (entry === undefined) {
      return ''
    }
    const now = `${entry.mtimeMs}:${entry.size}`
    if (now !== stamp) {
      text = await $.fs.read(path).catch(() => '')
      stamp = now
    }

    return text
  }
}

/** Runs `voice.sh <verb>` fire-and-forget; a failure is a toast naming it. */
async function runVoice($: EngineInterface, verb: Verb) {
  const dir = await voiceDir($)
  const failed = (why: string) => $.ui.toast(brandLine(`Voice ${verb} failed: ${why}`))

  if (dir === undefined) {
    return failed('HOME is unset')
  }
  try {
    const ran = await $.process.run(['bash', `${dir}/voice.sh`, verb], { timeoutMs: 10_000 })
    if (ran.exitCode !== 0) {
      failed(ran.stderr.trim().split('\n').pop() || `exit ${ran.exitCode}`)
    }
  } catch (error) {
    failed(error instanceof Error ? error.message : String(error))
  }
}

/** ~/.claude/bespunky-voice, where the runtime publishes itself and its state. */
async function voiceDir($: EngineInterface) {
  const home = await $.env.get('HOME')

  return home ? `${home.replace(/\/+$/, '')}/.claude/bespunky-voice` : undefined
}

function oneLine(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

/** Cuts `text` to `cells` (at least a few), marking the cut. */
function fit(text: string, cells: number) {
  const room = Math.max(8, cells)
  const chars = [...text]

  return chars.length <= room ? text : `${chars.slice(0, room - 1).join('')}…`
}
