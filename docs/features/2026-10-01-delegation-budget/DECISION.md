---
status: concluded
concluded: 2026-10-01
summary: delegate-and-parallelize now runs against a conserved agent budget (default 12) that caps the tree's total, never its depth; the tree is estimated before dispatch and the user confirms any larger figure.
tags: [workflow, delegate-and-parallelize, agent-budget, usage-limits]
---

# Delegation budget — cap the tree's total, never its depth

## The problem, in the user's words

> "Our delegate and parallelize skill is great but it has no cap so heavy aganting tops my Claude limits. What is a way we can cap it without loosing deep paralelization?"

## Root cause

`delegate-and-parallelize` priced only two costs — main-thread **context** and **wall-clock** — and called the subagent tier *"Cheap — its context dies with it"*. Cheap for the orchestrator's window, not for the usage bill: every token any agent burns is billed. Combined with "delegate unless it costs more" and unbounded recursion, the agent count grows geometrically with depth (5 × 5 × 5) and nothing in the skill ever pushes back.

## Options considered

1. **A conserved agent budget, carved down the tree** — chosen.
2. Model tiering (leaves on a cheaper model) — offered, not taken in this effort.
3. Batching more items per leaf — folded into #1 as *how* to fit the budget.
4. Raising the inline threshold — partly folded into #1 (the third cost is now priced).

Rejected outright: a **depth cap** or a **width cap**. Both bound the wrong axis — a depth cap kills exactly the nested parallelism the user asked to keep, and a width cap still lets depth multiply.

## The user's decision and constraint

> "#1 yes, and make sure nested delegation still works. Meaning, that it doesn't limit subagents and tells them not to spawn more sub and subsub agents"

So the budget must bound the **total** while leaving **depth** free, and the wording handed to a child must be an *allowance to recurse*, never a ban on spawning.

## The design

- **Budget = agents the whole tree may still create.** Default 12 per request (originally 10 — see the revision below); the user can set it per request, a project's `CLAUDE.md` can set its own default.
- **Conserved, carved down the tree.** Spawning a child with share *s* costs *1 + s*; the child's share covers its entire subtree; unspent share returns to the parent.
- **Nesting is protected by shaping the decomposition to the budget** — fewer, fatter units at the top, each with share enough to fan out, batched items per leaf — rather than spending the whole budget on width at level 1 (which is how a budget silently becomes a depth cap).
- **Prompts state the share as permission** — "you may delegate further; your subtree may create up to N more agents" — never "do not spawn".
- **Exhaustion degrades, it does not fail** — an agent at zero does its unit inline (batched), and may ask its parent for more share in its return.
- **Recorded** in the ledger (total, per-unit share, spent) and **reported** whenever the budget forced batching or cut coverage.

## Revision — estimate first, ask before exceeding

> "Change to 12 as default, have Claude evaluate the work and estimating the agent tree that will be spawned before delegating then, if the estimation says more than the default amount is needed, ask the user to confirm a larger amount"

- **Default raised to 12.**
- **Estimate before dispatch** — Step 0 gains a fourth question: sketch the whole tree and count its agents before the first spawn.
- **Estimate over budget → ask the user**, once, from the orchestrator, with the estimate, the shape driving it, and what the budget in force would buy instead. The answer becomes this request's budget and is recorded in the ledger.
- Chosen over "proceed and report": the point is consent *before* the spend.
- **Children never ask the user** — they cannot reach them and do not hold the whole tree; a child's request for more share climbs to the orchestrator, which asks again only if it would exceed what the user confirmed. **Headless runs** fit to the budget in force rather than exceed it. **A changed work-list** (a scout finding far more than assumed) triggers a re-estimate and, if needed, a new ask.
