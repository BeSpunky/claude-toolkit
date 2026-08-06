---
name: delegate-and-parallelize
description: >-
  The session is an ORCHESTRATOR, not a worker — delegate the work to subagents and run the independent parts at the same time, recursively, instead of grinding through it serially in the main thread. Use at the START of any request with more than one moving part, and the moment you catch yourself about to read a fifth file, grep the repo "just to check", audit N call sites, review a diff across several dimensions, research several options, or run a long build/test sweep in the main thread — and again whenever a task turns out to have independent pieces mid-flight. The core move — **decompose the goal into units, map the dependencies between them, and delegate every unit that isn't atomic; an agent that receives a still-decomposable unit decomposes it AGAIN, recursively, until a unit is atomic, trivial, strictly serial, or contended.** Two costs are paid by the same mistake of working inline: **CONTEXT** (every file dump and log in the main thread is permanent, and permanent cost is what forces compaction, which degrades every turn after it — a subagent reads forty files and hands back fifteen lines) and **WALL-CLOCK** (independent units run at once, so the cost is the slowest unit, not their sum). So the default is INVERTED: you do not delegate when the work is big, you work inline only when delegating would cost more than it saves. Three tiers — inline, subagents (`Agent`, the everyday tier, freely spawnable and recursively self-spawning), and `Workflow` (deterministic multi-stage orchestration, which needs the user's explicit opt-in). What makes or breaks it is the **delegated-task contract**: a subagent shares NONE of your context, so its prompt must be self-contained and must specify the RETURN SHAPE — a distillation, never a transcript, or you paid the context anyway and gained nothing. And spawning is not finishing: **a parent NEVER exits while a child it spawned is still running** — it waits, checks on long-running children periodically (silence reads the same whether an agent is working or wedged), does independent work between checks rather than idling, and accounts for every child before it closes, stopping deliberately any whose answer no longer matters. Ending a turn with agents in flight leaves ZOMBIES: work burning tokens toward a result nobody will read, edits landing in a tree whose owner already declared it done. And the tree must OUTLIVE the session that started it: a crash, a dropped connection, a deliberate or mistaken stop, a permissions error, a container rebuild all evaporate the orchestrator's context — so **nothing is dispatched before the plan is on disk**, and every state change is written as it happens into a resumable LEDGER in the effort's package (stable unit ids, per-unit status, the returned distillations stored INLINE rather than as references to agents that no longer exist, any `Workflow` runId verbatim since resume is impossible without it, and what was NOT covered). Every agent at every depth leaves traces — durable output written to disk first and merely summarized in its return value, its own ledger if it fanned out, and mutations announced — so a fresh session resumes the outstanding work instead of re-running the expensive work that already succeeded. Also covers the recursion's termination conditions; **isolation as a JUDGMENT rather than a reflex** — first try to dissolve write contention entirely (many readers analysing in parallel, ONE writer applying), then prefer a single shared tree with declared path boundaries, and open a worktree per agent only when units genuinely edit the same files, are competing alternatives, or must build and test independently — with the chosen arrangement stated in the prompt and the child given authority to make the same call for its own sub-units; what you must NEVER delegate (the decision, the user's intent, the final synthesis, the human-gated git promotions); and why agent findings are verified rather than believed. **NOT for** work that is genuinely one unit, a change small enough that describing it costs more than doing it, or a strictly serial chain — fanning out there is theatre, and this skill says so. An expression of `bespunky-engineering:architect-mentality` — *work smart not hard*, *concentrate complexity so the edges stay simple*, *automate every repeated process*.
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
| **Subagent** (`Agent`) | The everyday tier. Any unit that is decomposable, context-heavy, or independent of its siblings. Spawn several in **one message** so they run concurrently. Recursion depends on the **agent type** you pick: a general-purpose agent holds the Agent tool and can fan out again; a restricted read-only type cannot, so hand *it* only leaf work. | Cheap — its context dies with it | Freely, unless a project forbids it |
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
- **The duty to leave traces** — write durable output to the package as you go and return a summary of what you wrote, not the only copy of it; keep your own ledger if you fan out.

