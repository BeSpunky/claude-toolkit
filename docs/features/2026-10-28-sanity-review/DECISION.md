---
effort: sanity-review
summary: Ship a sanity-review agent + skill + always-on directive so Claude critically reviews and fixes substantial work across specialised dimensions before handing control back — no hook.
---

# Sanity review — decisions

**The ask, in the user's words:** *"Something I always do after giving Claude a long running task before approving it and merging it is this: 'Send specialized agents to highly critic, review and sanity check the implementation. Give the agents specific topics to take care of, such as code architecture, reusability, scalability, clean code, bugs, UX, DX, security, and anything else that you see fit. Fix anything that comes up.' I have to do this manually each time and I'd like to have Claude do that automatically before returning control back to me."* · *"I want our toolkit to ship with the agent and the directive built-in so all repos would benefit from it."*

## Decided

- **No Stop hook.** Researched first (Claude Code 2.1.312): a `Stop` hook can block the hand-back and feed Claude a reason, and it is the only *reliable* trigger. But `Stop` fires on every turn end — including a turn that ends with a plain-text question to the user — so it needed a "pausing vs finished" handshake. Proposed; the user: *"No hook. Feels like an overkill"*. The trigger is therefore the always-on `HOUSE.rules.md` directive plus the skill's description. Reopen only if reviews are observed being skipped.
- **Not `prompt`/`agent` hook types, not `/goal`.** A prompt hook has no tools; an agent hook is read-only with a 60s default timeout — they can judge, not review and fix.
- **Not the Workflow tool.** Every run needs the user's explicit opt-in, so it cannot be the automatic default. Plain subagents (nesting allowed, 3 deep) are the free tier.
- **Not the built-in `/code-review` as the reviewer.** It hunts correctness and cleanups only — no architecture, UX or DX lens.
- **Split: the skill is the session's side, the agent is the review.** The skill says when, how to brief, what to do with the report; the agent body carries the method and the lens panel. (The first draft kept the method in the skill's `reference/` and had the agent load the skill to find it — which put dispatcher instructions, "commit the fixes", into the agent that must never commit. The review found it.)
- **One writer.** Reviewers and verifiers read; the agent alone applies verified fixes, never commits. The session reads the fix diff and commits it.
- **Modes `fix` / `report`.** Fix when the work is the session's own or the user asked for fixes; report-only for someone else's work ("review PR 42").
- **Top-level session only.** Every subagent loads `CLAUDE.md` and therefore the directive; without the scope line every writer subagent would review itself.
- **Order: review → fixes → end-to-end verification → land/release.** Fixes postdate any dogfood, so that runs again after them.
- **Ledger in `reviews/`, not `handoffs/`.** Resume (`standing.mjs`) reads the newest `handoffs/` file as the baton, and a review is always the last thing written.

## First real run (dogfood on this branch)

The review of this very change, run by the method, found its own most important bug: the reviewer launched its lens reviewers in the background (the subagent default) and returned before any came back. Root-caused into the method — every reviewer and verifier dispatched with `run_in_background: false`, in one message. The four lens reports (prompt design, architecture, completeness, DX/UX) produced ~25 findings; the verified ones are applied in the commit after this record. Ledger: `reviews/`.

## Open

- **Plugin-gating of directives** (architecture lens, low): a floor-only house project (no `agent` layer) still gets every workflow directive, this one included, though `bespunky-workflow` is enabled only by the `agent` layer. Pre-existing for all workflow directives; fixing it is a design change across all of them — surfaced to the user.
