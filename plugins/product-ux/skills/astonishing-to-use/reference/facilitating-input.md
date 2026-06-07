# Facilitating input

The principle: **for every piece of data the user must enter, think hard about the *experience of entering it* — and design (even invent) the control that makes it the most frictionless and delightful for *that* data type.** Don't reach for the default widget by reflex. The standard control is often quietly painful, and the genius move — our art — is to invent a better one, even one the world hasn't seen.

## Think about the data, not the default control

- **Start from the data and how it's used**, not "what control usually holds this." A date, a date *range*, a duration, a quantity, a location, a colour, a rating, a money amount — each has its own natural, low-friction way to be entered, and it's often not the conventional widget.
- **Interrogate the friction of the obvious control — tap by tap.** Walk the real gestures. "A date range has a calendar component," but selecting two dates on a calendar is fiddly. "A number has a text box," but tapping it, selecting the digits already there, fighting the cursor, deleting the wrong digit on a cramped field — that is real, felt pain. Feel what the user feels at each touch.
- **Design for the common *adjustment*, not just raw entry.** Often the user isn't entering from scratch — they're *nudging* (a range a bit later, a value near the current one). Make the frequent small adjustment effortless, not just the first-time entry.

## Invent the control when the data deserves it

When no existing control is good enough, **invent one tailored to the data.** This is where UX and the artistic genius of `stage-the-vision` meet: a novel control is both a usability solution *and* an artful, memorable moment — ping-pong them (`reconciling-art-and-use.md`).

*Worked illustration — entering a date range. These are examples of the **thinking**, to provoke your own inventions — not controls to copy:*

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
- **Novelty for its own sake** — a control that's cool but harder, undiscoverable, or inaccessible (the gimmick trap — validate it).
- **Inaccessible invention** — a beautiful custom control with no keyboard path, no labels, no fallback.
- **Treating these illustrations as a kit** — installing a "day joystick" instead of doing the thinking for *your* data type.