---

## Isolation — a judgment call, not a reflex

Read-only fan-out is always safe; run as much of it as you like. Writes are where you have to actually *think*, and the thinking is not "worktree or not" — it is **choose the cheapest arrangement that makes the collision impossible**. There are three, and reaching for the heaviest by default is as much a mistake as ignoring the problem.

### First, try to dissolve the contention rather than manage it

**Separate finding from applying.** Most "parallel writers" problems are not write problems at all: N agents *analyse* (read-only, so unlimited concurrency, no isolation of any kind) and **one** agent — often you — applies the resulting edits. Analysis is the slow, context-heavy part and it parallelizes perfectly; mutation is the fast part and it does not need to.

Ask this before any isolation decision. When it works, it is strictly better than both options below: full concurrency where the cost is, no coordination overhead, no merge, no divergence. Reach for a real isolation strategy only for the writes that survive this question.

### Then choose between one tree and many

| | **Coordinate in ONE tree** | **A worktree each** |
| --- | --- | --- |
| **Use when** | Units touch **disjoint files**; the work is small; units must see each other's output to be correct (B compiles against A's new signature); integration is the hard part and you want the combined state immediately | Units genuinely edit the **same files**; they are **competing alternatives** you will choose between; each needs to **build or test independently**; one may be abandoned wholesale |
| **You pay** | Coordination: boundaries must be declared and honoured, and one agent's broken intermediate state can fail another's test run | Setup time, disk, a dependency install per tree — and a merge back, with its own conflicts |
| **Fails like** | Two agents edit one file; the result reflects neither | Divergent trees that each work alone and conflict together |

**The default is one tree with declared boundaries**, because it is nearly free and most decompositions naturally partition by file. Escalate to worktrees when the table's right-hand column actually describes your units — not preemptively.

Three consequences worth stating plainly:

- **Declare every boundary in the prompt.** "You own `src/api/**`; do not edit outside it." A boundary that lives only in your head is a boundary the agents will cross, because they cannot see it.
- **Transient breakage cross-contaminates.** In a shared tree, an agent that half-finishes a refactor makes *everyone else's* verification lie. If units must run builds or tests to know whether they succeeded, that alone is a reason to separate them.
- **A unit big enough to need its own branch is not a unit.** It is its own effort, with its own worktree and package under [[branch-and-release]] — promote it out of the fan-out rather than nesting a feature inside one.

### The decision recurses

This is an orchestration judgment, so it belongs to whoever is doing the orchestrating — which, past depth 1, is the child. **State the isolation strategy in the prompt you hand down**, along with the authority to make the same call for its own children: *"you own these paths; if you fan out further, partition within them, and open worktrees only if your own sub-units collide on the same files."* A child that does not know the arrangement will invent one, and it will invent a different one than its sibling.

### And the rest of the shared world

- **Same port, same server → not fine.** See [[local-server-isolation]] — parallel agents each starting a dev server is exactly the collision that skill exists to prevent, multiplied by N.
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

**A stuck child needs a decision, not more patience.** Three moves, in order of preference: **unblock it** (send it the answer or the missing constraint, if the tier lets you message a running agent); **stop it and re-dispatch** a narrower version of the same unit, with whatever tripped it removed from its path; or **stop it and route around** — mark the unit failed in the ledger, and say in your report what that leaves uncovered. What you must not do is let it hang while the rest of the tree waits on a result that is never coming.

Between checks, do the work that does not depend on them. Idle waiting is the one thing worse than serial execution: you paid for concurrency and then spent it standing still.

**Account for every child before you close.** Run the roster at the end, not from memory:

- **Completed** — its result is in hand and folded into the synthesis.
- **Failed or returned nothing** — say so in the report. A dropped agent is a hole in the coverage, and an unmentioned hole reads as coverage.
- **Still running when the goal is already settled** — its answer no longer changes anything, so **stop it deliberately** rather than leaving it to run out. Stopping is a decision you make and state; drifting away from it is not.
- **Never assume an outcome you were not told.** A child you did not hear back from has not "probably finished". If a result has not arrived, you do not have it — and you never write the notification yourself.

