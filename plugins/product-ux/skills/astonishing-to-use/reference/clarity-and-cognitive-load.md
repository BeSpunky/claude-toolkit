# Clarity & cognitive load

Is it understandable? At every moment the user should know **what this is, what they can do, and what will happen** — without stopping to figure it out. Thinking is effort; confusion is friction of the worst kind. Astonishing-to-use design is *obvious*.

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
