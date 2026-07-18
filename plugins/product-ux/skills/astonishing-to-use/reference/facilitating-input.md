# Facilitating input

The principle: **for every piece of data the user must enter, think hard about the *experience of entering it* — and design (even invent) the control that makes it the most frictionless and delightful for *that* data type.** Don't reach for the default widget by reflex. The standard control is often quietly painful, and the genius move — our art — is to invent a better one, even one the world hasn't seen.

## Think about the data, not the default control

- **Start from the data and how it's used**, not "what control usually holds this." A date, a date *range*, a duration, a quantity, a location, a colour, a rating, a money amount — each has its own natural, low-friction way to be entered, and it's often not the conventional widget.
- **Interrogate the friction of the obvious control — tap by tap.** Walk the real gestures. "A date range has a calendar component," but selecting two dates on a calendar is fiddly. "A number has a text box," but tapping it, selecting the digits already there, fighting the cursor, deleting the wrong digit on a cramped field — that is real, felt pain. Feel what the user feels at each touch.
- **Design for the common *adjustment*, not just raw entry.** Often the user isn't entering from scratch — they're *nudging* (a range a bit later, a value near the current one). Make the frequent small adjustment effortless, not just the first-time entry.
- **Let the modality drive the control, not just the data type.** The same value wants a different control depending on *how it's entered*: a **finger** on a phone (fat-target, gesture-friendly, thumb-reachable — a drag or a wheel beats a cramped number box), a **mouse** in a browser (precise clicks, hover, scroll-to-adjust), **voice** (speak "next Tuesday" — parse it, don't force a calendar), a **stylus**, a **keyboard** power-user (type-ahead, arrow-nudge). Ask *who enters this, on what, with what,* and pick the control that fits that hand and that context — the best control for the task, never the common one by reflex.

> **Concepts come first.** This cluster chooses the *control* for a value you've already decided to collect. Deciding *which values to collect and in what shape* — a temperature **range** + mode + power rather than two threshold rules, a **payee** rather than routing+account numbers — is the semantic layer upstream, `bespunky-product-ux:model-intent-not-data`. Get the concepts right there; render each one frictionlessly here.

## Invent the control when the data deserves it

When no existing control is good enough, **invent one tailored to the data.** This is where UX and the artistic genius of `stage-the-vision` meet: a novel control is both a usability solution *and* an artful, memorable moment — ping-pong them (`reconciling-art-and-use.md`).

**Invention is conceptual, not cosmetic.** It is *not* about sizes, positions, or rearranging the same widgets — it is about a whole *concept* built around the value, drawn from what that value *is* in real life. The question that unlocks it is always **context: what are we actually asking the user for, and how does it relate to life itself?** The closer the control mirrors the real-world object, gesture, or experience the value comes from, the less there is to learn — the user already knows how the real thing behaves, so the control needs no instructions.

*Illustrations of the leap — each a different real-world metaphor, not a reskinned slider:*

- A **time of day** → a clock face with **draggable hands**, not a text field — you *set the time* the way you'd set a wall clock.
- A **volume, level, or intensity** → a **knob you turn**, the way every amplifier and stove already taught the hand.
- A **send / transfer / hand-off across a boundary** → an object you **fling or throw** from one side of the screen to the other (a file to a device, money to a person) — the gesture *is* the meaning.
- A **heat / charge / amount you build up** → a button that **fills while you hold it down** and stops when you release — press longer, get more, exactly like holding a kettle's boost or a spray trigger.

Each borrows a *mental model the user already owns* from lived experience — a clock, a dial, a throw, a press-and-hold. That is the move: don't decorate a standard control, reach for the metaphor the value already lives inside and make it real. (The input-side of `envision-the-experience`'s "a menu might become a sunflower whose petals you pick.")

*Worked illustration — a friction-nudge flavour, entering a date range. These are examples of the **thinking**, to provoke your own inventions — not controls to copy:*

- A **day-count** two-way-bound to the range (change the count → the range moves; move the range → the count updates). But a raw number box is painful (above), so don't stop there — make changing the count itself pleasant:
  - A **pull-to-adjust handle that springs back to centre** — pull one way to add days (until released), the other to subtract; it returns to centre. Adjusting feels physical and continuous: no typing, no cursor.
  - A **ring of nearby preset counts** — if the value is 30, then 25 / 20 / 35 sit one tap away; tap 25, the presets re-centre on 25, tap 20… click-click-click and you're there.
- A **slider sitting above the start/end dates** that shifts the *whole range* in the dragged direction and springs back to centre on release — for "same length, a bit later."

The point is the *move*: feel the friction of entering this specific data, then design — or invent — the control that dissolves it. Extrapolate the **thinking** to any data type; these particular controls are just illustrations of it.

## Validate the invention — don't ship a gimmick

A novel control still has to be **astonishing to *use*,** not merely new. Run it back through this skill: is it instantly understandable (or learnable in one try)? genuinely lower-friction than the standard? discoverable? accessible (keyboard, screen reader, motor, reduced-motion)? does it stay good on the hundredth use? A clever control that confuses or excludes is worse than a boring one that works. **Invention serves the use; it never replaces it** — and an invented control always needs an accessible path and an honest fallback.

## Pitfalls

- **Reflex control** — dropping in the default widget (calendar, text box, select) without ever feeling the friction of using it for *this* data.
- **Raw-entry tunnel vision** — optimizing first-time entry while ignoring the common case of *adjusting* an existing value.
- **Cosmetic "invention"** — resizing, repositioning, or restyling the same widget and calling it a new control, instead of a genuinely different *concept* drawn from the value's real-world life (a clock, a knob, a throw, a press-and-hold).
- **Metaphor that doesn't fit the value** — borrowing a real-world control because it's charming, not because it matches what's being asked (a turnable knob for a yes/no; a throw for a precise number). The metaphor must be the one the value actually lives inside.
- **Novelty for its own sake** — a control that's cool but harder, undiscoverable, or inaccessible (the gimmick trap — validate it).
- **Inaccessible invention** — a beautiful custom control with no keyboard path, no labels, no fallback.
- **Treating these illustrations as a kit** — installing a "day joystick" instead of doing the thinking for *your* data type.
