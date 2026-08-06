# Resuming a fan-out

A fan-out is interrupted far more often than anyone plans for: a crash, a dropped connection, a deliberate stop, a mistaken stop, a permissions error on one folder, a container rebuild, a context that ran out. The tree does not survive any of them. **The ledger does — if it was written before the tree, and updated during it.**

---

## The ledger format

One file per fan-out, in the effort's package: `docs/features/<YYYY-MM-DD>-<slug>/handoffs/<ts>-fanout.md`.

```markdown
---
kind: fanout
status: in-progress          # in-progress | complete | abandoned
goal: Audit every verifyToken() call site for the missing-expiry bug
shape: scout → map → verify  # the dependency shape, so resume knows what may run
workflow_run: wf_a1b2c3d4    # runId — resume is IMPOSSIBLE without this
workflow_script: /path/to/persisted/script.mjs
---

## Units

| id | unit | status | re-runnable | result |
| --- | --- | --- | --- | --- |
| u1 | scout: list call sites | returned | yes | 7 sites — see below |
| u2 | audit src/auth/login.ts:44 | returned | yes | exp checked — no change needed |
| u3 | audit src/api/refresh.ts:12 | dispatched | yes | — |
| u4 | audit src/jobs/cron.ts:88 | failed | yes | permissions error on src/jobs/ |
| u5 | apply fix to refresh.ts | pending | **no** | blocked on u3 |

## Results

### u1 — scout
src/auth/login.ts:44 · src/api/refresh.ts:12 · src/jobs/cron.ts:88 · …

### u2 — src/auth/login.ts:44
Checks `exp` before use. No change needed.

## Not covered
- src/legacy/** excluded by the scout's scope. Deliberate; not audited.
```

**Every column earns its place.** `id` is stable so resume matches by identity rather than position. `re-runnable` is what lets resume act without asking — a read-only audit re-runs for free, a mutation does not. `result` inline is the point of the whole file: a distillation stored anywhere else died with the agent that produced it.

---

## Writing it — the ordering that actually matters

1. **Write the plan and the unit list BEFORE the first spawn.** Not after the first result, not "once the shape settles". The window between dispatch and the first write is exactly the window in which an interruption costs you the plan.
2. **Update on each state change**, as a real write, one per change. Batching updates in your head and flushing at the end reproduces precisely the failure the ledger exists to prevent.
3. **Record a `Workflow`'s `runId` the moment it returns one** — before you read its results, before you do anything else with them. It is one string, and it is the difference between a cheap resume and a full re-run.
4. **Commit periodically.** An uncommitted ledger survives a stopped turn but not a rebuilt container.
5. **Close it out.** On completion, set `status: complete`. An in-progress ledger left behind is a false alarm for whoever picks the project up next.

---

## Resuming from one

1. **Find it.** Newest `*-fanout.md` in the package for the current branch's slug (the package-location rule in [[feature-package]] gives you the folder).
2. **Read the status column, not the prose.** `returned` units are done — their results are right there and are not re-run. `pending` and `dispatched` are the work. `failed` needs a decision: retry, route around, or report.
3. **Distrust `dispatched`.** It means "sent, never heard back" — which covers both *it finished after the crash* and *it never ran at all*. Treat it as outstanding, and check for side effects before re-running anything marked not re-runnable.
4. **Verify the anchors before re-dispatching.** The tree may be older than the working copy: files move, symbols get renamed, the scout's list goes stale. A resumed unit pointed at a line that no longer exists wastes a whole round trip.
5. **For a `Workflow`, resume rather than restart** — relaunch with the recorded `scriptPath` and `resumeFromRunId`. The unchanged prefix of agent calls returns from the journal instantly; only the first changed or new call and everything after it runs live.
6. **Re-verify what you inherit.** Results in the ledger were verified by a session you cannot interrogate. For anything load-bearing, spot-check the anchors before you build on them.

---

## What "leaving traces" asks of a child agent

State it in the prompt, because a blank-slate agent will not infer it:

> *Write what you produce into `<package path>` as you go, and return a summary of what you wrote — not the only copy of it. If you fan out yourself, keep your own ledger in the same folder and report where it is.*

Three consequences worth spelling out to them:

- **Durable output goes to disk first, the return value second.** A twelve-page analysis that exists only as a return value is one interruption away from never having existed.
- **A subtree needs its own ledger**, or it resumes as an opaque "something was happening here" — you will know a child was working and nothing about how far it got.
- **Mutations announce themselves.** An agent that changed files says which, so a resume can tell a half-applied change from an unstarted one. Small commits do this better than any prose can.
