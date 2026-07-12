---
name: session-handoff
description: The BeSpunky method for carrying a live effort across a context boundary — when the current session is bloated/ending and the work must continue in a FRESH session that starts with zero memory of this one. One skill, two modes. CAPTURE (write the baton) — triggers on "create/write a handoff", "hand this off", "checkpoint the session", "save state before I clear context", "context is getting long, wrap up", "I'm about to start a fresh session". RESUME (pick up the baton) — triggers on "resume from the handoff", "here's the handoff doc / here's where we left off", "continue where we left off", "load this handoff", or the user pasting/pointing at a handoff file. The baton is a DISTILLATION, never a transcript dump: goal and real intent, current state, the immediately-actionable next step, decisions and roads-not-taken, insights, constraints, verification state (proven vs assumed), anchors (paths/SHAs/PRs), and — first-class — every CORRECTION the user made to Claude this session (behavioral, conceptual, code, process), each routed by scope: durable corrections promoted to persistent memory so the lesson is never re-learned, task-local ones kept in the baton. Resume is a RE-GROUNDING (verify anchors, report drift, confirm the next step), not blind trust. Complements — does not replace — auto-compaction (automatic, in-session) and the auto-memory store (durable facts); this is a user-triggered, curated, task-scoped relay across sessions.
---

# Session handoff — the relay baton (non-negotiable shape)

A handoff carries **one live effort across a context boundary**. The next session starts **blind** — it never saw this conversation. The baton is the only bridge, so the whole method is one tension:

> **Carry everything needed to continue as if no break happened — while distilling hard enough that you don't recreate the bloat you're escaping.**

**Acceptance test for any baton you write:** a fresh session (or a competent stranger) can continue **without asking the user to re-explain anything**. If a reader would have to ask "why did we do it this way?", "what's the actual goal?", or "what do I do first?", the baton is incomplete.

**It is NOT** a transcript dump, a summary of everything said, or a second memory system. **It IS** a curated, point-in-time relay for *this* effort.

| Mechanism | What it is | Relationship to the baton |
| --- | --- | --- |
| Auto-compaction | Automatic, in-session, Claude-authored summary | The baton is the opposite: **user-triggered, curated, crosses a hard boundary by choice**. |
| Auto-memory store | Durable facts that persist across all sessions indefinitely | The baton is **task-scoped**; it *feeds* memory (see the corrections bridge) but never duplicates it. |
| **This baton** | A curated relay for continuing one in-flight effort in a fresh session | Distill in-flight state here; promote *forever* lessons to memory. |

Two modes. **Capture** writes the baton; **Resume** picks it up. They share ONE format (below) — the same skill owns both ends so the writer and reader can never disagree.

---

## Where the baton lives

Committed, timestamped, accumulating as a trail — never one file overwritten:

```
docs/handoffs/<ISO-8601>-<slug>.md      # one baton per capture, e.g. 2026-07-13T0930Z-staging-multidb.md
docs/handoffs/latest.md                 # a one-line pointer to the current baton + its as-of stamp
```

- **Committed** — a baton is part of the effort's history and is shareable; it belongs in the repo, on the branch the work lives on (a feature worktree per [[branch-and-release]]).
- **Timestamped filenames sort chronologically**; `latest.md` is the stable entry point Resume reads first. Capture rewrites `latest.md` to point at the baton it just wrote.
- Stamp the time from the shell, never guess: `date -u +%Y-%m-%dT%H%MZ`.
- Get the anchors from the repo, never from memory: `git rev-parse --short HEAD`, `git branch --show-current`, `git status --porcelain`.

---

## Mode: CAPTURE — write the baton

Fill **every** section of the format below. Empty is a decision ("Open questions: none"), not an omission. Discipline before content:

- **Distill, don't dump.** This is the whole point. Carry conclusions, not the path that reached them.
- **Capture *why*, not just *what*.** A decision without its rationale gets relitigated; an insight without its evidence gets doubted. Record roads-not-taken so the next session doesn't re-walk them.
- **Defer to the repo.** Don't recapture what code, `git log`, the PR, or `CLAUDE.md` already say — link to them (anchors). Capture only what is *not* reconstructable from the artifacts.
- **Self-verify anchors before writing.** Confirm the SHAs and paths are real (`git rev-parse`, `test -e`) so the baton isn't *born stale*.
- **Tag each item by type** — fact / decision / intention / assumption / open-question — because Resume treats each differently (a fact is verified, an intention is re-confirmed, an assumption is unproven).
- **Be honest about verification state.** Separate what you *observed working* from what you *assumed*. A baton that claims "done" for unverified work sabotages the next session.

### The format (the shared contract)

