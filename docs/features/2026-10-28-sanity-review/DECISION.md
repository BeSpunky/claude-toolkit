---
effort: sanity-review
status: concluded
concluded: 2026-10-29
summary: Claude now reviews its own finished work before handing back — a sanity-reviewer agent fans out one hostile reviewer per lens, verifies findings adversarially and fixes what survives, triggered by an always-on house directive (no hook); and house-generated docs name a toolkit skill only where the project enables its plugin.
tags: [workflow, review, agents, house-rules, plugin-gating, nx-tools-0.51.0]
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

## Second run — the shipped agent, end to end

Run headlessly (`claude -p --plugin-dir plugins/workflow`) as the real `bespunky-workflow:sanity-reviewer`, in `report` mode, over round one's fix commit. Confirmed what the design rests on: a plugin agent dispatches nested subagents synchronously and gets their results back. Its 14 findings were mostly contradictions round one introduced between the skill, the agent and branch-and-release; all applied (ledger `reviews/20261028T1955-sanity-review.md`). Decided along the way:

- **One order:** final diff (after any rebase — conflict resolutions are code) → review → fixes committed → end-to-end verification once → land or release.
- **Default mode is `report`** when a brief names none; the directive names `fix` for the session's own work.
- **`reviews/` is a sanctioned package folder**, beside `handoffs/` and `mocks/`.
- **Other fan-out ledgers stay in `handoffs/`.** Whether they too should leave it (resume reads the newest `handoffs/` file as the baton) is a separate question; a mid-flight fan-out ledger is arguably resume state, a finished review's is not.

## An incident worth keeping

The first self-upgrade dogfood (`house.sh upgrade --local .` from the worktree) wrote `HOUSE.md` and `post-create.sh` into the **main** checkout: this shell carries `NX_WORKSPACE_ROOT_PATH=/workspaces/claude-toolkit`, and the run omitted the `NX_DAEMON=false NX_WORKSPACE_ROOT_PATH="$PWD"` prefix that `/bespunky-house:upgrade` documents. Restored at once (main was clean before). Operator error against a documented step — but `house.sh` itself trusts an inherited root that points outside the project it was handed, which is worth surfacing to the user.

## Plugin-gating (added on the user's "Yes")

Asked whether to gate the workflow directives on the plugin they rely on, in this branch or separately, the user answered *"Yes"* — taken as this branch, per the standing rule that known gaps ship together.

- **The principle:** text the house writes into a project names a toolkit skill, agent or command only where the project **enables** its plugin. Each `HOUSE.rules.md` directive is the operational half of a skill, so it arrives with that skill's plugin; `HOUSE.md`, the seeded `CLAUDE.md` and every other generated file gate only the sentence, with a plain alternative that still says what to do.
- **Enablement is `.claude/settings.json`, not the layers' declarations.** The first cut gated on the layers' `claudePlugins`; the review of it showed only the agent layer's `claude-settings` step turns a declaration into enablement, so an angular / design-system / ci project without `agent` was still told to use skills it lacked. One reader (`_utils/claude-settings-file.ts`) now serves both the writer and every gate; a project that enables a plugin by hand gets its directives.
- **Two safety rules stand alone:** the CI cloud-identity rule and the Firebase live-credentials rule name no plugin, so each became its own section rather than vanishing with a gated one.
- **Accepted, not fixed:** on `new`, `environment.prod.ts` is written before the settings exist, so a fresh Angular + Firebase scaffold omits that file's App Hosting skill pointer (HOUSE.md and the welcome banner carry it); and the released 0.50.0 rung writes that pointer ungated, reaching only Firebase projects without the agent layer. Seeded files in existing projects are the project's own and are not migrated.
- **Verified end to end:** a plain repo upgraded to the floor gets a rules file naming no skill (only *Generator-first*) and a CLAUDE.md pointer that still imports it; a Firebase + Angular consumer from published 0.49.2 upgrades cleanly (twice: then a no-op), builds, lints, keeps every hand-made shape, and carries the full rule set with every named plugin enabled; `new` passes for every preset.

## Open

- Nothing open in this effort.
