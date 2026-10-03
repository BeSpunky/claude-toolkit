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
 */
export type VoiceBand =
  | { phase: 'idle' }
  | { phase: 'speaking'; text: string }
  | { phase: 'listening'; heard: string }
  | { phase: 'lingering'; text: string; until: number }

declare module 'claude-code' {
  interface PluginState {
    'bespunky-voice': { band: VoiceBand }
  }
}