`Workflow` handles most of this for you by construction: every `agent()` call is awaited, and a stage cannot outlive the script that owns it. That is a reason to prefer it for large fan-outs — supervision is structural there, rather than something you must remember.

---

## Resumability — the tree must survive the session that started it

An agent tree lives in **volatile state**: your context. The machine crashes, the network drops, the user hits stop (deliberately or by accident), a folder throws a permissions error, the container restarts — and everything the orchestrator knew evaporates. Three things die that were never in any danger had they been written down:

1. **The plan** — what the units even were. Reconstructing it means re-deciding it, and you will decide differently.
2. **The dispatch state** — what was sent, what came back, what is still outstanding. Without it, resume means re-running *everything*, including the expensive work that already succeeded.
3. **The results already returned** — distillations you paid full price for, discarded because they only ever existed in a context window.

> **Nothing is dispatched before the plan is on disk, and every state change is written as it happens — never reconstructed afterwards.**

This is [[feature-package]]'s rule applied to the fan-out, for the same reason: a record written at the end is a memory, and memories are confidently wrong about exactly the parts that matter.

### The ledger, and where it lives

A crash is a **context boundary** — an involuntary one — so the ledger is a [[session-handoff]] baton in the ordinary sense, living in the effort's package: **`docs/features/<YYYY-MM-DD>-<slug>/handoffs/<ts>-fanout.md`**. Do not invent a parallel home for it; the one that exists is already the one a fresh session knows to look in.

**A fan-out is never "trivial work", so it always has a package.** [[feature-package]] lets you skip the package for a typo fix — but work large enough to decompose and delegate is by definition not that, and a ledger with nowhere to live is a ledger that does not get written. If the effort has no package yet, opening one *is* the first step of the fan-out.

It holds:

- **The goal**, in one line — so a fresh reader knows what the tree was for.
- **The unit list, each with a STABLE ID.** Resume matches units by identity, never by position — a list that renumbers when one entry is removed is a list that resumes the wrong work.
- **The shape** — the dependency graph or stage layout, so resume knows what may run now and what is still blocked.
- **Per unit: its status** — `pending` · `dispatched` · `returned` · `failed` · `stopped` — updated when it changes, not at the end.
- **The returned result itself, inline.** Not a reference to an agent that no longer exists. A distillation that lives only as a return value dies with the orchestrator that received it.
- **The `runId` and `scriptPath` of any `Workflow`**, verbatim — both come back in the tool's own result, so copy them into the ledger *the moment it returns*, before you even read the findings. Its resume is genuinely cheap — an unchanged prefix of agent calls returns from the journal instead of re-running — but it is *impossible* without the run id. Losing that one string converts a resumable run into a full re-run.
- **What is NOT covered** — caps applied, items skipped, agents that returned nothing. Resume needs the holes as much as the fills.

**Commit the ledger as you go.** An uncommitted file survives a stopped turn but not a rebuilt container, and [[branch-and-release]] already asks for small committed increments — the ledger is one of them.

### What this asks of every agent, at every depth

- **Leave the trace, don't just return it.** A child that produced something durable writes it into the package itself; the return value is a *summary of what it wrote*, not the only copy of it.
- **A child that fans out owes its own ledger.** The duty recurses exactly as the decomposition does — otherwise a subtree resumes as an opaque "something was happening here".
- **Make units re-runnable, or mark them so they aren't.** Resume must be able to tell *done* from *never started*, and re-running a read-only audit is free while re-running a mutation is not. Say which each unit is.
- **Prefer mechanisms that are resumable by construction.** `Workflow` journals every call and resumes from a run id. Small, frequent commits make git itself the resume trace for file mutations: a half-finished tree is legible when the finished half is committed, and a mystery when it isn't.

The ledger's exact format, the write ordering that makes it trustworthy, and the step-by-step resume procedure are in **[`reference/resuming-a-fanout.md`](reference/resuming-a-fanout.md)**.

