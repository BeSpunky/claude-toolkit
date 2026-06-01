---
name: keep-users-oriented
description: Keep anyone who is waiting or being moved through a process oriented - so they always know what is happening and never have to guess. Use whenever you build something that makes a user wait or takes them through steps - loading indicators, spinners vs. progress bars, async operations, long-running or background jobs, file uploads/downloads, multi-step forms / wizards / steppers, checkout and onboarding flows, optimistic UI, completion notifications/emails, and empty/pending/in-progress states. Also use when designing any human-facing process or service where someone waits (a queue, an intake, a hand-off). The core move - answer the user's three questions - (1) what is the expected result of this process, (2) where am I relative to the whole process, (3) what is the next step. The three questions are fixed, but HOW you answer and present them is an open design problem - reason creatively from the specific need, never reach for a reflexive stock widget. A stepper, spinner, progress bar, checklist, toast, or estimate-and-notify email are only common examples, not a menu; the right answer might be a preview of the result, a changing label, a live log, an analogy, an ambient cue, or a form you invent. A useful lens - can you predict how the process unfolds? - steers what honest answer is even available (predictable - show position; unpredictable - give a rough estimate plus what to do meanwhile), after which you still design the answer and its presentation. Silence is the bug - an unanswered question makes the user re-click, interrupt, abandon, or panic. This realizes the architect-mentality principles "design for the consumer" and "compensate for your materials' weaknesses" in the experience layer.
---

# Keep Users Oriented

A person waiting on a process is silently asking three questions. Answer them and the wait becomes calm and trustworthy. Leave any one unanswered and the same person re-clicks the button, interrupts the staff, abandons the flow, or quietly panics — and so does everyone around them.

**This skill is one principle with one test.** Whenever you build anything that makes someone *wait* or moves them *through steps*, make the experience answer:

1. **What is the expected result of this process?** — what will I have when it's done?
2. **Where am I relative to the whole process?** — how far along, how much is left?
3. **What is the next step?** — what happens now, and what should *I* do in the meantime?

If the thing you're building doesn't answer all three, it isn't finished — no matter how correct the underlying logic is. **Silence is the bug.**

This is a *service-design* principle, not just a UI trick. Software companies happened to learn it first (their users abandon instantly and measurably), but it applies identically to a hospital waiting room, a support queue, a deployment that prints nothing for ten minutes, or a teammate you handed work to. The examples below lead with software because that's where you'll apply it most, then generalize.

---

## The questions are fixed; the answer is a design problem

This is the part to hold onto: **the three questions never change, but how you answer them — and how you present that answer — is wide open, and deserves real design thought every single time.** There is no default control to drop in. A stepper, a spinner, a progress bar, a checklist, a toast, an estimate-and-notify email are *common expressions* of the principle, not a menu you pick from by reflex. Grabbing one without thinking is itself a failure mode — you may be answering a question the user didn't have while ignoring the one they did.

Reason from the need, in three moves:

1. **What does *this* user, in *this* moment, actually need to know to feel oriented?** Which of the three questions is genuinely unanswered here — and how much detail truly helps? (Often "almost done" beats "73.4%"; sometimes a single precise number is everything.)
2. **What is the most honest answer you can give?** The real result, the real position, the real next step — *including* when the honest answer is "we can't know exactly, but roughly X." Never fake certainty you don't have, and never withhold certainty you do.
3. **What is the best way to *present* that answer** for this medium, moment, and audience? Words, motion, sound, color, spatial position, a building-up preview of the actual result, a real-world analogy, an ambient signal, a physical cue — or a form that doesn't exist yet and you invent for the occasion.

The same unanswered question has a dozen good answers. "Your driver is 3 minutes away" on a moving map, a boarding-group number, a delivery's "out for delivery → arriving by 5pm", a build's streaming log, a photo resolving from blur to sharp as it loads, a kettle whose sound tells you it's nearly boiled — each answers *where am I / what's next* without a generic progress bar in sight. **Match the answer to the need; then design the presentation. Don't bend the need to fit a widget you already had in mind.** Going the extra mile here means finding (or inventing) the form that fits *this* situation, not settling for the stock one because it's at hand.

---

## Why silence is expensive

When a process gives no feedback, the cost is never just one confused user — it compounds. Trace a single unanswered question outward:

- The **waiting user** is anxious and frustrated; they don't know if it's working or stuck.
- So they **act on the uncertainty**: re-click the button (double-submit, duplicate charge, duplicate download), hammer refresh, or walk up and **interrupt** the person/system doing the work.
- The **interruption** breaks the worker's focus and *introduces risk and delay* into careful work — and slows the whole pipeline for everyone behind them.
- **Bystanders** misread the interruption (is that person cutting the line? is the system down?) and get anxious too.
- Multiply by every waiting user. One missing sentence becomes a room full of friction.

