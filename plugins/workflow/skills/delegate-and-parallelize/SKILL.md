---
name: delegate-and-parallelize
description: >-
  The session is an ORCHESTRATOR, not a worker — delegate the work to subagents and run the independent parts at the same time, recursively, instead of grinding through it serially in the main thread. Use at the START of any request with more than one moving part, and the moment you catch yourself about to read a fifth file, grep the repo "just to check", audit N call sites, review a diff across several dimensions, research several options, or run a long build/test sweep in the main thread — and again whenever a task turns out to have independent pieces mid-flight. The core move — **decompose the goal into units, map the dependencies between them, and delegate every unit that isn't atomic; an agent that receives a still-decomposable unit decomposes it AGAIN, recursively, until a unit is atomic, trivial, strictly serial, or contended.** Two costs are paid by the same mistake of working inline: **CONTEXT** (every file dump and log in the main thread is permanent, and permanent cost is what forces compaction, which degrades every turn after it — a subagent reads forty files and hands back fifteen lines) and **WALL-CLOCK** (independent units run at once, so the cost is the slowest unit, not their sum). So the default is INVERTED: you do not delegate when the work is big, you work inline only when delegating would cost more than it saves. Three tiers — inline, subagents (`Agent`, the everyday tier, freely spawnable and recursively self-spawning), and `Workflow` (deterministic multi-stage orchestration, which needs the user's explicit opt-in). What makes or breaks it is the **delegated-task contract**: a subagent shares NONE of your context, so its prompt must be self-contained and must specify the RETURN SHAPE — a distillation, never a transcript, or you paid the context anyway and gained nothing. And spawning is not finishing: **a parent NEVER exits while a child it spawned is still running** — it waits, checks on long-running children periodically (silence reads the same whether an agent is working or wedged), does independent work between checks rather than idling, and accounts for every child before it closes, stopping deliberately any whose answer no longer matters. Ending a turn with agents in flight leaves ZOMBIES: work burning tokens toward a result nobody will read, edits landing in a tree whose owner already declared it done. Also covers the recursion's termination conditions, write-contention isolation (parallel writers need separate files or separate worktrees), what you must NEVER delegate (the decision, the user's intent, the final synthesis, the human-gated git promotions), and why agent findings are verified rather than believed. An expression of `bespunky-engineering:architect-mentality` — *work smart not hard*, *concentrate complexity so the edges stay simple*, *automate every repeated process*.
---

# Delegate and Parallelize

You are not the workforce. You are the **orchestrator** — the one thread that holds the user's intent, decides what the work *is*, and decides what it *means* when it comes back. Everything between those two points is labour, and labour is exactly what you should not be spending yourself on.

Working inline is the single mistake, and it costs you twice:

- **Context is permanent.** Every file you read, every grep dump, every test log lands in the main window and stays there for the rest of the session. Spend enough and you hit compaction — which does not just cost tokens, it *degrades every turn after it*, because the fidelity of what you knew is replaced by a summary of what you knew. A subagent can read forty files and hand you back fifteen lines; the thirty-nine thousand tokens it burned die with it.
- **Serial work is slow.** Six independent checks done one after another cost the sum of six. Done at once they cost the slowest one.

Both bills are settled by the same move. Delegate.

> **Default inverted: you do not delegate because the work is big. You work inline only when delegating would cost more than it saves.**

---

## Step 0 — decompose before you touch anything

Before the first `Read`, the first `grep`, the first edit, answer three questions about the request:

1. **What are the units?** The independent pieces the goal actually breaks into — per file, per module, per dimension of review, per option being researched, per test suite, per migration site. If you cannot name at least two, it may genuinely be one unit; say so and proceed inline.
2. **What is the dependency graph between them?** *No edges* → they run at once. *A chain* → pipeline them, so unit B enters stage 2 while unit C is still in stage 1. *Convergent* (a stage genuinely needs **all** of the previous stage — a dedup across the full set, an early-exit on a zero count, a comparison against "the other findings") → and only then a barrier.
3. **Which units are atomic?** Those are the leaves. Everything above a leaf is an orchestration decision, not work.

