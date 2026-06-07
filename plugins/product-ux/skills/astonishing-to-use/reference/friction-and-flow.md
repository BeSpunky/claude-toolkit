# Friction & flow

Does it make life easy? Every tap, scroll, decision, field, and wait the user must get through is a **cost** they pay to reach their goal. Astonishing-to-use design relentlessly lowers that cost — the path to what they came for is short, direct, and unobstructed. "Through hoops" is the failure this prevents.

## Effort is the currency — spend the user's, not yours

- **Count the cost to the goal.** From arrival to done, how many taps, screens, scrolls, decisions, and fields? Each is friction. The astonishing version has the fewest that still make sense — and you *feel* the difference.
- **The user's effort is more expensive than yours.** Doing work *for* them (pre-filling, detecting, defaulting, remembering) is almost always worth the build cost. Make the machine work so the human doesn't.
- **Remove, don't reorganize.** The first move on a flow is to *delete* steps, not tidy them. The fastest step is the one that isn't there.
- **It must not even *look* tiring.** People judge effort at a glance: a wall of fields, a long form, a five-step wizard makes them think *"this is going to be tiring — I'm out"* and leave before starting. Make the process look short and feel light, not just *be* short — show only what's needed now, chunk honestly, and let it breathe.

## The direct path

- **Name the one thing the user came to do** on each screen, and make it the shortest, most obvious route. Everything else is secondary and should look it.
- **No detours.** Interstitials, "are you sure?", forced tours, account-walls before value, modals stacked on modals — each is a hoop. Remove or defer every one that isn't truly necessary.
- **Don't make them hunt.** The next action is visible and reachable where they'd expect it, not buried behind a menu, a hover, or a scroll.

## Smart defaults & anticipation

- **Sensible defaults** that are right for most users mean most users do nothing. Default to the common case; let the rare case override.
- **Anticipate the next need** and have it ready (the likely next field focused, the probable action pre-surfaced, the data already loaded).
- **Remember, don't re-ask.** Never make the user supply what you already know or could derive.

## Progressive disclosure

- Show what's needed *now*; reveal complexity only when asked. A simple surface over deep capability beats a wall of every option at once.
- But never hide the *primary* path to make the surface look clean — clean is not the goal; effortless is.

## Forms & input (where friction concentrates)

- Ask for the **least** that achieves the goal; every field is a chance to lose them.
- Right input types and keyboards; inline, forgiving validation; clear recovery; no re-entry on error. When validation *does* fail, be informative and carry the user to the problem — `errors-and-recovery.md`.
- Break long flows into honest, visible steps (and see `keep-users-oriented`).

## Choose the lowest-friction control for the data

The *control* matters as much as the field count. A native **select box is high friction for a short list** — click to open, wait, scan a hidden menu, move, click again: four costed actions, all concealed until opened. When the options are few, prefer controls where **every choice is visible and one tap away**:

- **Few options (≈2–6)** → chips, toggles, segmented controls, radio buttons — visible and immediately clickable, zero reveal step.
- **Many options** → search / typeahead, not an endless scroll-and-hunt menu.
- **A range** → a slider or stepper; **a date** → a date picker; **on/off** → a switch; **a number** → a stepper with a typeable field.
- **Match the control to the data and the context**, choosing for *least friction*, not habit. The goal: the user sees their choices and acts at once, never operates a control to *discover* what's inside it.
- **When no existing control is low-friction enough for the data, *invent* one.** Choosing the best widget is the floor; designing — or inventing — a control tailored to the data type (and the way the world hasn't seen) is the ceiling. See `facilitating-input.md`.

## The flow test

Walk one real person from intent to done. Mark every place they have to **work, wait, decide, or backtrack**. Each mark is friction to remove or justify. If the path has hoops, it fails — no matter how it looks.

## Pitfalls

- **Counting your build effort instead of their use effort** — shipping a step because it was easy to build.
- **Reorganizing a maze instead of deleting it.**
- **Value-gating** — walls (signup, tours, consent) before the user gets anything.
- **Clean over effortless** — hiding the primary action to make the screen pretty.
- **Over-asking** — fields, confirmations, and decisions the flow doesn't need.
