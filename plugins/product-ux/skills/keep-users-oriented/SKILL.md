---
name: keep-users-oriented
description: Keep anyone who is waiting or being moved through a process oriented - so they always know what is happening and never have to guess. Use whenever you build something that makes a user wait or takes them through steps: loading indicators, spinners vs. progress bars, async operations, long-running or background jobs, file uploads/downloads, multi-step forms / wizards / steppers, checkout and onboarding flows, optimistic UI, completion notifications/emails, and empty/pending/in-progress states. Also use when designing any human-facing process or service where someone waits (a queue, an intake, a hand-off). The core move: answer the user's three questions - (1) what is the expected result of this process, (2) where am I relative to the whole process, (3) what is the next step - and choose the right feedback shape for the process type: deterministic processes get visible steps/progress; nondeterministic ones get a rough estimate plus "we'll let you know" plus what to do meanwhile. Silence is the bug: an unanswered question makes the user re-click, interrupt, abandon, or panic. This realizes the architect-mentality principles "design for the consumer" and "compensate for your materials' weaknesses" in the experience layer.
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

## Why silence is expensive

When a process gives no feedback, the cost is never just one confused user — it compounds. Trace a single unanswered question outward:

- The **waiting user** is anxious and frustrated; they don't know if it's working or stuck.
- So they **act on the uncertainty**: re-click the button (double-submit, duplicate charge, duplicate download), hammer refresh, or walk up and **interrupt** the person/system doing the work.
- The **interruption** breaks the worker's focus and *introduces risk and delay* into careful work — and slows the whole pipeline for everyone behind them.
- **Bystanders** misread the interruption (is that person cutting the line? is the system down?) and get anxious too.
- Multiply by every waiting user. One missing sentence becomes a room full of friction.

So the feedback you add isn't decoration — it **removes load** from the system. Fewer duplicate requests, fewer support tickets, fewer interruptions, less abandonment. The classic tell: a user clicks a button, nothing visibly happens, so they click it again and again — overloading the server or firing the action three times. They didn't misbehave; **you failed to answer "where am I / what's next,"** so they filled the silence with action.

---

## The two process types — and the feedback each demands

The *right* answer to the three questions depends on whether you can predict the process. Classify first, then choose.

### Deterministic processes — show the steps

The steps and their order are known ahead of time (register → validate payment → process images → done). The process can fail, but its *shape* is fixed.

**Feedback:** expose the steps and light up where the user is. A **stepper / multi-stage progress indicator** is the canonical form. Even with no time estimate, a sequence of advancing steps gives a felt sense of "how much is left."

- Expected result → the final step, named ("You'll be registered and your order confirmed").
- Where am I → the highlighted/active step.
- Next step → the next step in the visible sequence; the user can see it coming.

Use this for: checkout, onboarding wizards, multi-step forms, install/setup flows, anything with a fixed pipeline.

### Nondeterministic processes — estimate and hand off

Duration and exact steps depend on the input (a heavy data crunch, a video transcode, a third-party call of unknown latency). You *can't* honestly show step N of M.

**Feedback:** give a **rough estimate**, promise a **notification**, and tell the user **what they can do meanwhile**. The estimate doesn't need to be accurate — it needs to set an expectation the user can plan around.

- Expected result → "We'll email you the report when it's ready."
- Where am I → "This usually takes about an hour" (rough is fine).
- Next step → "You can close this and keep working — we'll notify you."

Use this for: background jobs, exports, long imports, queued processing, anything you can't time precisely.

> **The infinite spinner is the trap.** A bare spinner that runs forever answers *none* of the three questions — it only says "something might be happening." It's the UI equivalent of the nurse who walks away without a word. A spinner is acceptable **only** for processes you can guarantee resolve near-instantly (a second or two). For anything longer, upgrade to determinate progress (if you know the shape) or to estimate-and-notify (if you don't).

---

## Software expressions of the principle

The same three questions show up across the stack. A non-exhaustive map:

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

A progress bar is reliable precisely because it doesn't depend on the developer remembering to be considerate in the moment — it's part of the component. Do the same everywhere: make "in-progress / where / next" a *property of the flow*, not a courtesy someone has to add. Ask, for any process you build: **what is this process's progress bar?** A status board, a confirmation email, a job-status endpoint, a stepper component reused across every wizard — whatever makes orientation the default.

This is the experience-layer expression of the architect mindset:
- **Design for the consumer** — the person waiting is a primary constraint, not an afterthought.
- **Compensate for your materials' weaknesses** — humans fill silence with anxious action; absorb that weakness by never leaving silence.
- **Automate every repeated process** — a reusable status/stepper/notify primitive means orientation is guaranteed, not re-added by hand each time.
- **Model the missing concept** — if a flow has nowhere to express "current status," that absence *is* the bug; build the status concept as a first-class part of the design.

---

## Ask yourself

- For every wait and every step the user passes through: can the screen (or the service) answer **expected result / where am I / next step**? If any is missing, it's not done.
- Is this process **deterministic** (show steps/progress) or **nondeterministic** (estimate + notify + "do this meanwhile")? Did I pick the matching feedback?
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
- "It'll be obvious it's working" / "they can just wait" / "they'll figure out what to do" — silence rationalized.
- Orientation added ad-hoc per screen by whoever remembered, instead of being a reusable default of the flow.
- A service or hand-off that makes the waiting party walk over and *ask* what's happening — the real-world double-click.

---

> **Origin.** This skill distills *"Where Is He Going? Is He Coming Back? — What hospitals (and service givers) can learn from software companies"* by Shy Agam — an ER waiting-room story turned into the three-questions principle and the deterministic/nondeterministic split. The article is the *why*; this skill is the operational form.

> **Related.** The mindset beneath it lives in `engineering:architect-mentality` (*design for the consumer*, *compensate for weaknesses*, *model the missing concept*, *automate every repeated process*). When the fix requires building a reusable status/stepper/notify primitive rather than a one-off, that's an `engineering:architecture-first` change — design the seam, confirm, then implement.
