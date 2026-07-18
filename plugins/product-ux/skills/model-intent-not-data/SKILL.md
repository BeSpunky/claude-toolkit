---
name: model-intent-not-data
description: Model the user's INTENT on the way in and their DECISION on the way out - never mirror the system's data shape into the interface. Use whenever you design or evaluate any input or output - a form, a field, a filter, settings, a search/query builder, a control, an intake; and a dashboard, chart, report, results list, summary, readout, or status. The core move - CLOSE THE GAP between the system's data representation and what the human means/needs, so the machine pays the translation tax, not the user. Two mirrored failures - INPUT that makes the user COMPILE their intent into your schema (an AC remote asking for "an action below a threshold and another action above a threshold" instead of a temperature RANGE + mode + power; a reminder form exposing raw iCal freq/interval/byday; a transfer asking routing + account numbers instead of "pay Shir"), and OUTPUT that makes the user DECOMPILE your data into a conclusion (an hourly temp/humidity/precip table instead of "umbrella after 3pm, grab a jacket"; a spend-by-category bar chart instead of "on pace to overspend dining by $80 - skip two takeouts"). The two tells - on input, the user must do arithmetic or reasoning in their head to translate what they want into what the form demands; on output, the user must stare and infer "so what / what do I do?". NOT "always simplify or hide" - faithful-to-intent can COLLAPSE (two threshold rules -> one range) or ENRICH (add the mode and power the raw model omitted); the test is fidelity to the real task, not minimalism. This skill is the SEMANTIC layer - it decides WHAT concepts to ask for and in what shape, and WHAT conclusion to deliver; it hands off to bespunky-product-ux:astonishing-to-use (facilitating-input) for WHICH control renders each value (default to the best control not the common one, invent one, account for finger/mouse/voice/phone). An expression of architect-mentality - model the missing concept, design for the consumer, build for the goal not the brief, concentrate complexity so the edges stay simple.
---

# Model Intent, Not Data

Developers and LLMs think data-first: they read the storage schema, the API shape, or the config format, and render it straight onto the screen — a field per column, a chart per table. The interface becomes a **window onto the database** instead of a tool for a human. The result feels technical, demands too much thought, leaves the user to connect the dots, and makes their life harder instead of easier.

**This skill is one principle, mirrored on both ends of the interface:**

- **On the way in** — don't make the user *compile* their intent into your schema.
- **On the way out** — don't make the user *decompile* your data into a conclusion.

The single idea underneath: **close the gap between the system's data representation and what the human actually means or needs — and make the machine pay the translation tax, not the user.** The user thinks in intents and decisions; the system stores rows and fields; every step of translation you leave on the user's side is friction, confusion, and thinking they shouldn't have to do.

The classic tell, twice:

- **Input** — the user has to do arithmetic or reasoning *in their head* to turn what they want into what the form demands.
- **Output** — the user has to stare at the screen and infer *"so what? what do I do?"* — the answer is in there, but they have to extract it.

If either is true, it isn't finished, however clean the schema or how correct the plot.

---

## It is NOT "always simplify or hide"

The move is **fidelity to the real task**, not minimalism — and faithful modeling cuts both ways:

- Sometimes it **collapses** the data model. Two threshold-and-action rules become one dual-bound temperature *range*: fewer inputs, less thinking.
- Sometimes it **enriches** past the data model. The same air-conditioner task really has a *mode* (heat/cool) and a *power* (low/mid/high) the raw "action + threshold" schema never named — so the honest intake has *more* concepts, not fewer.

Both are the same act: **model the concepts the user's task actually has**, at the shape they actually think in — then collapse or enrich as fidelity demands. Minimalism that drops a concept the user needs is as wrong as a schema-dump that exposes one they don't.

This is `architect-mentality` **model the missing concept**: if the task has a "mode" and your data model has no field for it, that absence *is* the bug — name the concept, don't make the user simulate it with thresholds.

---

## Input — model the intent, not the schema

Ask: **what is the user actually trying to express, and in what shape do they think about it?** Then build the intake around *that*, and let the system derive the storage rows behind it.

The worked example — **the air-conditioner remote:**

