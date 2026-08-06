---
status: concluded
concluded: 2026-08-06
summary: New bespunky-workflow skill delegate-and-parallelize + its always-on directive — the session orchestrates and subagents do the work, recursively, with supervision, resumable ledgers, and isolation as a judgment.
tags: [skill, workflow, subagents, parallelism, always-on-directive, resumability]
---

# Decision — `delegate-and-parallelize`

A new `bespunky-workflow` skill plus its always-on directive: the session orchestrates, subagents do the work, recursively.

## The ask, in the user's words

> "I want the toolkit to provide a workflow skill that tells Claude to always parallelize work via agents, subagents and Claude Workflows. It should always aspire reducing the current session's context load by delegating, but also to work faster in parallel instead of a single serial worker. Spawned agents can spawn their own subagents recursively until the task to be performed is either not parallelizable or very simple"

Three more requirements arrived mid-effort, each of which turned out to be structural rather than a detail:

> "A parent must also wait for it's children and never exit while they run so there are no zombie agents left running. This also means checking on agents from time to time"

> "This skill should have an always on directive"

> "Make everything resumable. The machine might crash, wifi dies, I click 'stop' and interrupt Claude willingly or by mistake, a folder hits a permissions issue, whatever... We need to be able to easily resume the agent tree. So all agents should be aware of that, report and document, leave resumable traces"

## What was decided

**The concept is *orchestrator vs. workforce*, not "use more agents".** Framing it as a throughput trick would have produced fan-out theatre. The load-bearing observation is that working inline pays **twice** — context is permanent (and permanent cost is what forces compaction, which degrades every turn *after* it), and serial work costs the sum of its independent parts rather than the slowest one. Both bills are settled by the same move, which is what justifies inverting the default: *work inline only when delegating would cost more than it saves.*

**Recursion needed explicit termination conditions.** "Until not parallelizable or very simple" is the user's intent; stated that loosely a model either stops at depth 1 or fans out forever. Four named conditions — **atomic**, **trivial**, **strictly serial**, **contended** — plus two guards (a level must *reduce* the work rather than rename it; depth 2–3 in practice).

**Supervision and resumability became co-equal pillars, not sections.** Both are failures that are *silent*: a zombie agent looks exactly like a finished one, and a lost tree looks exactly like a tree that was never started. Each got its own SKILL.md section, its own line in the always-on directive, and — for resumability — its own reference file.

**The resume ledger reuses `handoffs/`; it does not invent a home.** A crash is a **context boundary — an involuntary one**, which is precisely what `session-handoff` already models. So the ledger is a baton in the existing sense, at `docs/features/<date>-<slug>/handoffs/<ts>-fanout.md`, and composes with `feature-package` instead of running parallel to it. Its non-obvious requirements: **stable unit ids** (resume matches by identity, never position), **results stored inline** (a distillation that lives only as a return value dies with the orchestrator that received it), and **the `Workflow` runId recorded verbatim** — one unrecorded string is the difference between a near-free resume and a full re-run.

**Workflow authority was drawn deliberately.** The `Workflow` tool requires the user's explicit opt-in, and one of its listed opt-in paths is "a skill whose instructions tell you to call Workflow". Taken naively, an always-on skill would authorize its own spending — laundering the opt-in, the same hazard `CLAUDE.md` already names for hooks ("one compliant model away from doing the thing you refused to automate"). So the skill splits it: **invoked by name → workflows authorized for that turn; auto-fired → subagents freely, workflows proposed with their cost, never launched.** Subagents remain the free everyday tier, which is where the user's "always parallelize" actually lives.

## Roads not taken

- **A router skill with a thin SKILL.md.** Rejected: the discipline itself has to be *in context* when the skill fires, because the decision it governs (decompose or grind) happens before any reference file would be read. SKILL.md carries the full discipline; the three reference files hold catalogue depth only.
- **A hook to enforce delegation.** Rejected: there is no event that fires at "you are about to read a fifth file", and a hook that *commands* delegation is exactly the detect-don't-execute violation the repo already learned. The always-on directive is the right mechanism.
- **A separate `agent-supervision` skill.** Rejected: supervision without decomposition is meaningless, and splitting them would let a model adopt the fun half and skip the duty half.

## Release

`bespunky-workflow` 0.5.3 → **0.6.0** (new skill). `bespunky-project-starter` and `@bespunky/nx-tools` 0.30.2 → **0.31.0** (the always-on directive in `house-doc/HOUSE.rules.md.tpl`).

**Migrations question, asked deliberately: nothing to migrate.** The only payload change is `HOUSE.rules.md.tpl`, whose output is a class (A) owned template artifact regenerated on every sync — no renamed target, no moved project, no retired config, no dropped healing. There is no one-way delta for an existing project to be carried across; the next `--sync` rewrites the file wholesale.
