# Sanity review ledger — feat/sanity-review vs development

**Frame.** The branch ships a sanity-review skill + `sanity-reviewer` plugin agent (workflow plugin) and an always-on "Review before you hand back" directive in house-doc's HOUSE.rules.md.tpl, so every house project reviews substantial work across lenses and fixes it before Claude hands back. Decisions (not findings): no Stop hook; plain subagents not Workflow; reviewer applies fixes itself, never commits; must not fire on a mid-work pause. Owed later (not findings): nx release bumps for workflow/house + marketplace.json.

**Lenses (4 reviewers, read-only, one message):**
- R1 prompt & skill design + instruction correctness
- R2 architecture + consistency with house rules
- R3 completeness (sweep, README/CLAUDE.md mirrors, release/migration)
- R4 DX/UX of the experience (session and user)

Verification: claude plugin validate plugins/workflow · check-descriptions · test-layers · test-generators · test-tips.

## Status
- [x] R1 R2 R3 R4 dispatched (background, one message)

## Outcome (recorded by the session)
- The orchestrating reviewer returned before its four reviewers finished (background dispatch) → root-caused into the method: synchronous dispatch. The four reports then reached the session directly.
- Applied: method moved into the agent (no dispatcher text in its context); top-level-only scope; commit-before-dispatch + one-line notice; fix/report modes; budget share; order review → e2e verify → ship; ledger in reviews/; single owner for the second round; verification fallback ("owed again", never a bare "passed"); visible review section in the final report; landing order in branch-and-release; mirrors in README, CLAUDE.md, house `new` skill; test-layers guards the new heading.
- Rejected / kept: batch all decisions into one message (kept the house one-question convention); budget override when nobody can ask (matches delegate-and-parallelize).
- Open, for the user: plugin-gating of workflow directives in floor-only projects (pre-existing, cross-directive).