- **Data-first (bad):** "Choose an action (on/off) for below a temperature, and an action for above a temperature." The user has to mentally model the control loop, pick thresholds, and reason about what the two rules combine to *do*. It's the thermostat's internal state machine, shoved onto the screen.
- **Intent-first (good):** a **dual-bound temperature range** (keep the room *between* X and Y) — the shape the user already thinks in — plus **mode** (heat / cool) and **power** (low / mid / high) as first-class choices. The app does the reasoning that turns "between X and Y in cool mode" into on/off rules.

More, across domains — each shows the schema *leaking* into the form, and the intent-shaped fix:

| Task | Data-first (the schema leaks) | Intent-first (the user's shape) | What leaked |
| --- | --- | --- | --- |
| AC schedule | action + threshold, ×2 | temperature **range** + mode + power | the control-loop state |
| Recurring reminder | freq, interval, byday[] | "**Every 2 weeks on Mon & Wed**" builder | the iCal RRULE spec |
| Pay a person | routing #, account #, amount, memo | pick a **payee** → amount | the banking rails |
| Book a trip | two separate date pickers | one **range** calendar (can't return before you leave) | two DB columns |
| Permissions | resource × action checkbox matrix | **roles** (Viewer / Editor / Admin) + an "Advanced…" escape hatch | the ACL table |
| Sleep log | bedtime, wake, minutes-to-fall-asleep, # awakenings | the two anchors; **derive** the rest | fields that are outputs, not inputs |

The pattern is always the same: **find the concept the user holds in their head, give it a shape that matches, and move the translation into the system.** A range is a range, a recurrence is a recurrence, a person is a person — not a decomposition of them into the columns you happen to store.

Two recurring smells:
- **Derived values asked as inputs.** If the system can compute it from what the user already gave, don't ask for it (sleep duration, totals, percentages, end-times).
- **The spec as a form.** Exposing an RRULE, a cron string, a permission bitmask, or an enum's raw values is handing the user your file format and asking them to be the parser.

> **Where this hands off.** This skill decides you need *a temperature range, a mode, a power*. It does **not** decide the widget. Choosing the frictionless control for each value — a dual slider, a pull-to-adjust handle, segmented buttons, an invented control, and how it behaves under a finger vs. a mouse vs. voice on a phone vs. a browser — is `bespunky-product-ux:astonishing-to-use` → `facilitating-input`. Model the concepts here; render them there. **Default to the best control for the task, never the common one** — but that's the control layer's job; get the *concepts* right first.

---

## Output — deliver the decision, not the data

Ask: **why is the user looking at this? what conclusion or action are they here for?** Deliver *that* first. The raw data is evidence — keep it, but demote it below the answer it supports.

Most outputs are built by plotting whatever the query returned: a table of the rows, a chart per metric. That's honest and useless — it answers "what is the data?" when the user asked "what should I do?" The good version does the reading *for* them and states the takeaway, then offers the data as the *why*.

| Context | Data-dump (bad) | Decision-first (good) |
| --- | --- | --- |
| Weather | hourly temp / humidity / precip% table | "**Umbrella after 3pm; cooler than yesterday — grab a jacket.**" |
| AC (readout) | a line chart of room temperature | "Runs 6–9am & 5–11pm today, ~$1.20." |
| Budget | bar chart of spend by category | "On pace to **overspend dining by $80** — skip two takeouts to stay on track." |
| Flight prices | price-history line chart | "**Buy now** — up 4 of the last 5 days, and you're in the cheap 3-week window." |
| Analytics | a 12-tile dashboard | "**Signups −20% since Tuesday's deploy** — likely the checkout error spike." (tiles below as evidence) |

The moves:
- **Lead with the conclusion**, in the user's terms and stakes ("grab a jacket", "overspend by $80"), not the measurement.
- **Do the comparison and the math** the user would otherwise do — vs. yesterday, vs. budget, vs. the usual, trend direction, projection to end-of-period.
- **Say what to do**, when there's a natural next action ("skip two takeouts", "buy now").
- **Keep the data as support**, one level down — for the user who wants to verify or dig. Decision-first is not data-hiding; it's data-*ordering*.

The tell you've done it: the user can act on the first line without reading the chart. The chart is there to answer "why do you say that?" — not to *be* the answer.

---

## How to run it — a two-question habit

Wherever you place an input or an output, ask one question and design from the answer:

- **Input:** *"What is the user trying to express, and in what shape do they hold it?"* → build the intake in that shape; derive the storage from it.
- **Output:** *"What decision or conclusion did the user come for?"* → state it first; make the data the evidence beneath it.

Then, only for inputs, hand the chosen concepts to `facilitating-input` to pick or invent the control that makes each one effortless.

This realizes the architect mindset in the interface layer:
- **Model the missing concept** — name the mode/power/range the schema omitted; don't make the user simulate it.
- **Design for the consumer** — the user thinks in intents and decisions; meet them there, not at the database.
- **Concentrate complexity so the edges stay simple** — the reasoning (thresholds from a range, a conclusion from rows) lives *inside* the system, leaving the user's surface calm.
- **Build for the goal, not the brief** — the user didn't come to fill a form or read a chart; they came to keep the room comfortable, or to decide whether to bring an umbrella. Serve the goal.

---

## Ask yourself

- **Input shape:** does the form mirror my **storage schema / API / config format**, or the **shape the user thinks in**? Where does a column, an enum, an RRULE, or a bitmask leak onto the screen?
- **The mental translation:** to fill this in, does the user have to do **arithmetic or reasoning in their head** to convert what they want into what I'm asking? (That reasoning is my job, not theirs.)
- **Missing concepts:** does the task have a concept my data model never named (a mode, a power, a range, a role) that the user is currently forced to *simulate*? Model it.
- **Derived-as-input:** am I asking for anything the system could **compute** from what the user already gave?
- **Output conclusion:** why is the user looking at this — and does the **first line answer that**, or just show the data and leave them to infer it?
- **The "so what":** have I done the **comparison, math, and projection** the user would otherwise do in their head (vs. yesterday / budget / usual; trend; end-of-period)?
- **Next action:** is there a natural thing to *do* about this readout — and have I said it?
- **Data as evidence:** is the raw data still available, **demoted below** the conclusion (ordered, not hidden), for whoever wants to verify or dig?
- **Handoff:** did I get the **concepts** right before worrying about controls — and then pass them to `facilitating-input` for the best (not the common) control?

## Red flags

- **The schema is the form** — one field per column, an exposed RRULE / cron / enum / permission matrix; the UI is a window onto the table.
- **Compile-it-yourself input** — the user must combine several primitive fields (two thresholds, two dates, freq+interval+byday) to express one thing they think of as a *single* intent.
- **A concept simulated with primitives** — no "mode" or "range" field, so the user fakes it with thresholds, flags, or duplicate rows.
- **Derived values asked as inputs** — end-times, totals, durations, percentages the system could compute.
- **Data-dump output** — a table of the rows or a chart per metric, with no stated takeaway; "here's the data" where "here's what it means" was needed.
- **Decompile-it-yourself output** — the conclusion is *derivable* from what's shown, but the user has to do the reading, the comparison, and the math themselves.
- **Answer buried, not led** — the insight exists on the screen but below the fold of attention, outranked by chart chrome.
- **Minimalism that drops a needed concept** — "simplifying" by removing mode/power the task actually needs (the opposite failure to schema-dumping).
- **Control-before-concept** — agonizing over the widget before deciding what concept it even captures (that's `facilitating-input`'s turn, and it comes second).

---

> **Related.** The **semantic** half of great I/O; its **control** half is `bespunky-product-ux:astonishing-to-use` → `facilitating-input` (best-not-common control, invented controls, finger/mouse/voice/phone realities) — model the concept here, render it there. Upstream of it sits `bespunky-product-ux:distill-the-brief` (find the real problem) and `envision-the-experience` (the world it lives in); a decision-first output is often one of `keep-users-oriented`'s "expected result" answers. A direct expression of `bespunky-engineering:architect-mentality` — *model the missing concept*, *design for the consumer*, *concentrate complexity so the edges stay simple*, *build for the goal not the brief* — and, when getting the intake right means reshaping a data-driven form or readout, an `bespunky-engineering:architecture-first` redesign of the seam rather than a patch over the schema.
