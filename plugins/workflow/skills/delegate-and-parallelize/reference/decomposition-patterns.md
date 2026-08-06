# Decomposition patterns — reading the shape off the dependency graph

The shape of the fan-out is not a style choice. It is **dictated by the dependency graph** you drew in step 0. Draw the graph, then read the pattern off it:

| What the graph looks like | Pattern |
| --- | --- |
| N units, no edges between them | **Map** |
| N units, each passing through the same K stages | **Pipeline** |
| A stage that genuinely needs *all* of the previous stage | **Barrier** |
| You don't know the units yet | **Scout, then fan out** |
| Units produce claims that could be wrong | **Fan-out then verify** |
| One question, many valid answers | **Judge panel** |
| One target, many ways to look for it | **Multi-modal sweep** |
| Unknown-size discovery | **Loop until dry** |
| A unit that is itself a graph | **Recursive descent** |

---

## Map — the base case

N independent units, same operation, no ordering. Spawn them **in one message** and let them run at once. The cost is the slowest unit, not the sum.

Fits: auditing N call sites, summarising N modules, checking N configs, running N independent test suites.

The only real trap is forgetting that map is the *base case* — that each of those N units may itself decompose (see *Recursive descent*).

## Pipeline — the default for multi-stage work

Each item flows through stage 1 → stage 2 → stage 3 **on its own schedule**. Item A can be in stage 3 while item C is still in stage 1. Nothing waits for a cohort.

This is the default whenever work has stages, and it is almost always what people reach for a barrier to do. Wall-clock is *the slowest single item's whole chain* — not the sum of each stage's slowest item.

> **The smell test:** if between two fan-outs you only `map`, `flatten`, or `filter` the results, there was no cross-item dependency and the barrier was never needed. Move the transform inside the stage.

## Barrier — only when a stage needs the whole set

A barrier is correct in exactly three situations:

- **Dedup or merge** across the full result set before something expensive downstream.
- **Early exit** on an aggregate — "zero findings, skip verification entirely".
- **Cross-item comparison** — the next stage's prompt genuinely refers to "the other findings".

It is *not* justified by "the stages feel separate", "it reads more cleanly", or "I need to reshape the results first". Each of those buys you idle time: if the fastest unit finishes in a third of the slowest, a barrier throws away two thirds of that head start.

## Scout, then fan out — the hybrid, and usually the right opening move

You rarely know the work-list before you start. So don't guess it and don't fan out blindly:

1. **Scout** — one agent (or a quick inline pass) *discovers* the units: which files, which call sites, which dimensions, which options.
2. **Fan out** over what it found.

You do not need to know the shape before the *task* — only before the *orchestration step*. Fanning out ahead of the scout is how half your agents end up hunting for things that do not exist.

## Fan-out then verify — for anything that produces claims

Findings, bugs, security issues, "this is safe to delete" — claims are cheap to generate and expensive to be wrong about. Pipeline each finding straight into verification as it arrives, rather than collecting them all first.

**Verify adversarially.** A verifier told to *check* a claim confirms it; a verifier told to **refute** it does the work. For weighty findings, use several verifiers and take a majority — and where a claim can fail in more than one way, give each verifier a **different lens** (does it reproduce? is it correct? is it a security issue? does it matter?) rather than N identical skeptics. Diversity catches what redundancy cannot.

## Judge panel — when the solution space is wide

Generate N *independent* attempts from deliberately different angles (risk-first, simplest-thing-first, user-first), score them with parallel judges, then synthesize from the winner while grafting the good ideas out of the runners-up.

Beats one-attempt-then-iterate whenever the first plausible answer would anchor you. Costs N times as much — spend it on decisions that are expensive to reverse, not on routine work.

## Multi-modal sweep — when one search angle won't find everything

Parallel agents each searching a **different way**: by filename, by symbol, by content, by call graph, by git history, by test. Each is blind to what the others turn up, which is exactly the point — a single search strategy has a shape, and things hide in its blind spot.

## Loop until dry — for unknown-size discovery

When you cannot know how many there are (bugs, edge cases, dead code), do not pick a number. Loop: run finders, **dedup against everything seen so far**, and stop after K consecutive rounds surface nothing new.

> **Dedup against *seen*, never against *confirmed*.** Otherwise every rejected finding is rediscovered each round and the loop never converges.

## Recursive descent — the pattern that makes the rest scale

A delegated unit that is still a graph gets decomposed by the agent that received it, which applies these same patterns one level down. This is what turns a flat queue into actual delegation.

Give the child **permission and expectation**: *"if this splits into independent parts, split it and run them concurrently yourself."* And keep the two guards — a level must **reduce** the work rather than rename it, and depth stays at 2–3 before coordination costs exceed what concurrency returns.

## Completeness critic — the cheap last stage

One final agent asking the question the busy ones didn't: *what is missing — a search angle never run, a claim never verified, a file never read, a case never considered?* What it finds is either the next round of work or an honest note in your report about where coverage stops.

---

## Composing them

Real work stacks these. A thorough audit is often: **scout** → **multi-modal sweep** (barrier, to dedup) → **map** the fresh findings → **perspective-diverse verify** each → **loop until dry** → **completeness critic**. A design decision is often: **scout** → **judge panel** → synthesize.

Scale the composition to the ask. "Does this look right?" gets a couple of agents and one verification pass. "Audit this thoroughly" earns the full stack. Reaching for the full stack on a small question is its own failure — coordination is not free, and an org chart is not rigour.
