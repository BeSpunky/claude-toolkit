---
name: sanity-review
description: >-
  Critically review, sanity-check and fix a finished piece of work BEFORE handing control back — specialised reviewer subagents, each on one lens (architecture, reuse, scalability, clean code, bugs, security, UX, DX, tests, completeness, and whatever else the change calls for), every weighty finding adversarially verified, every verified fix applied, only the user's decisions handed back. Use in the top-level session when a long autonomous stretch of work is finished and you are about to report it — a feature, a bug fix that touched design, a refactor, a migration — and before proposing to land a branch or cutting a release; and whenever the user asks to "review", "critique", "sanity check", "tear apart", or "send agents to review" an implementation. Runs out of the main context through the bespunky-workflow sanity-reviewer agent. NOT inside a subagent, when pausing mid-work to ask the user something, for a small or mechanical edit, for a read-only answer, or when nothing changed since the last review.
---

# Sanity review

**Finished is not reviewed.** Work built in one long autonomous stretch has had exactly one pair of eyes on it — the ones that wrote it, holding every assumption they made along the way. Before it goes back to the user, reviewers who did not write it tear it apart through one lens each, and everything that survives an attempt to refute it is fixed. The user gets back work that has already been through the critique they would otherwise have had to ask for.

This skill is **the session's side**: when to run it, how to brief it, what to do with what comes back. The review itself — the method and the lens panel — lives in the **`bespunky-workflow:sanity-reviewer`** agent, so the fan-out, the reading and the fixing never land in your context.

## When it runs

**In the top-level session, once the work is finished, before you hand control back:**

- **A long autonomous stretch is done** — a feature, a bug fix that touched design, a refactor, a migration, a generator or template change. The test is whether the work changed *design or behaviour* across more than one concern, not how many files it touched.
- **Before you propose landing a branch, and before any release** — on the final diff, so what lands is what was reviewed.
- **The user asks** to review, critique or sanity-check an implementation — run it on what they point at.

**Not** inside a subagent — a subagent's parent reviews the integrated result. **Not** when you stop *mid-work* to ask a question or wait for a confirmation — review when the work is finished, not when it is paused. **Not** for a small or mechanical change (a typo, a rename, a version bump), a read-only answer, a quick edit in a back-and-forth the user is watching, or a diff nothing has changed since its last review **except that review's own fixes**.

**The order is fixed: final diff → review → fixes committed → end-to-end verification once → land or release.** "Final" means after any rebase onto the base — conflict resolutions are code too. The review's fixes postdate any dogfood, real install or rebuild you ran, so the end-to-end verification belongs *after* it; a release cut before the review is one the review will make you redo.

## Before you dispatch

1. **Everything you started has finished** — every child returned or stopped, your own edits complete. Make no edits while the review runs; it is the only writer.
2. **Your work is committed** — on a branch you may commit to (per `bespunky-workflow:branch-and-release`), so the scope is `<base>...HEAD` and, afterwards, `git diff` is exactly the review's fixes. If you may not commit here, dispatch in `report` mode with the **working tree** as the scope (`git diff <base>` plus the untracked files).
3. **Tell the user, in one line**, what is happening — what is being reviewed, across which lenses, and whether it fixes or only reports. The review takes minutes; a silent turn looks hung.

## The brief

Dispatch the agent **synchronously** (`run_in_background: false`) — its result is the next thing you need. It shares none of your context, so hand it:

1. **The goal** — what the user asked for, and the outcome it was a pointer to.
2. **The decisions already made with the user**, in their own words where you have them. Reviewers must not "fix" a deliberate choice back into what the user rejected.
3. **The scope** — the work branch against its base, the working tree, or the specific paths. Never "the repo".
4. **How it is verified** — the commands that build, test and lint this change, and what they printed for you; name the end-to-end check separately.
5. **What is out of bounds** — files it must not touch, a protected line, a running server, anything human-gated.
6. **The ledger path** — `docs/features/<date>-<slug>/reviews/<ts>-sanity-review.md` in **your** effort's package (`reviews/`, never `handoffs/`, whose newest file resume reads as the baton); omit it when you have no package — then the report is the record.
7. **The budget share** — what is left of this request's agent budget (`bespunky-workflow:delegate-and-parallelize`), net of the reviewer itself: about 4–6 for a focused change, up to 11 for a large one. If the review needs more than is left, ask the user before dispatching.
8. **The mode** — `fix` when the work is this session's own or the user asked for fixes; `report` when it is someone else's work (a PR, a teammate's branch) and the user asked only for a review, or when you may not commit. With no mode, the agent reports.

## What comes back

The agent returns the report its method defines — **Fixed** (or, in `report` mode, **Verified findings**), **Needs decision**, **Rejected**, **Not covered**, **Verification**, **Ledger**.

- **`fix` mode: read the fix diff** (`git diff`) before you accept it — what comes back is evidence, not truth. Run the fast checks, commit the fixes and the ledger as their own step on the work branch, then the end-to-end verification once.
- **`report` mode: present the verified findings** and ask before applying any of them — the work is not yours to change unasked.
- **A finding that needs a decision is yours or the user's** — a redesign the house rules say needs confirmation, a trade-off between two goods, an ambiguity in what the user meant. Decide what you can; ask the user the rest. Never propose landing while a decision that blocks it is open.
- **Show the review in your final message, briefly** — that it ran and on what, which lenses, the fixes in a line each, what it did not cover, and what still needs the user. A review the user cannot see reads as one that never ran. How many agents it took is process trivia.

There is no second dispatch for the review's own fixes — the agent re-checks large fixes itself, and a design problem that survives the review is a conversation with the user, not another review.