This is the same discipline as [[branch-and-release]]'s relevance check: a **precondition for touching files**, not a cleanup step. Once you have read five files inline, that context is spent and no amount of later delegation refunds it.

---

## The recursion — and exactly where it stops

**A delegated unit that is still decomposable gets decomposed again by the agent that received it.** This is the whole shape of the thing: you hand down a goal, not a chore list, and each level splits what it was given until splitting stops paying. Fan-out that is one level deep is not delegation, it is a queue.

So a delegated prompt should say, in as many words: *if this splits into independent parts, split it and run them concurrently yourself.*

**Terminate at any of these four:**

| Termination | Looks like |
| --- | --- |
| **Atomic** | One indivisible action — edit this function, read this file, run this command. |
| **Trivial** | Describing the task costs more than doing it. A two-line change does not need a courier. |
| **Strictly serial** | Every remaining step needs the previous step's output. A chain is not parallelizable — pipeline it across *items*, never split it across *steps*. |
| **Contended** | The units would fight over the same files, the same port, the same branch. Isolate them (below) or serialize them — never run them into each other. |

**Two guards on the recursion:**

- **A level must reduce the work, not rename it.** If a sub-agent's job description is the parent's job description with a synonym swapped, you have added a hop and a context handoff and bought nothing. Collapse it.
- **Depth is 2–3 in practice.** Orchestrator → workers → their workers. Past that the coordination and the re-explaining cost more than the concurrency returns, and the leaves start solving problems nobody can trace back to the goal.

---

## Three tiers — pick by what the work needs, not by size

| Tier | Use it for | Cost | Authority |
| --- | --- | --- | --- |
| **Inline** (you) | Atomic and trivial units. Decisions. Synthesis. Anything the user must see reasoned. | Main-thread context — the expensive one | Always |
| **Subagent** (`Agent`) | The everyday tier. Any unit that is decomposable, context-heavy, or independent of its siblings. Spawn several in **one message** so they run concurrently; each may spawn its own. | Cheap — its context dies with it | Freely, unless a project forbids it |
| **Workflow** (`Workflow`) | Deterministic multi-stage orchestration — loops, conditionals, fan-out over a discovered work-list, pipelines with verification stages, anything that should run the same way twice. | Can be dozens of agents | **Explicit user opt-in only** — see *Authority* below |

**The hybrid is usually right for large work:** scout inline or with one subagent to *discover* the work-list (which files, which call sites, which dimensions), then fan out over it. You do not need to know the shape before the task — only before the orchestration step.

Depth on the shapes — map, pipeline, barrier, fan-out-then-verify, judge panel, multi-modal sweep, loop-until-dry — is in **[`reference/decomposition-patterns.md`](reference/decomposition-patterns.md)**. Read it when you are choosing a shape, not before.

---

## The delegated-task contract — this is what decides whether any of it works

**A subagent shares none of your context.** Not the conversation, not the file you just read, not the constraint the user stated four turns ago, not the thing you already ruled out. It knows what its prompt says and nothing else. Two failures follow, and both are fatal in the quiet way:

- **An underspecified prompt** produces confident work on the wrong problem, and you will not notice, because what comes back reads exactly like work on the right one.
- **An unspecified return shape** produces a transcript. The agent read forty files and told you about all forty — so the context you delegated to avoid has landed in your window anyway, plus the tokens you spent to get it there. **The return is a distillation. Say so, and say what of.**

The anatomy of a prompt that works, and the failure modes each part prevents, is in **[`reference/writing-a-delegated-task.md`](reference/writing-a-delegated-task.md)**. The irreducible minimum, every time:

