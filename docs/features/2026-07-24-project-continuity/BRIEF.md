# Brief — project continuity (cold pick-up of a stale project)

> The design problem, solution stripped out. What "done" looks like, not how.

## The ache

You put a project down. Weeks or months later you come back and can't get your bearings: *What was the plan? Where did I leave off? What's still open? What did we already decide — and what did we already rule out? Did we think this and that through?* Reconstructing that costs an expensive, error-prone hour of archaeology across code, git log, and half-remembered chats — and the most valuable part (the *why*, the roads not taken, the "was this proven or just assumed?") is usually gone, so ideas get re-proposed and dead ends get re-explored.

This is a **cold start**, and it is distinct from a warm one. It is *not* "carry this live effort across a context boundary into a fresh session" — that is [[session-handoff]], a deliberate, hot, specific-intent baton where you already know which effort you mean. The cold case is the opposite: **no live session, no held intent, and you may not even remember there were three parallel efforts.** You need a front door onto a repo you've forgotten.

## Who and when

The user is a developer (often solo or small-team) returning to one of many projects after a gap — and, symmetrically, **agents** running unattended (headless, cron, parallel worktrees) that will leave the project mid-thought when a session ends or context compacts. The moment of need is *the first minute back in the repo*, before any new work starts.

## What the solution must do

1. **Orient from cold** — reconstruct "where does this project stand" without the user re-explaining: which efforts exist, which are live / stalled / concluded, which single artifact to read first, what was in flight when everyone walked away.
2. **Capture reliably, unattended** — state must get written *even when no one asks* and *even in a headless run*, because the moment it's most needed (a bloated session about to compact) is exactly when a model is least likely to volunteer it. Reliability cannot depend on the model choosing to act.
3. **Stay fresh without hand-maintenance** — "current state" must not be a doc someone has to keep rewriting (that doc rots first, and its rot *is* the disease). Freshness has to come from something that can't go stale.
4. **Preserve the perishable why** — decisions, roads-not-taken, and proven-vs-assumed must survive the whole lifecycle. A tidy record that reads like the feature was always going to be built this way is a lie that costs future-us the re-exploration.
5. **Not bloat as it grows** — a project with hundreds of past efforts must not make orientation *harder*. The cost of orienting must scale with **active** work, not with total history.
6. **Work in the consumer's project** — this serves people picking up *their* projects, so it must operate wherever installed, and stay completely silent in a project that has nothing in flight.

## Constraints carried from the toolkit

- **Repo is the source of truth.** Continuity artifacts are versioned and co-located with the code; any external PM platform (ClickUp) is a *later, one-way projection*, never the primary store. Two sources of truth drift.
- **Build on what exists.** [[feature-package]] already gives every effort a home (`docs/features/<date>-<slug>/`) with a durable-conclusion / disposable-evidence split; [[session-handoff]] already defines the append-only, timestamped baton and its capture/resume format; [[branch-and-release]] already ties one slug to branch + worktree + package. This effort *composes* those, it does not replace them.
- **A skill fires only when judged relevant** — so anything that must happen *reliably* (surface standing on open; capture before compaction) needs the always-on-half / hook escape hatch, not a skill alone.

## Out of scope (for now)

- Any PM-platform integration (ClickUp). Deferred by decision — see `DECISION.md`.
- Rewriting or editing past records to reflect the present ("cleanup"). Rejected as lossy — see `DECISION.md`.

## Done looks like

A returning developer (or a fresh agent) opens the repo and, within the first interaction, is *told* there is in-flight work and can get an accurate, honest standing of the whole project on request — live efforts in full, concluded ones collapsed to a line, the right baton named — reconstructed from the repo, current by construction, with the reasoning behind every effort still intact and the whole thing no slower to read at effort #300 than at effort #3.
