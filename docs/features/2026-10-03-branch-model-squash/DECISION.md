---
status: concluded
concluded: 2026-10-03
summary: A landing's commits are found after the fact — plan carry <work-branch> resolves what a squash/rebase PR created, so no plan ends on a placeholder; merge-forward skips lines that already have the change.
tags: [branch-model, carry, squash, rebase, pull-request, gitflow, maintained-releases]
---

# branch-model-squash — decision

The user, on the two gaps left by `2026-10-03-branch-model`: *"Fix #4"*.

## The decision

**The squash commit can't be known in advance, but it can be found afterwards.** `plan carry` now also takes
the *work branch* after it has landed and resolves the commit(s) that landed it, in order: ancestry (a merge
landing) → one integration commit whose patch-id equals the branch's combined diff (squash) → a
patch-equivalent commit per branch commit (rebase) → a `(#N)` commit, only when tied to the branch by name or
subject. Anything else refuses (exit 2) and names `plan carry <commit> [<commit>…]`. So every land plan ends on
a runnable step, and the branch is kept until carry has used it.

**"Already carried" is content-aware.** Merge-forward skips a line that already has the change — by ancestry,
`git cherry`, or identical files — and says why, instead of planning an empty PR (which GitHub refuses for a
squash).

## Supersedes, in `2026-10-03-branch-model/CONTRACT.md` §4

`carry <commit|branch>` → `carry <work-branch>` (after landing) **or** `carry <commit> [<commit>…]`. That
contract is a concluded record and is not edited; this is the amendment.

## Left, deliberately

A plain fast-forward landing of a multi-commit branch would carry only the tip — no plan produces such a
landing, so it is noted, not built.
