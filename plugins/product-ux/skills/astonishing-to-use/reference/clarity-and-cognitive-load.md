# Clarity & cognitive load

Is it understandable? At every moment the user should know **what this is, what they can do, and what will happen** — without stopping to figure it out. Thinking is effort; confusion is friction of the worst kind. Astonishing-to-use design is *obvious*.

## Calm by default — the screen reads in one glance

A screen can be perfectly labelled, perfectly hierarchical *per element*, and still **exhaust** the user — because too much is asking to be read *at once*. The felt experience of clutter is a stream of involuntary questions: *should I read this? and that? am I missing something if I don't? is that button important? what does that circle do?* Each one is a micro-decision the design failed to make *for* the user. **Calm is the resting state of a great app; density is earned, never the default.** A real app is easy to read — never a cockpit of competing labels, dots, and controls.

- **One thing to attend to first, and the eye knows it.** Not just one primary *action* (below) — one primary *thing to read*. Everything else is visibly ranked: clearly secondary, or clearly ambient. The user should never have to *survey* the screen to find where to look.
- **Every visible element declares whether it matters.** If it's on screen, its importance must be legible at a glance — essential reads as essential, optional as optional, ambient as ignorable. The anxiety of "am I missing something?" is the signal this failed: the design left the triage to the user.
- **No element of ambiguous purpose.** "What does that circle do?" is a defect, not a charming mystery. Every shape that draws the eye must be self-evidently *something* — a control, a piece of content, or plainly decoration — never an undecodable token the user must stop and decode. A pretty dot that means nothing is clutter wearing the costume of intent.
- **Show this moment's job; let the rest recede or wait.** Progressive disclosure isn't only for *choices* — it's for *everything not needed now*. Collapse, defer, or quiet whatever this moment isn't about. The full feature set on one screen proves nothing; the legible moment is the product.
- **The calm test.** Beyond the five-second clarity test below: glance at the screen and watch your *own* reaction. If it's "wait — what am I meant to look at? do I need to read all this? what are these for?", the screen is cluttered, however beautiful or well-labelled each part is. A calm screen answers "where do I look" *before* you ask.

## Never make them think

- **Self-evident, not just learnable.** The best interfaces don't need to be taught — meaning, affordance, and consequence read at a glance. If you have to explain it, the design is doing too little.
- **Recognition over recall.** Show the options; don't make people remember them. Let them choose from what's visible rather than retrieve from memory (menus over memorized commands, visible state over hidden modes).
- **Reduce choices to the relevant.** Every option on screen is a decision you've handed the user. Surface the few that matter now; defer the rest.

## One primary action per screen

- Each screen has a clear **protagonist** — the main thing to do — and it's visually dominant. Secondary actions are present but quieter; tertiary ones are tucked away.
- Competing equal-weight buttons force a decision the user shouldn't have to make. Establish a hierarchy of actions, always.

## Affordances & signifiers

- Things that are tappable **look** tappable; things that aren't, don't. Buttons look like buttons; links like links. Don't make the user probe to discover what's interactive (a special hazard when art flattens everything into beautiful sameness — see `reconciling-art-and-use.md`).
- **State is visible** — selected, disabled, loading, error, empty. The user never wonders "did that work?" (see `keep-users-oriented`).

## Words are UI

- **Honest, plain labels** in the user's language, not the system's or the brand's cleverness. Clever-but-ambiguous copy is a clarity bug.
- **A button's label names the *exact* effect of pressing it *now*, at *this* step** — not the eventual goal, not the next screen, not a generic verb. "Pay £20" belongs **only** on the button that *actually charges the card* — not the checkout button that goes to choose a payment method, and not the one that opens a confirmation page. Buttons that merely *navigate* name their destination ("Choose payment", "Review order", "Next: shipping"); the button that *commits the action* names exactly what it commits. As the effect changes down a flow, the labels change with it.
- **Be unmistakable at the point of no return.** For consequential or irreversible effects — charging, sending, deleting, publishing, booking — the label must make the effect plain *before* the click ("Pay £20", "Place order", "Delete 3 files permanently", "Publish now", "Send to 200 people"), so the user acts with **informed consent** and is never surprised by a charge, a send, or a deletion they thought was just "Continue". The general rule: the label is a *promise of the immediate consequence*; over-promising (a committing verb on a navigation step) alarms, under-informing (a vague verb on a committing step) betrays.
- **Match the user's mental model**, not the database schema or the org chart. Name things as the user thinks of them.

## Information architecture

- Group and order by the user's tasks and expectations, not internal structure. Findable beats comprehensive.
- Consistent patterns: the same thing works the same way everywhere, so learning one screen teaches the rest (`architect-mentality` — one mental model).

## The clarity test

Show a screen to someone for five seconds: can they say what it is, what they'd do next, and what will happen? Hesitation is a clarity defect.

## Pitfalls

- **Mystery-meat interactives** — beautiful elements that give no hint they're tappable.
- **Two co-equal primary buttons** — no hierarchy, forced deliberation.
- **Clever copy over clear copy** — brand voice that obscures function.
- **A label that promises more or less than the click does** — "Pay" on a step that only navigates, or "Continue" on the step that actually charges, sends, or deletes. The label must match the exact effect of *this* click.
- **Schema-shaped UI** — labels and groupings that mirror the backend, not the user.
- **Hidden state** — no feedback on selection, loading, error, or empty.
- **Choice overload** — every option shown at once because cutting felt risky.
- **Equal-weight everything** — a field of elements at the same visual importance, so the user must read each to learn which matter; the screen does no triage and hands its cognitive load to the user.
- **Decorative tokens that read as controls** — ambient dots/shapes/glows placed where the eye expects meaning, so attention is wasted decoding what does nothing ("what does that circle do?").
