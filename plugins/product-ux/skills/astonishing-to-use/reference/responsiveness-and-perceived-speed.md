# Responsiveness & perceived speed

The interface must feel **instant and alive** — responding the moment a finger touches it, the way the physical world does, and never freezing while it works. Responsiveness is the single most-felt quality of software: instant feels trustworthy and alive; lag feels broken, however beautiful.

## Respond like the real world

- **Instant reaction, always.** Every touch gets an immediate response — a press state, the control moving, *something* — before any work finishes. A tap that does nothing for even a moment reads as broken.
- **Direct manipulation follows the finger 1:1.** If something moves under the user's touch — a draggable card, a sheet, a slider, a swipe — it tracks the finger exactly and has *physicality*: it carries momentum, settles, falls, bounces a little. **Push a bottle and it moves *as your finger moves* and falls — it doesn't teleport or lag.** Motion driven by the user should feel like a real object in their hand, not a delayed playback.
- **Optimistic by default.** Reflect the intended result *immediately* and reconcile with the server after (the like fills in now; the message appears now). The user should rarely wait to *see* the outcome of their own action. (Honest rollback if it fails — `keep-users-oriented`.)

## Never hang the UX

**The interaction thread is sacred — nothing may freeze it.** Any long-running or heavy process is **async or in the background**, always; the user keeps interacting while it works.

- No operation blocks taps, scrolls, or typing — ever. If it's heavy, it runs off the critical path (background task, worker, async) and the UI stays live.
- **Complement with `keep-users-oriented`** — a backgrounded process still answers *expected result / where am I / next step* (progress, estimate, notify), so "non-blocking" never means "silent."
- A frozen UI during a heavy op is a defect, not a wait. (Build-side: `realize`'s performance cluster — off-main-thread, workers, compositor-only.)

## Load instantaneously

- **The app and its modules appear instantly.** Prefer **no splash screen** at all — show the real (skeletal) UI immediately.
- **If a heavy load is truly unavoidable, the splash is highly informative and *live*** — real progress, what's happening right now — never a static logo staring back. (`keep-users-oriented` is gold here.)
- **Lazy-loaded modules react immediately:** the app responds to the tap at once and shows **placeholders/skeletons** (sized to the coming content — see `continuity-and-transitions.md`) or a fitting animation until it arrives. Never a frozen blank or a bare spinner where the real shape could be previewed.

## Make it *feel* instant

Perceived speed beats raw speed: skeletons, instant transitions, optimistic UI, and **preloading the likely next screen/data** make a thing feel immediate even while real work happens behind it.

## Pitfalls

- **A tap that does nothing** for a beat — no acknowledgement.
- **Dragged things that lag the finger** or animate on a fixed timeline instead of tracking touch.
- **A blocked UI** during a heavy/long process instead of async/background.
- **A static splash screen**, or a splash at all where the skeletal UI could show instantly.
- **A bare spinner / frozen blank** for a lazy module instead of a sized placeholder.
- **Waiting on the server to show the user their own action** instead of optimistic UI.