So the feedback you add isn't decoration — it **removes load** from the system. Fewer duplicate requests, fewer support tickets, fewer interruptions, less abandonment. The classic tell: a user clicks a button, nothing visibly happens, so they click it again and again — overloading the server or firing the action three times. They didn't misbehave; **you failed to answer "where am I / what's next,"** so they filled the silence with action.

---

## A useful lens — can you predict the process?

One question sharpens the design fast: **can you predict how this process unfolds?** This is a *lens*, not a switch that hands you a widget — it tells you what kind of *honest* answer is even available. You still design the answer and its presentation per the section above.

### When the process is predictable

The steps and their order are known ahead of time (register → validate payment → process images → done). The shape is fixed even if individual steps can fail. So an honest answer to "where am I" *exists* — you can show real position.

Common ways to show it: a stepper or multi-stage indicator, yes — but equally a filling shape, a map that advances, a count ("3 of 5 uploaded"), a preview that builds up, a narrated current step, or a percentage when the number genuinely helps. Pick the form that fits the moment; the obligation is to show *real position*, not to render a particular control.

- Expected result → name the end state ("You'll be registered and your order confirmed").
- Where am I → some honest depiction of position in the known sequence.
- Next step → what comes next, visible *before* it happens so the user sees it coming.

Typical home: checkout, onboarding, multi-step forms, install/setup flows — anything with a fixed pipeline.

### When you can't predict it

Duration and exact steps depend on the input (a heavy crunch, a video transcode, a third-party call of unknown latency). You *can't* honestly show step N of M — so don't fake one.

The honest move is usually: a **rough expectation** the user can plan around, a way to **find out when it's done** (notify, or a status they can check), and **what they can do meanwhile**. But the form is open — a live streaming log, an evolving partial result, a "still working… (started 2m ago)" heartbeat, or a confidence-appropriate estimate can all answer it better than a generic message, depending on the case.

- Expected result → "We'll email you the report when it's ready."
- Where am I → a rough, honest sense ("usually about an hour"; or a live log showing real motion).
- Next step → "Close this and keep working — we'll notify you."

Typical home: background jobs, exports, long imports, queued processing — anything you can't time precisely.

> **The infinite spinner is the trap — because it answers nothing, not because it's a spinner.** A bare spinner only says "something might be happening": no result, no position, no next step. It's the UI equivalent of the nurse who walks away without a word. It's fine *only* when you can guarantee the wait is near-instant (a second or two). For anything longer, replace it with something that actually answers the three questions — real progress, an estimate, a live log, a building preview, whatever genuinely fits. The fix is *answering the questions*, not swapping one stock widget for another.

---

## Software expressions of the principle

The same three questions show up across the stack. The list below is **illustrations, not a checklist** — each is one way the questions have *commonly* been answered, shown so you recognize the pattern, not so you copy it. Your situation may want a different shape entirely; let these prompt ideas rather than cap them.

- **Buttons / submits.** On click: disable + show in-progress state immediately (answers "it's working, where I am"), then show the result or next step. This *also* prevents the double-submit that silence causes. Never let a click look like nothing happened.
- **Async operations & data fetching.** Distinguish *loading*, *empty*, *error*, and *success* — they answer different questions. An empty state must say what's expected and the next action ("No invoices yet — create your first"), not render a blank void.
- **Determinate vs. indeterminate progress.** If you can compute percent/steps, use a determinate bar or stepper. Reach for an indeterminate spinner only when the work is genuinely unmeasurable *and* short.
- **Long-running / background jobs.** Estimate + notify (toast, email, push, badge). Make the job's status queryable so the user can check "where am I" on demand. Surface partial progress if you have it.
- **Uploads / downloads.** Bytes transferred, percent, and time-remaining are the three questions in literal form. Show them.
- **Optimistic UI.** Reflect the intended result immediately (answers "expected result" and "next step" instantly), then reconcile — and if it fails, say so clearly and restore state. Optimism is answering the questions *before* the server does; it's only honest if you handle the rollback.
- **Multi-step flows.** A visible stepper that shows the whole path *before* the user starts lowers the anxiety of beginning — the user sees the destination and the distance, not just the current field.

In every case run the test: *expected result? where am I? what's next?* If the screen can't answer, it's not done.

---

## Beyond software — any process where someone waits

The principle is universal because the *anxiety* is universal. The hospital that says nothing — "the nurse took a sample, wrote something down, and walked away" — produces exactly the double-click of the physical world: the patient gets up and interrupts the staff. The fix costs one sentence:

> "I'll send these to the lab; when they're ready the doctor will review them and call you — usually about an hour. You can wait here."

