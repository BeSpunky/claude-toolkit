# Fan-out ledger — pre-merge review

> "Send agents to sanity check, review and critic. Fix anything that comes up, then rebase, retest and merge" — the user, 2026-10-02

Budget: default 12. Plan: 5 read-only reviewers (each verifies its own findings with evidence) → 1 fixer (single writer, share 1) → orchestrator: rebase on development, retest, conclude DECISION.md, merge --no-ff.
Reviewers write findings to research/06-review-<id>.md (no commits; orchestrator commits).

| id | dimension | status | result |
|---|---|---|---|
| R-mig | migrations & ladder correctness (cleanup, fixtures, old-version projects) | returned | see research/06-review-*.md |
| R-arch | architecture critique vs the goal (agnostic? special cases, duplication, seams honest) | returned | see research/06-review-*.md |
| R-shell | scaffold.sh / layers.sh / dev engine / hook robustness | returned | see research/06-review-*.md |
| R-docs | skills, README, CLAUDE.md, HOUSE templates, tips — claims vs behaviour | returned | see research/06-review-*.md |
| R-sane | independent sanity: clean clone, all suites, fresh smokes | returned | see research/06-review-*.md |
| F-fix | apply confirmed findings | pending | |

## Returned (all 5) — findings in research/06-review-{arch,shell,docs,sane,mig}.md
Spent 8/12 (5 reviewers + 3 sub-agents: shell, sane, mig).

## Triage
**Fix now — FX-shell** (wt sa-fix-shell): scaffold.sh S1 S2 S3 S9 R3 R5 R6 mig#4 + A1 (outer refusal half); dev engine S5 S6/R2 S7 S8 S10 S11; shared-browser F1 F6; worktree-domains F2 F3 F8; port-claim F4 F5; firebase-banner F7.
**Fix now — FX-layers** (wt sa-fix-layers): A1 (plan half) A2 A5 A6 A7 A9 A8(logging only) S4; R1+mig#2 relocate-port-claim; mig#1 0.33.0 replay; declare-dev-processes malformed-dev.json guard; R4 house-doc pointer; D1–D11.
**Deferred, recorded as follow-ups (design, no live failure today):** A3 (`web` ensurable `via` a single stack), A4 (one devcontainer image — matters once a second image-owning stack exists), A8 PlanContext per-layer params, mig#3 (--local checkpoint commits carry the file: spec — dev-testing only, documented), mig#5 (rung imports a live util — pre-existing pattern), shell suspicions (Docker uid, cross-uid claims).

| id | status | result |
|---|---|---|
| FX-shell | dispatched | |
| FX-layers | dispatched | |
