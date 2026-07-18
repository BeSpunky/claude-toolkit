# Sound & haptics

The senses past sight. A world can *sound* like somewhere and *feel* like something in the hand. Used with restraint and consent, sound and haptics deepen immersion more than another visual effect ever could. Used carelessly, they're the fastest way to make someone close the tab. Reach for them only when the feeling genuinely calls, and always on the user's terms.

## The means

| Means | What it's for | Strengths | Cost / caveats |
| --- | --- | --- | --- |
| **Web Audio API** | Designed sound — ambient beds, interaction cues, spatial/positional audio, reactive/generative sound | Precise timing, mixing, effects, 3D panning; the real tool for sound design | Requires a user gesture to start (autoplay policy); you manage the audio graph & lifecycle |
| **HTML `<audio>`** | Simple playback of a clip/track | Trivial; built-in controls | No mixing/timing control; not for layered design |
| **Vibration API** (`navigator.vibrate`) | Haptic taps/patterns on supported mobile | Adds physical feedback to touch moments | **Android/Chromium mostly; iOS Safari does not support it**; ignored on desktop; easy to overuse |
| **Audio sprites / howler-style libs** | Managing many short sounds efficiently | Sprite loading, pooling, cross-browser smoothing | A dependency; justify the weight |

## When sound/haptics serve the feeling

- **Ambient presence** — a soft room tone, distant nature, a low hum that makes a place feel inhabited (a meditation app, a game world).
- **Tactile confirmation** — a gentle click/tick or a haptic tap that makes an action feel *real* (picking a sunflower petal, completing a step).
- **Reward and arc** — a chime at a milestone, a swell at a climactic moment — reinforcing the emotional arc the Vision describes.
- **Reactive audio** — sound that responds to interaction/scroll/state, binding the senses together.

## Caveats & footguns — consent first, always

- **Never autoplay sound.** Browsers block it and users hate it. Audio starts on an explicit user gesture, and the user must know it's coming.
- **Default to silence; offer sound.** Provide an obvious, persistent mute/unmute, remember the choice, and start muted unless the user opted in. Sound is an invitation, never an ambush.
- **Respect the context** — people browse in offices, libraries, beside sleeping kids, at night. Surprise audio is a real harm to trust.
- **Accessibility:** never convey *essential* information by sound alone (Deaf/hard-of-hearing users) — pair it with a visual/text equivalent. Sound is reinforcement, not the sole channel.
- **Haptics:** feature-detect (`'vibrate' in navigator`); it silently does nothing on iOS and desktop, so never make meaning depend on it. Keep patterns short and gentle — buzzy overuse is irritating and drains battery. Honor reduced-motion/quiet intent as a signal to ease off.
- **Performance & weight:** audio assets add bundle and memory; lazy-load, compress, pool short sounds, and dispose the audio graph on teardown.
- **Lifecycle:** suspend/resume the `AudioContext` on tab visibility changes; stop sounds when leaving the scene.

## On the house stack (Angular / Nx)

- Wrap the **`AudioContext`/audio graph** in a service (`bespunky-engineering:angular-native-wrappers`): own creation behind a user gesture, expose a small play/mute API, run scheduling `outside` Angular, and dispose on destroy.
- Keep a single **sound-preference signal/service** (muted? opted-in?) the whole app honors — like the reduced-motion signal — so consent is enforced by design, not per component.
- Lazy-load audio assets with the immersive feature's Nx boundary; don't tax first load.

## When NOT to

- When the app lives in **sound-hostile contexts** (work tools, anything used in public/quiet settings) — silence is the respectful default.
- When sound/haptics would be **decoration, not meaning** — another effect that serves itself, not the feeling (`architect-mentality` — know when not to).
- When it can't be done **with real consent and a reliable mute** — then don't ship it.

## The rule

**Sound and touch are the most intimate senses you can reach — and the most violating if taken without consent.** Earn them from the feeling, deliver them on the user's terms, and make silence the safe default. Done right, they're the deepest immersion there is.
