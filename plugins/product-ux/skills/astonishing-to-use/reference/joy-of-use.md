# Joy of use

The difference between *usable* and *astonishing*. Removing friction and confusion gets you to "not annoying" — a floor, not the goal. Astonishing-to-use means the use itself feels **good**: fast, responsive, satisfying, anticipatory, even quietly delightful. This is the bar this whole skill holds, and the thing most UX work stops short of.

## Speed is a feeling

- **Responsiveness is the #1 felt quality.** Instant reaction to every touch makes software feel alive and trustworthy; lag makes it feel broken, however pretty. Acknowledge every input *immediately* (even before the work finishes).
- **Perceived speed beats raw speed.** Optimistic UI (show the result now, reconcile later), skeleton/instant transitions, and doing slow work in the background make a thing *feel* fast. (Build-side: `realize`'s performance cluster — snappiness is UX, not polish.)
- **Never make them wait without reason**, and when a wait is real, make it honest and oriented (`keep-users-oriented`).

## Satisfying feedback

- **Every action lands** with a clear, immediate, proportionate response — a state change, a subtle motion, a sound or haptic where it fits. The system *answers*.
- **Micro-interactions that help**, not decorate: the toggle that snaps, the pull-to-refresh that gives, the validation that reassures the instant it's right. They confirm and guide; they don't perform.
- **Momentum and continuity** — smooth, physical-feeling motion (real easing, things that come from and go somewhere) makes use feel fluid rather than jumpy. (This is where `stage`'s motion craft and UX meet — motion that *aids* use is joy; motion that *gates* use is the tax.)

## Action → reaction — give every meaningful action a fitting response

A meaningful action deserves a response that *fits its meaning*, not just a generic state flip — a small moment that confirms, rewards, and delights:

- A **like** can bloom the thumb, or throw a little confetti.
- **Switching language** can dissolve the old text and refocus it as the new translations settle in, rather than a hard, jarring swap.
- **Completing** can celebrate briefly; **deleting** can sweep the item away; **sending** can launch it off.

These are *examples* — extrapolate: for each meaningful action ask *"what reaction would make this feel acknowledged and good?"* The reaction must be **proportionate** (small action → small delight), **fast** (never delaying the next action), and **survive repetition** (still pleasant on the hundredth tap — never impress-once-annoy-forever; see `reconciling-art-and-use.md`). The artful *form* of the reaction is `stage-the-vision`'s to design; that one *exists and fits* is UX.

## Anticipation & flow

- **Be one step ahead** — surface the likely next action, preload the next screen, focus the next field. When software seems to read intent, use feels effortless.
- **Protect flow state** — no needless interruptions, context switches, or confirmations breaking concentration. Let momentum build.
- **The feeling of mastery** — the design makes the user feel *capable* and in control, fast and fluent, never stupid or stuck. That feeling is what they remember and return for.

## Delight that earns its keep

- The best delight is **functional delight** — the moment that's charming *and* does a job (a playful empty state that also tells you what to do; a celebratory confirmation that also reassures the action worked).
- It must survive **repetition** — joy on the hundredth use, not just the first (the opposite of impress-once-annoy-forever: `reconciling-art-and-use.md`).
- Restraint still rules — joy is in *quality and fit*, not quantity. One perfectly-judged satisfying moment beats ten clamoring ones.

## The joy test

Beyond "could they use it?" — **did using it feel good?** Fast, responsive, anticipatory, satisfying, leaving them feeling capable? If it's merely inoffensive, it hasn't cleared the bar.

## Pitfalls

- **Stopping at "not annoying"** — friction removed, but the use is flat and lifeless.
- **Lag tolerated** — slow responses excused because the visuals are nice.
- **Decorative micro-interactions** — animation that performs instead of confirming/guiding, adding delay.
- **First-run delight only** — charming once, tiresome forever.
- **Delight as quantity** — piling on effects instead of judging one well.
