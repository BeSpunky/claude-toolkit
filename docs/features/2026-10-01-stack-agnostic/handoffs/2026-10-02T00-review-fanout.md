# Fan-out ledger — pre-merge review

> "Send agents to sanity check, review and critic. Fix anything that comes up, then rebase, retest and merge" — the user, 2026-10-02

Budget: default 12. Plan: 5 read-only reviewers (each verifies its own findings with evidence) → 1 fixer (single writer, share 1) → orchestrator: rebase on development, retest, conclude DECISION.md, merge --no-ff.
Reviewers write findings to research/06-review-<id>.md (no commits; orchestrator commits).

| id | dimension | status | result |
|---|---|---|---|
| R-mig | migrations & ladder correctness (cleanup, fixtures, old-version projects) | dispatched | |
| R-arch | architecture critique vs the goal (agnostic? special cases, duplication, seams honest) | dispatched | |
| R-shell | scaffold.sh / layers.sh / dev engine / hook robustness | dispatched | |
| R-docs | skills, README, CLAUDE.md, HOUSE templates, tips — claims vs behaviour | dispatched | |
| R-sane | independent sanity: clean clone, all suites, fresh smokes | dispatched | |
| F-fix | apply confirmed findings | pending | |
