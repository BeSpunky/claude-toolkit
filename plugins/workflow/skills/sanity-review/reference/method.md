# The review method

The procedure the **`sanity-reviewer`** agent follows. You are an orchestrator here exactly as [[delegate-and-parallelize]] describes — its contract, budget, supervision and ledger rules all hold; this file is only what is specific to a review.

The shape is fixed: **frame → fan out the lenses → verify adversarially → apply → re-verify → report.** Reviewers read; you are the one writer.

## 1. Frame the change

Before you dispatch anything, read enough to brief reviewers who will see nothing else:

- **The scope you were handed** — `git diff <base>...HEAD`, `git diff` and `git status` for the uncommitted part, or the named paths. If you were handed no scope, derive it from the branch against its base and say so in the report.
- **The intent and the decisions already made** — from your brief and the feature package (`DECISION.md`, the newest `handoffs/` baton). A choice the user made is not a finding.
- **The project's own rules** — `CLAUDE.md`, `HOUSE.rules.md` and whatever they import. Every lens judges against *this* project's conventions, not generic taste.

Write the frame down once — a paragraph of intent, the decisions, the scope, the verification commands — and pass the same paragraph to every reviewer.

## 2. Pick the lenses

Choose from [`lenses.md`](lenses.md) by **what the change actually touches** — a pure-markdown change has no scalability lens; a CLI has DX but no visual UX; anything that takes input across a trust boundary has security. **Always** run *correctness*, *architecture* and *completeness*; add the rest on relevance, and invent a lens when the change has a dimension the catalogue lacks (a migration's idempotence, an accessibility pass, a concurrency audit). Small change → few lenses; never pad the panel to look thorough.

**Budget:** the whole review — reviewers and verifiers — stays within the [[delegate-and-parallelize]] default of **12 agents** unless your brief granted more. You cannot stop to ask, so when the change deserves more lenses than the budget allows, merge related lenses into one reviewer, rank by risk, and list what was not covered.

**Write the plan down before you dispatch.** When the brief names a feature package, open the fan-out ledger there now, as [[delegate-and-parallelize]] requires — `handoffs/<ts>-sanity-review.md` with the frame and the lenses — and update it as each stage lands. With no package, the report is the record.

## 3. Fan out — one reviewer per lens, all in ONE message

Each reviewer gets the frame, its lens (what it hunts, from `lenses.md`), the scope, and these binding rules:

- **Read-only.** No edits, no commits, no servers on a default port. It may run the project's read-only checks (tests, lint, typecheck, `git grep`).
- **Hostile, not polite.** Its job is to find what is wrong, not to reassure. "Looks good" with no finding is a legitimate result only after it has genuinely tried.
- **Anchored.** Every finding names `file:line`, the concrete failure (inputs/state → wrong outcome), why it matters, and the fix it proposes — or says the fix is a design decision, and what the options are.
- **Return shape:** a list of findings, each `{lens, file:line, severity: high|medium|low, claim, failure, proposed fix, decision-needed: yes|no}`, capped at the ~10 that matter most. No transcript.

## 4. Verify adversarially

A reviewer told to find problems will find some that are not there. Before anything is fixed:

- **Drop** duplicates across lenses (keep the best-anchored one) and anything that contradicts a decision in the frame.
- **Refute the weighty ones.** For every high and medium finding, a verifier whose job is to *disprove* it — read the anchor, try to construct the failure, check whether the code already handles it. Batch one verifier per lens's findings to stay in budget. A finding it cannot refute stands; one it refutes is rejected, with the reason.
- **Low findings** you check yourself at the anchor.

## 5. Apply — you, alone

You are the only writer, so there is no contention to manage. For every verified finding that needs no decision:

- **Fix the root cause at the right seam**, by the project's own architecture rules — never a patch at the symptom site, never a special case to make the finding go away.
- **Sweep** — a fix to one occurrence of a pattern is a fix to every occurrence (`git grep`).
- **Leave design decisions alone.** A finding whose fix is a redesign, a contract change, a trade-off between two goods or a guess at what the user meant goes back as *needs decision*, with the options — never applied on your own judgement.
- **Never commit, never touch a protected line, never edit outside the scope** unless the fix genuinely belongs there (a shared helper that should be reused) — and then say so.

## 6. Re-verify

Run the change's verification — the commands from your brief, plus any check your fixes reached. A fix that breaks a test is not a fix: repair it or revert it and report the finding as open. If the fixes were large, run one correctness reviewer over the fix diff alone.

## 7. Ledger and report

Close the ledger, if there is one: every finding with its verdict and outcome, and what was not covered.

Return, and nothing else:

- **Fixed** — one line per fix: what was wrong, where, what changed.
- **Needs decision** — each finding that is the session's or the user's call: the claim, the anchor, the options with their cost.
- **Rejected** — one line each: the claim and why it did not survive.
- **Not covered** — lenses skipped or merged for budget, scope deliberately left out.
- **Verification** — what you ran after the fixes and whether it passed.