- **The goal**, stated so it survives without the conversation around it.
- **The constraints that bind** — the house rules that apply, what it must not touch, what has already been ruled out and why.
- **Where to look**, if you know. A pointer costs one line and saves a search.
- **The return shape** — explicitly. *"Return the file:line of each call site and one sentence on whether it needs changing. No file contents."* Where the tier supports it, a schema is better than a sentence, because it is enforced rather than requested.
- **Permission to recurse** — if this splits, split it.

---

## Isolation — parallel writers are the one way this corrupts things

Read-only fan-out is always safe; run as much of it as you like. Writes are where concurrency bites:

- **Distinct files → fine.** State each agent's file boundary *in its prompt*. Boundaries that live only in your head are boundaries the agents will cross.
- **Same files → not fine.** Two agents editing one file produce a file that reflects neither of them. Either serialize those units, or give each agent its own **git worktree** so they edit separate copies (`isolation: "worktree"`; it costs setup time and disk, so use it when writes genuinely collide and not by default).
- **Same port, same server, same branch → not fine either.** See [[local-server-isolation]] — parallel agents each starting a dev server is exactly the collision that skill exists to prevent, multiplied.
- **Git is single-threaded here.** Branching, merging, promoting, releasing — one actor, the main thread, under [[branch-and-release]]. Never fan out a promotion.

---

## What you never delegate

Delegates **gather and execute**. You **decide**. The line is not about difficulty, it is about who is accountable to the user:

- **The decision itself** — which design, which tradeoff, which of the options. An agent can research three approaches and report them; choosing is yours, because you are the one holding what the user actually wants.
- **Interpreting the user's intent.** The agent never heard them.
- **The final synthesis.** Findings from six agents are six findings, not an answer. Reconciling them — including noticing where two of them contradict — is the job you kept.
- **Anything human-gated.** The three promotion gates, a release, a destructive or outward-facing action. A gate that a subagent can walk through is not a gate.
- **Anything you cannot verify.** If you would not be able to tell a good result from a plausible one, delegating it does not produce a result — it produces a claim.

---

## Supervision — a parent NEVER exits while its children are running

**Spawning is not finishing.** The moment you delegate, you have taken on a second job: seeing those agents through. A parent that hands out five tasks and then ends its turn has not delegated — it has abandoned. What it leaves behind is **zombie agents**: work still burning tokens toward a result nobody is waiting for, findings that arrive after the conversation moved on, file edits landing in a tree whose owner already declared it done. This applies at every level, so it applies *recursively* — a subagent that spawned its own children owes them the same duty before it returns.

> **You may not report, conclude, or hand back while a child you spawned is still in flight. Every agent you start, you finish.**

**Wait properly, don't poll blindly.** Background agents notify you when they complete — that notification is the primary signal, and re-invoking or busy-waiting for it is wasted spend. When you need a result *before* you can take the next step, run that agent synchronously rather than starting it and guessing at when it lands.

**Check on them anyway — silence is not progress.** Notification covers the agents that finish; supervision covers the ones that don't. Long-running children go quiet for two very different reasons, and from the outside they look identical, so periodically ask which one you are looking at:

- **Still working** — leave it be.
- **Stuck** — blocked on something that will never arrive (a prompt it cannot answer, a command waiting on input, a dependency that failed), or looping. It will never notify you, so waiting is waiting forever.

Between checks, do the work that does not depend on them. Idle waiting is the one thing worse than serial execution: you paid for concurrency and then spent it standing still.

**Account for every child before you close.** Run the roster at the end, not from memory:

- **Completed** — its result is in hand and folded into the synthesis.
- **Failed or returned nothing** — say so in the report. A dropped agent is a hole in the coverage, and an unmentioned hole reads as coverage.
- **Still running when the goal is already settled** — its answer no longer changes anything, so **stop it deliberately** rather than leaving it to run out. Stopping is a decision you make and state; drifting away from it is not.
- **Never assume an outcome you were not told.** A child you did not hear back from has not "probably finished". If a result has not arrived, you do not have it — and you never write the notification yourself.