```markdown
# Handoff — <effort title>
As-of: <ISO> · branch <branch> · HEAD <short-sha> · <repo or worktree path>
Working tree: <clean | N uncommitted files — list them>

## Goal
The real intent — WHY this effort exists, read over the literal brief. What "done" looks like.

## Current state
- Done (verified): …
- In progress: … (exactly where it stands)
- Not started: …

## Next action(s)
1. <concrete and immediately actionable — a command, a file, a decision to make. NOT "continue the work".>
2. …

## Decisions & roads not taken
- <decision> — because <why>. Considered and rejected: <alternative> because <why>.

## Corrections the user made this session   ← first-class; see the dedicated section below
| Kind | What was corrected | Why (the user's reasoning) | Corrected behavior | Scope |
| behavioral / conceptual / code / process | … | … | … | task-local  /  DURABLE → memory |

## Insights & discoveries
- <non-obvious fact learned the hard way — a codebase truth, an API behavior, why an approach fails>

## Constraints & gotchas
- <hard rules, environment traps, user preferences surfaced this session>

## Verification state
- Proven (observed): <what was actually run/seen working, and how>
- Assumed (unverified): <what is believed but not yet checked>

## Open questions / risks
- <unresolved forks, pending confirmations, things to watch>

## Anchors
- Files: <path:line …>
- Commits / PRs / issues: <sha, links>
- Artifacts: <build output, test run, doc, screenshot paths>
```

### Corrections — the highest-signal, most-perishable layer

Claude begins the next session with **no memory of being corrected**, so uncaptured corrections are **repeated verbatim**. Treat this as the layer most likely to be lost and most damaging to lose.

- **Catch implicit redirections, not only explicit "you're wrong".** A rephrase, a "no, I meant…", the user quietly taking over a task Claude did wrong, a preference stated once in passing — all are corrections.
- **Record the *why* and the *corrected behavior*, not the scolding.** Write each one in the shape memory expects — **Why** it matters and **How to apply** it next time — so a promoted correction drops straight into the memory store unchanged.
- **Classify scope — this is the whole game:**

  | Kind | Example | Usual scope |
  | --- | --- | --- |
  | Behavioral | "Give a recommendation, don't dump options" · "operate repos via WSL" | **Durable → memory** |
  | Conceptual | "Staging isolation is Firestore-only" · a misread of the goal | Updates the mental model in the baton; often durable |
  | Code / style | "Never name things `Manager`/`Service` — name by concrete function" | House style → **memory** or baton |
  | Process | "Confirm before publishing" · "verify before claiming done" | **Durable → memory** |

- **Route by scope (the memory bridge — central, not optional):**
  - **Durable** corrections (a forever rule, true beyond this effort) → **write them to the persistent memory store** so the lesson is never learned twice — in this effort *or any future one*. In this environment that is the auto-memory store (add the file **and** its one-line entry in that store's `MEMORY.md` index, `feedback` type, following its Why / How-to-apply shape); otherwise the user/project `CLAUDE.md`. Note in the baton which corrections you promoted.
  - **Task-local** corrections (only meaningful to *this* effort) → keep in the baton's corrections table.
- **A repeat is a red flag.** A correction the user had to make **more than once** is a strong durable signal — promote it and place it prominently.

When you finish, **rewrite `docs/handoffs/latest.md`** to point at the new baton, and tell the user the path plus a one-line summary of what you promoted to memory.

---

## Mode: RESUME — pick up the baton

Resume is a **re-grounding, never blind trust.** The baton reflects what was true at its as-of stamp; the world has moved since (the user did things, another session ran, `development` advanced). Run these steps before doing any work:

1. **Load** the baton — follow `docs/handoffs/latest.md` unless the user names a specific one.
2. **Verify the anchors.** Do the SHAs, paths, and PRs still exist and match? `git rev-parse`, `test -e`, `git log`. Check the current HEAD/branch against the baton's as-of.
3. **Report drift** — a short, honest diff of *baton vs. reality*: what still holds, what changed (new commits, moved files, resolved questions), what's now stale. Surface it before proceeding.
4. **Trust by type.** Facts → verify against the repo. Intentions → re-confirm with the user. Assumptions / "Assumed (unverified)" items → treat as unproven and re-check.
5. **Reconstruct the mental model out loud** — one tight paragraph: the goal, where things stand, and the proposed next step — so the user can correct a misread *before* work resumes.
6. **Apply the corrections immediately.** The baton's corrections are binding for this session from the first action — don't wait to trip over them again. (Durable ones are already in memory; the task-local ones live only in the baton, so internalize them now.)
7. **Confirm the next step, then proceed** (or act directly if durably authorized).

**The baton is a living relay.** When this resumed session in turn grows long or ends, run **Capture** again to emit an updated baton — so the effort can relay through as many sessions as it takes.

---

## Cross-links

- [[branch-and-release]] — a baton is created and committed on the effort's worktree/branch; the "Next action" often names the next promotion gate.
- The auto-memory store — durable corrections and durable facts belong there, not in the baton; the baton is where you *decide* what to promote.
