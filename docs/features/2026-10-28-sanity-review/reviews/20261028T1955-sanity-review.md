# Sanity review ledger — round 2: commit 040eb2da (fixes from round 1)

**Mode:** report. **Budget:** 4 agents.

**Frame.** Commit 040eb2da applies the round-1 review's fixes to the sanity-review effort: the method and lens panel move from the skill's `reference/` into the `sanity-reviewer` agent body (so no dispatcher text reaches the agent), the skill becomes the session's side (when, brief, what to do with the report), the always-on directive in `HOUSE.rules.md.tpl` and its README mirror are rewritten (top-level only, not on a pause, review → e2e verify → ship), branch-and-release's landing paragraph reorders review before rebase, mirrors in CLAUDE.md / house `new` skill, test-layers guards the heading. Decisions (not findings): no Stop hook; plain subagents not Workflow; one writer that never commits; never on a mid-work pause; top-level session only. Scope: `git diff 040eb2da~1 040eb2da`. Verification: check-descriptions, test-layers.

**Lenses (3 reviewers + 1 verifier, one message each):**
- R1 correctness & internal consistency across the five files (contradictions, broken structure, instructions that cannot be followed)
- R2 prompt & skill design + architecture (trigger, rule-stated-once, addressee, return shape, split of concerns)
- R3 completeness (sweep, mirrors, release invariants, generated files)
- V1 adversarial verifier over high/medium findings

## Status
- [x] Frame written
- [ ] R1 R2 R3 dispatched (synchronous, one message)
- [ ] V1
- [ ] Report

## Pre-dispatch observation (reviewer-orchestrator)
- `node tools/check-release-invariants/check.mjs` fails: nx-tools changed (HOUSE.rules.md.tpl) after its 0.51.0 bump commit f1e2c8c.
- Untracked `plugins/workflow/tsconfig.json` in tree, not in brief — not touched.

## Status (closed)
- [x] R1 R2 R3 dispatched synchronously, one message — all returned
- [x] V1 adversarial verifier over F1–F11 — returned
- [x] Report (report mode: nothing applied)

## Verified findings
- V-high: nx-tools payload changed (HOUSE.rules.md.tpl) after its 0.51.0 bump f1e2c8c; 0.51.0 unpublished (npm tops at 0.50.0) → checker fails. Fix: bump again (dedicated chore(release)), state "nothing to migrate" (owned template artifact).
- F3 stands: branch-and-release:99 review → commit → rebase leaves conflict resolution unreviewed. Fix: rebase → review → commit fixes → verify once → land.
- F1 partly: "no second dispatch" (skill:52) vs "re-review after a conflict-resolved rebase" (b&r:99); whether the review's own fix commit counts as "diff changed" is undefined. Fix: one trigger — re-review when commits other than the review's own fixes changed the diff.
- F4 stands: e2e verification runs twice at landing (skill:48 + b&r:99). Fix: one rule in both files.
- F2 partly: report-mode fallback for uncommitted work never tells the session to name the working tree as scope (skill:28/37). Precedence half refuted.
- F6 stands: report mode "change nothing" vs ledger written in every mode; skill has no report-mode handling of "Verified findings".
- F7 stands: verifiers and re-check reviewer get no leaf rules/return shape; nothing forbids reviewers fanning out further under the always-on Delegate directive.
- F8 partly: no default for missing mode (agent:6). Scope/budget/ledger have fallbacks.
- F10 stands: feature-package tree/table and the package directive (tpl:85, README mirror) don't list reviews/.
- F11 partly: "exactly as delegate-and-parallelize" overclaims (ledger location, not committed as you go).
- F5 partly: "up to 12" share costs 13 > default 12; the 6–7 floor refuted (verifiers only for lenses with high/medium).
- F9 partly: skip list restated in 4 places; README==tpl mirror has no test (it is currently byte-identical).
- Low: SKILL.md:20-21 Order paragraph orphans the "user asks" trigger bullet; README:348 misplaced "and"; skill:29 notice says "done and verified" for others' work; repo's own HOUSE.rules.md lacks the directive (dogfood upgrade not run/committed); untracked plugins/workflow/tsconfig.json.

## Rejected
- Nested Agent tool unavailable to the agent (R2#8): refuted empirically — this run dispatched 4 subagents synchronously.
- README mirror drifted from tpl: refuted — byte-identical (R1, R3).
- Stale refs to deleted reference/ files or handoffs/<ts>-sanity-review: none (R3).
- Budget floor 6–7: refuted (V1).
- Mode precedence overlap: refuted — skill:28 overrides explicitly (V1).

## Verification
check-descriptions OK; test-layers pass; check-release-invariants FAILS (payload bump).
