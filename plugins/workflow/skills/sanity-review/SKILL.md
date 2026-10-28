---
name: sanity-review
description: >-
  Critically review, sanity-check and fix a finished piece of work BEFORE handing control back — specialised reviewer subagents, each on one lens (architecture, reuse, scalability, clean code, bugs, security, UX, DX, tests, completeness, and whatever else the change calls for), every weighty finding adversarially verified, every verified fix applied, and only the decisions that are genuinely the user's handed back. Use when substantial autonomous work is finished and you are about to report it — a feature, a bug fix, a refactor, a multi-file change, a release — and before proposing to land a branch; and whenever the user asks to "review", "critique", "sanity check", "tear apart", or "send agents to review" an implementation. Runs out of the main context through the bespunky-workflow sanity-reviewer agent. NOT when pausing mid-work to ask the user something, for a trivial edit, for a read-only answer, or when nothing changed since the last review.
---

# Sanity review

**Finished is not reviewed.** Work that was built in one long autonomous stretch has had exactly one pair of eyes on it — the ones that wrote it, holding every assumption they made along the way. Before that work goes back to the user, it is torn apart by reviewers who did not write it, each looking through one lens, and everything they find that survives an attempt to refute it is fixed. The user gets back work that has already been through the critique they would otherwise have had to ask for.

This skill is the **trigger and the contract**; the review itself runs in the **`bespunky-workflow:sanity-reviewer`** agent, so the fan-out, the reading and the fixing never land in your context. The agent's method lives in [`reference/method.md`](reference/method.md), the lens catalogue in [`reference/lenses.md`](reference/lenses.md) — you do not need to read either to dispatch it.

## When it runs

**Once the work is finished, before you hand control back** — the last thing you do before the final report:

- **Substantial work is done:** a feature, a bug fix that touched design, a refactor, a multi-file or multi-step change, a release, a migration, a generator or a template — anything where a second look could find something.
- **Before you propose landing a branch** — the review runs on the final diff, so what lands is what was reviewed.
- **The user asks** to review, critique, sanity-check or tear apart an implementation — run it on what they point at.

**Not** when you stop *mid-work* to ask a question or wait for a confirmation — review the work when it is finished, not when it is paused. **Not** for a trivial change (a typo, a one-line mechanical edit), a read-only answer, or work that has already been reviewed with nothing changed since.

## Dispatch it

Dispatch the **`bespunky-workflow:sanity-reviewer`** agent **synchronously** — its result is the next thing you need. The agent shares none of your context, so the prompt carries what only you know. Hand it:

1. **The goal** — what the user asked for, and the outcome it was a pointer to.
2. **The decisions already made with the user** — with their own words where you have them. Reviewers must not "fix" a deliberate choice back into the thing the user rejected.
3. **The scope** — exactly what to review: the work branch against its base (`git diff <base>...HEAD` plus the uncommitted tree), or the specific paths. Never "the repo".
4. **How it is verified** — the commands that build, test and lint this change, and what they printed for you.
5. **What is out of bounds** — files it must not touch, a protected line, a running server, anything human-gated.
6. **The feature package**, when one exists (`docs/features/<date>-<slug>/`) — the agent writes its ledger there.

## What comes back — and what you do with it

The agent returns **what it fixed**, **what needs a decision**, **what it rejected** and **what it did not cover**. It never commits — the fixes are left in the working tree for you.

- **Read the fix diff** before you accept it (`git diff`) — what comes back is evidence, not truth. Re-run the change's verification; commit the fixes as their own step.
- **A finding that needs a decision is yours to make or the user's to answer** — a redesign the house rules say needs confirmation, a trade-off between two goods, an ambiguity in what the user meant. Decide what you can; ask the user the rest, one question at a time.
- **Report the outcome, not the review.** Your final message says what the work does now and what still needs the user — the review's fixes are part of *what changed*, in a clause. How many reviewers ran is process trivia.

If the fixes were large — a reshaped module, not a renamed variable — dispatch it once more on the fix diff alone. Never loop past that: a second round that still finds design problems is a design conversation with the user, not a third review.