`Workflow` handles most of this for you by construction: every `agent()` call is awaited, and a stage cannot outlive the script that owns it. That is a reason to prefer it for large fan-outs — supervision is structural there, rather than something you must remember.

---

## Verify what comes back — agents are confident, not correct

A subagent's report is **evidence, not truth**. It read a slice of the repo, alone, and it will hand you a clean finding built on a misread just as readily as a real one. Before a finding changes what you do:

- **Spot-check the anchors.** A `file:line` that does not exist, a symbol that was renamed, a flag that was removed — these are the cheap tells, and they are one `grep` away.
- **Reconcile contradictions rather than averaging them.** Two agents disagreeing means at least one is wrong about something specific. Find out which; do not split the difference.
- **For findings that carry weight, verify adversarially** — a second agent whose job is to *refute* the claim, not to confirm it. Confirmation-seeking verification confirms.

---

## Reporting back — they did not watch the fan-out

The user saw none of it: not the twelve agents, not the tree, not the retries. **Report the conclusion and what it means, never the org chart.** How many agents ran is process trivia; what was found, what changed, and what still needs their decision is the report. If part of the fan-out failed or returned nothing, say that plainly — a short report that quietly drops a hole in the coverage is not concise, it is misleading.

---

## Anti-patterns

- **Fan-out theatre.** Ten agents for a two-file change. Coordination is not free; below a certain size the delegation costs more than the work.
- **The barrier that wanted to be a pipeline.** Waiting for all of stage 1 in order to `map`/`flatten`/`filter` it is not a cross-item dependency — do the transform inside the stage and let each item flow on.
- **Sequential fan-out.** Spawning agents in separate messages, one per turn, and waiting on each. Independent agents go out **in a single message** or they are not parallel at all.
- **Fire and forget.** Spawning agents and ending the turn. The work does not stop when you stop watching it — it just stops being anyone's.
- **Idle waiting.** Blocking on a child while independent work sits undone. You bought concurrency and then stood still holding it.
- **The courier.** An agent whose whole output is the contents of what it read. That is a `Read` with extra steps and a worse signal-to-noise ratio.
- **The blind orchestrator.** Fanning out before you know the work-list, so half the agents are told to look for things that do not exist. Scout first, then fan out.
- **Fire-and-forget.** Spawning agents and ending the turn. The children keep running with nobody to receive them — zombies burning tokens toward a result that will never be read.
- **Declaring done with children in flight.** "Everything checks out" while three verifiers are still working is a guess wearing a conclusion's clothes.
- **Idle waiting.** Blocking on a slow child with independent work sitting untouched. You bought concurrency and then declined to use it.
- **Delegating the part you actually needed to understand.** If the next decision depends on you having the shape of the thing in your head, reading it yourself *is* the cheap option.
- **Silent truncation.** Capping at the top-N sites, skipping retries, sampling — fine, sometimes necessary. Saying nothing about it is not: an unstated cap reads as full coverage.

---

## Authority — when you may actually launch these

Delegation is a way of working, not a licence, and the two tiers differ:

- **Subagents are the default tier** and need no ceremony. Spawn them as the work calls for them.
- **`Workflow` needs the user's explicit opt-in** — it can spawn dozens of agents and spend accordingly, so the user opts in, you do not opt in on their behalf. It counts as opt-in when they say so in their own words ("use a workflow", "fan out agents"), when a session-level setting says so, or **when the user invokes this skill by name** — `/bespunky-workflow:delegate-and-parallelize` *is* the request to orchestrate, and workflows are authorized for that turn.
- **When this skill fires on its own** — because the request looked parallelizable — that is guidance, not consent. Delegate to subagents freely; for a workflow, **say what it would do and roughly what it would cost, and let them say yes.** A skill that auto-fired cannot authorize its own spending; that is laundering the opt-in, and the same reasoning is why this repo's version hook *detects and relays* rather than executes.
- **A project can override any of this.** If the working repo's `CLAUDE.md` or house rules restrict subagents, that wins — read it as the parameter, this skill as the method.
