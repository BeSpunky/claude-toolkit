// bespunky-voice — the VOICE BAND: one row above the prompt that says what is
// being said (🔊) or heard (🎙) right now, with Replay (r) and Stop (s).
//
// WHY IT IS A VIEW OVER STATE FILES. The audio does not live in the engine: an
// utterance is a detached process group started by speaker.sh, a recording is
// listen.sh's parecord, and either may be started by a command hook, the
// /voice command or the ask_by_voice MCP server — three separate processes,
// none of them this module. The runtime therefore publishes the truth as files
// under ~/.claude/bespunky-voice/ (`.speaking.pid` + `last-utterance.txt`,
// `.listening.pid` + `.hearing`), and the band only READS them: a poller folds
// them into one `$.state` value (types/index.d.ts) and the drawing reads that,
// so it redraws exactly when what it shows changes. Its two buttons and its
// Esc hook act through the runtime's own front door (`voice.sh stop|replay`),
// never by touching a process themselves.
//
// THE PLUGIN WORKS WITHOUT IT. Speaking, listening, /voice stop and replay are
// all command hooks, a command and an MCP tool; with mods disabled (or on a
// build without them) those remain the floor and nothing here is missed but
// the view. Never put behaviour here that the floor needs.

import type { EngineInterface, FsEntry, Register } from 'claude-code'

import type { VoiceBand } from '../types/index.d.ts'

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

  return IDLE
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

  on('session.start', async ($, e, next) => {
    poller?.cancel()
    poller = await startPolling($)

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

    const { Box, Button, Text } = $.ui.resolve(e)
    const isLingering = shown.phase === 'lingering'
    const room = (e.props.bodyColumns || e.viewport?.columns || 80) - (isLingering ? REPLAY_CELLS : BOTH_CELLS)
    const line =
      shown.phase === 'listening'
        ? shown.heard === ''
          ? '🎙 listening…'
          : `🎙 “${fit(shown.heard, room - 5)}”`
        : `🔊 ${fit(shown.text, room - 3)}`

    return (
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
    )
  })
}

/** `[ Replay ]` and `[ Stop ]` with their gaps, in cells. */
const REPLAY_CELLS = 11
const BOTH_CELLS = 20

/** Polls the runtime's files into `band`, writing only on a change. */
async function startPolling($: EngineInterface) {
  const dir = await voiceDir($)

  if (dir === undefined) {
    $.ui.log('bespunky-voice: HOME is unset; the voice band stays down', { to: 'debug' })

    return undefined
  }

  const lastText = cachedText($, `${dir}/last-utterance.txt`)
  const heard = cachedText($, `${dir}/.hearing`)
  let isPolling = false

  return $.clock.every(POLL_MS, () => {
    if (isPolling) {
      return
    }
    isPolling = true
    void (async () => {
      try {
        const files = await snapshot(dir, lastText, heard)
        const [now, { value: previous = IDLE, version }] = await Promise.all([$.clock.now(), $.state.get(BAND)])
        const next = decide(previous, files, now)

        if (JSON.stringify(next) !== JSON.stringify(previous)) {
          await $.state.set(BAND, next, { ifVersion: version })
        }
      } finally {
        isPolling = false
      }
    })()
  })

  /** One `fs.list` per tick; a file's text is read only when it changed. */
  async function snapshot(dir: string, last: TextFile, hearing: TextFile): Promise<Snapshot> {
    const entries: FsEntry[] = await $.fs.list(dir).catch(() => [])
    const of = (name: string) => entries.find(entry => entry.name === name)
    const speaking = of('.speaking.pid')
    const listening = of('.listening.pid')

    return {
      speakingSince: speaking?.mtimeMs,
      listeningSince: listening?.mtimeMs,
      lastText: speaking ? await last(of('last-utterance.txt')) : '',
      heard: listening ? await hearing(of('.hearing')) : '',
    }
  }
}

type TextFile = (entry: FsEntry | undefined) => Promise<string>

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
  const failed = (why: string) => $.ui.toast(`Voice ${verb} failed: ${why}`)

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
