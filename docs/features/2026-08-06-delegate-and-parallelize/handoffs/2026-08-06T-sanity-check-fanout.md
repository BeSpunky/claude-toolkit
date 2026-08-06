---
kind: fanout
status: complete
goal: Sanity-check the delegate-and-parallelize skill, its references, the always-on directive, and the repo integration before promotion
shape: map (4 independent read-only reviewers, no dependencies between them)
workflow_run: none — subagent map, no Workflow used
---

## Units

| id | unit | status | re-runnable | result |
| --- | --- | --- | --- | --- |
| u1 | Skill coherence — SKILL.md + 3 reference files | returned | yes | 11 findings; verdict "fix first" — duplicated anti-patterns |
| u2 | Harness accuracy — Agent/Workflow behavioural claims | returned | yes | 4 claimed corrections, 2 rejected on review; verdict "4 corrections needed" |
| u3 | Repo integration — README, manifests, versions, cross-refs, checkers | returned | yes | 4 gaps; verdict "README paste-block missing the directive" |
| u4 | Always-on directive — placement, gating, duplication, context cost | returned | yes | 6 findings; verdict "fix first" — supervision counterweight lost |

All four read-only; no write contention; all checkers passed inside u3.

## Results

### u1 — skill coherence

Duplicated anti-pattern bullets (Fire and forget ×2, Idle waiting ×2) — **confirmed by inspection**, introduced when the section was re-edited after the crash. Ledger had no home when an effort has no package. No stated action for a stuck child. Trigger too broad with no negative clause. Missing the sibling convention's closing *Related* / *Ask yourself* blocks. Workflow tier under-grounded (runId provenance unstated).

### u2 — harness accuracy

**Accepted:** "single message or not parallel at all" was overstated (awaiting each is what kills concurrency, not the message boundary); "each may spawn its own" is false for restricted read-only agent types; `parallel()`/`pipeline()` failures resolving to `null` rather than throwing was an omission worth stating under the skill's own "unmentioned hole reads as coverage" rule.

**Rejected after checking against the authoritative in-session tool contract** — recorded because a future reader will hit the same disagreement:

- u2 claimed a skill's instructions can never constitute Workflow opt-in. The Workflow tool's own description explicitly lists *"the user invoked a skill or slash command whose instructions tell you to call Workflow"* as an opt-in path. The skill's split (invoked by name → authorized; auto-fired → propose only) stands.
- u2 claimed workflow resume caches by completion order rather than by script prefix. The tool description states the longest unchanged prefix of `agent()` calls returns cached and the first edited/new call onward runs live. Kept as written.

### u3 — repo integration

**The serious one:** `README.md`'s canonical always-on **paste-block** (the copy existing projects paste into their own `CLAUDE.md`) never received the directive, while `HOUSE.rules.md.tpl` did — so the two install paths would have silently disagreed, scaffolded projects getting six directives and hand-retrofitted ones five. Exactly the silent-miss class this repo has shipped twice. Also: the block's introductory enumeration was stale. Everything else registered correctly; all 32 namespaced ids and all `[[…]]` links resolve; versions and the migration ceiling verified. Checkers: release-invariants PASS · script-modes PASS · test-scaffold PASS.

### u4 — always-on directive
Mustache correct, top-level, balanced; ungated is the right call (orchestration is a property of the agent, not the stack — matches architecture-first, branch-and-release, feature-package). Main defect: the compressed supervision bullet had dropped the counterweight, reading as a standing instruction to poll. Same ledger-home gap u1 found, independently.

## What was fixed

Duplicated bullets removed · "single message" claim softened · agent-type recursion limit stated · null-on-failure noted · runId provenance named · schema claim scoped to the tier that provides it · ledger-home fallback ("a fan-out is never trivial work") in skill, directive and README · stuck-child decision added · trigger given a NOT-for clause · *Related* + *Ask yourself* closing blocks added · supervision counterweight restored in the directive · README paste-block directive added and its enumeration corrected.

Arrived mid-review and folded in: **isolation reframed from a binary into a judgment** — dissolve contention first (many readers, one writer), then a shared tree with declared boundaries, then a worktree each; the arrangement is stated in the handed-down prompt and the decision recurses.

## Not covered

- No consumer-side end-to-end run of `scaffold.sh --sync` against a real project — the directive's rendering is checked by reading the template, not by generating a project.
- u3's finding #6 (README's architect-mentality copy lacks the tpl's "build for the goal, not the brief" clause) is **pre-existing drift, deliberately left alone** — unrelated to this effort, and fixing it would widen the change.
- The repo's own root `HOUSE.rules.md` still lags the template; correct by design (generator-owned, self-heals on the next sync).