### On interruption, report the resume path

If a turn ends with work outstanding — stopped, failed, or simply unfinished — say so plainly, name where the ledger is, and state what resuming would pick up. A silent stop is indistinguishable from a completed job, and that is precisely the confusion that makes someone re-run the whole tree.

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
- **Sequential fan-out.** Spawning one agent, awaiting it, spawning the next. It is *awaiting* each in turn that destroys the concurrency, not the message boundary itself — but batching independent agents into **one message** is the reliable way not to fall into it.
- **Dispatching before the plan is on disk.** The gap between the first spawn and the first write is the window where an interruption costs you the plan itself.
- **The ledger written at the end.** Then it is a memory of the run, not a record of it — and it never gets written at all, because the runs that need it most are the ones that don't reach the end.
- **Losing the run id.** One unrecorded string turns a resume that costs almost nothing into a full re-run.
- **Fire and forget.** Spawning agents and ending the turn. The work does not stop when you stop watching it — it just stops being anyone's.
- **Idle waiting.** Blocking on a child while independent work sits undone. You bought concurrency and then stood still holding it.
- **The courier.** An agent whose whole output is the contents of what it read. That is a `Read` with extra steps and a worse signal-to-noise ratio.
- **The blind orchestrator.** Fanning out before you know the work-list, so half the agents are told to look for things that do not exist. Scout first, then fan out.
- **Declaring done with children in flight.** "Everything checks out" while three verifiers are still working is a guess wearing a conclusion's clothes.
- **Delegating the part you actually needed to understand.** If the next decision depends on you having the shape of the thing in your head, reading it yourself *is* the cheap option.
- **Silent truncation.** Capping at the top-N sites, skipping retries, sampling — fine, sometimes necessary. Saying nothing about it is not: an unstated cap reads as full coverage.

---

## Authority — when you may actually launch these

Delegation is a way of working, not a licence, and the two tiers differ:

- **Subagents are the default tier** and need no ceremony. Spawn them as the work calls for them.
- **`Workflow` needs the user's explicit opt-in** — it can spawn dozens of agents and spend accordingly, so the user opts in, you do not opt in on their behalf. It counts as opt-in when they say so in their own words ("use a workflow", "fan out agents"), when a session-level setting says so, or **when the user invokes this skill by name** — `/bespunky-workflow:delegate-and-parallelize` *is* the request to orchestrate, and workflows are authorized for that turn.
- **When this skill fires on its own** — because the request looked parallelizable — that is guidance, not consent. Delegate to subagents freely; for a workflow, **say what it would do and roughly what it would cost, and let them say yes.** A skill that auto-fired cannot authorize its own spending; that is laundering the opt-in, and the same reasoning is why this repo's version hook *detects and relays* rather than executes.
- **A project can override any of this.** If the working repo's `CLAUDE.md` or house rules restrict subagents, that wins — read it as the parameter, this skill as the method.

---

## Related

- **`bespunky-workflow:feature-package`** — where the ledger lives, and why the fan-out does not get a home of its own.
- **`bespunky-workflow:session-handoff`** — the baton format the ledger is an instance of; a crash is just an involuntary context boundary.
- **`bespunky-workflow:branch-and-release`** — worktrees, the single-threaded git rule, and the promotion gates a fan-out must never cross.
- **`bespunky-workflow:local-server-isolation`** — the port collision, multiplied by every agent that starts a server.
- **`bespunky-engineering:architect-mentality`** — *work smart not hard*, *concentrate complexity so the edges stay simple*, *automate every repeated process*: the mindset this skill is one application of.

## Ask yourself

- Did I decompose **before** touching a file, or am I rationalizing after five reads?
- Is the plan on disk? Would a crash right now cost me anything I could have written down?
- Does every prompt I sent state its **return shape** — and would the answer fit in a paragraph?
- For the writes: did I try to **dissolve** the contention (many readers, one writer) before choosing an isolation strategy?
- Is anything I spawned still running that I have stopped thinking about?
- If I ended the turn now, could a fresh session pick this up — or would it have to start over?
