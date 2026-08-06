# Writing a delegated task

A subagent starts from a **blank slate**. It did not read the conversation, does not know the file you just opened, never heard the constraint the user stated four turns ago, and has no idea which two approaches you already ruled out. It knows its prompt. That is all.

Everything below follows from that one fact.

---

## The two silent failures

- **Underspecified prompt → confident work on the wrong problem.** You will not catch it by reading the result, because good work on the wrong question is indistinguishable from good work on the right one until you check it against the goal.
- **Unspecified return shape → a transcript.** The agent read forty files and tells you about all forty. The context you delegated in order to *avoid* has now landed in your window anyway, and you paid the agent's tokens for the privilege.

The second is the one that quietly makes the whole practice pointless. Guard it hardest.

---

## Anatomy of a prompt that works

**1 — The goal, standalone.** Written so it survives with no conversation around it. Not *"do that for the other files too"* — name them, name the operation, name what done looks like.

**2 — The constraints that bind.** House rules that apply, the things it must not touch, the approaches already rejected and *why*. A child that re-proposes the thing you ruled out has wasted a full round trip, and it will, because nobody told it.

**3 — Where to look.** If you know, say. A pointer costs one line and saves a repo-wide search — and the search it saves is one you would otherwise pay for in wall-clock.

**4 — What NOT to do.** Usually more valuable than what to do. *Don't edit anything. Don't run the test suite. Don't fix what you find — report it.* An agent with initiative and no boundary is how a read-only audit ends in unreviewed edits.

**5 — The return shape, explicitly.** The single most load-bearing line. Say what comes back and what does not:

> *"Return one row per call site: `file:line`, the argument it passes, and yes/no on whether it needs changing. No file contents, no code blocks, no commentary."*

Where the tier supports a **schema** — a workflow's `agent()` call takes one — use it: a schema is validated at the tool boundary and the agent is made to retry on mismatch, where a sentence in a prompt is merely a request.

**6 — Permission to recurse.** *"If this splits into independent parts, split it and run them concurrently yourself."* Without this, a child does a decomposable job serially and you lose a whole level of parallelism.

**7 — Its own supervision duty.** A child that spawns children owes them the same wait you owe it. Say so: *"wait for anything you spawn; don't return while your own children are still running."*

---

## Calibrating the return

Match the return to what the *next decision* actually needs — nothing more:

| You need | Ask for |
| --- | --- |
| A yes/no or a pick | The verdict plus one sentence of reasoning |
| To act on locations | `file:line` anchors and one clause each — never the code |
| To synthesize across agents | A fixed schema, identical across siblings, so results compose |
| To understand a mechanism | A short explanation in the agent's own words, capped in length |
| To know it's done | What was changed and what was verified — not how it went |

**Cap it.** "Under 200 words", "at most 10 rows", "one paragraph". An uncapped return is an invitation, and it will be accepted.

---

## Bad → good

**Bad:**
> Look into the auth stuff and see if there are problems.

Blank-slate agent, unbounded scope, no anchors, no return shape. It will read broadly, find something, and hand you an essay you must now read in full.

**Good:**
> Audit every call site of `verifyToken()` in `src/` for the missing-expiry-check bug: a call that passes a token but never checks `exp`.
>
> Do not edit anything. Do not fix what you find.
>
> Return one row per call site — `file:line`, whether `exp` is checked (yes/no), and if no, one clause on what it would take to fix. Nothing else; no code blocks. Under 150 words.

---

## Choosing what to spawn

- **Agent type** — use a specialized one where it fits (read-only search agents for sweeps, planning agents for design). Specialized agents come with narrower tools, which is a *feature*: an agent that cannot write cannot accidentally write.
- **Model and effort** — inherit by default. Override only when you are confident the tier is wrong for the task: cheap and mechanical goes down, a genuinely hard verification or judgment goes up. Unsure means omit.
- **Recursion capability is a property of the type.** A general-purpose agent can fan out again; a restricted read-only type cannot spawn anything. Hand a decomposable unit to something that can actually decompose it, and give leaf work to the narrow types.
- **Isolation** — decided per fan-out, not per habit: try to dissolve the contention first (many readers, one writer), then a shared tree with declared path boundaries, and a worktree each only when units genuinely collide, compete, or must build independently. **Whichever you choose, say so in the prompt** — including the child's authority to make the same call for its own sub-units.

---

## The failure modes, collected

- **The courier** — the whole return is the contents of what it read. A `Read` with extra steps and worse signal.
- **The essayist** — narrates its process ("first I looked at…, then I considered…"). Ask for conclusions; say that the process is not wanted.
- **The freelancer** — went past the brief and changed things. Prevented only by an explicit boundary.
- **The amnesiac** — re-proposes what was already rejected. Prevented only by passing the rejected options down.
- **The optimist** — reports success it did not verify. Ask what it *checked*, not what it *did*.
- **The serialist** — did a decomposable job one item at a time. Prevented by the recursion clause.
- **The deserter** — returned while its own children were still running. Prevented by the supervision clause.

Every one of these is a missing line in the prompt. When a delegated task comes back wrong, fix the prompt before you fix the result — you will be sending that same prompt again.
