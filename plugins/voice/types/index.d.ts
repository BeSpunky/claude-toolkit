// bespunky-voice — the voice band's state contract.
//
// The band (hooks/band.tsx) is a VIEW over the voice runtime's state files; its
// poller folds them into ONE session value, and the drawing reads only that, so
// a redraw happens exactly when what the band shows changes. Declared here, in
// the plugin's contract, because `$.state` values are typed by the owner's
// `PluginState` entry and anyone may read them (another plugin wanting to know
// "is Claude speaking right now?" reads this, never the files).

/**
 * What the voice band shows, one phase at a time.
 *
 * - `idle`      nothing is said or heard: the band draws nothing of its own.
 * - `speaking`  an utterance is playing; `text` is what is being said.
 * - `listening` a recording is open; `heard` is the transcript so far ('' before
 *               any words).
 * - `lingering` speech just ended; `text` stays up (dimmed, Replay only) until
 *               `until` (ms since the epoch), so the person can still catch it.
 * - `warning`   nothing is said or heard, and an engine will let the person
 *               down (VoiceHealth); `text` says which, until it is dismissed.
 */
export type VoiceBand =
  | { phase: 'idle' }
  | { phase: 'speaking'; text: string }
  | { phase: 'listening'; heard: string }
  | { phase: 'lingering'; text: string; until: number }
  | { phase: 'warning'; text: string }

/**
 * The voice engines' health, as the runtime's `voice-health.sh` reports it —
 * the band never judges an engine itself.
 *
 * - `tts`: which engine will actually speak — `natural` (Piper works), `broken`
 *   (Piper is installed but fails, so speech falls back to the robotic voice),
 *   `robotic` (no Piper; espeak-ng), `system` (macOS say), `none`.
 * - `stt`: whether ask_by_voice can hear — `ok`, `broken` (whisper-cli is there
 *   but cannot run), `missing`.
 */
export type VoiceHealth = {
  tts: 'natural' | 'broken' | 'robotic' | 'system' | 'none'
  stt: 'ok' | 'broken' | 'missing'
}

declare module 'claude-code' {
  interface PluginState {
    'bespunky-voice': { band: VoiceBand }
  }
}