That single sentence answers all three questions (next step → lab; where am I → ~an hour from the doctor; expected result → reviewed results, then called) and dissolves the entire chain of frustration described above.

**If you provide a service, you are the one who knows the process, the requirements, and roughly how long it takes. Share it — proactively, unprompted.** You don't owe an accurate timetable; a rough estimate someone can plan around is enough ("a few minutes" buys you 10–20 minutes of calm). This applies to support replies, deploys, code reviews you've been handed, a teammate waiting on you — anywhere a human is left wondering "where is this going, and is it coming back?"

---

## Design it in — don't rely on remembering

The deepest version of this skill is architectural, not behavioral. Some people (the good doctor, the thoughtful engineer) answer the three questions *intuitively*. But intuition doesn't scale across a busy team or a large app — the rushed nurse forgets, the junior dev ships the bare spinner. **So bake status into the process so communicating it isn't optional.**

A progress bar is reliable precisely because it doesn't depend on the developer remembering to be considerate in the moment — it's part of the component. Do the same everywhere: make "in-progress / where / next" a *property of the flow*, not a courtesy someone has to add. Ask, for any process you build: **what makes orientation the default here?** It might be a status board, a confirmation email, a job-status endpoint, a reusable stepper, a streaming log, an event the UI subscribes to — whatever guarantees the questions get answered without anyone remembering to. Building it in shouldn't flatten every wait into one house widget, though: design the primitive so each flow can still answer its questions in the form that fits it best.

This is the experience-layer expression of the architect mindset:
- **Design for the consumer** — the person waiting is a primary constraint, not an afterthought.
- **Compensate for your materials' weaknesses** — humans fill silence with anxious action; absorb that weakness by never leaving silence.
- **Automate every repeated process** — a reusable orientation primitive means the questions are guaranteed to get answered, not re-added by hand each time (without forcing every flow into one shape).
- **Go the extra mile** — find or invent the form that fits *this* wait; don't settle for the stock control because it's at hand.
- **Model the missing concept** — if a flow has nowhere to express "current status," that absence *is* the bug; build the status concept as a first-class part of the design.

---

## Ask yourself

- For every wait and every step the user passes through: can the screen (or the service) answer **expected result / where am I / next step**? If any is missing, it's not done.
- Which of the three questions is *actually* unanswered here, and what does this specific user need to know — not "which widget do I add"?
- Have I **designed the answer and its presentation for this need**, or reached for a stock stepper / spinner / progress bar / toast by reflex? Could a different form — a building preview, a live log, an analogy, an ambient cue, something I invent — answer it more honestly or more clearly?
- Can I predict how this process unfolds? If yes, am I showing *real* position; if no, am I being honest about the uncertainty instead of faking a step count?
- If the user clicks and the result isn't instant, does the UI **immediately** show it's working — and is a second click harmless?
- Am I showing a bare/infinite spinner for something that takes real time? (Upgrade it.)
- Do I have a real **empty / error / pending** state, or just an implicit blank?
- Is orientation **built into the flow as a default**, or am I relying on someone remembering to add it next time?
- For a service/human process: have I **proactively** told the waiting person the result, the rough timing, and what to do meanwhile — *before* they have to ask?

## Red flags

- A button or action where a click looks like nothing happened — leading users to click again.
- An infinite spinner standing in for a process that takes more than a couple of seconds.
- A long/background job with no estimate, no progress, and no notification — the user can only guess if it's alive.
- A blank screen where an empty/loading/error state should be.
- Reaching for a default control (stepper, spinner, progress bar, toast) by reflex — without first asking which question is unanswered and what the best way to convey it is.
- A precise-looking indicator that's actually dishonest: a fake step count or a percentage that doesn't track reality, on a process you can't really predict.
- "It'll be obvious it's working" / "they can just wait" / "they'll figure out what to do" — silence rationalized.
- Orientation added ad-hoc per screen by whoever remembered, instead of being a reusable default of the flow.
- A service or hand-off that makes the waiting party walk over and *ask* what's happening — the real-world double-click.

---

> **Origin.** This skill distills *"Where Is He Going? Is He Coming Back? — What hospitals (and service givers) can learn from software companies"* by Shy Agam — an ER waiting-room story turned into the three-questions principle and the predictable/unpredictable lens. The article is the *why*; this skill is the operational form.

> **Related.** The mindset beneath it lives in `engineering:architect-mentality` (*design for the consumer*, *compensate for weaknesses*, *model the missing concept*, *automate every repeated process*, *go the extra mile*). When the fix requires building a reusable orientation primitive rather than a one-off, that's an `engineering:architecture-first` change — design the seam, confirm, then implement.
