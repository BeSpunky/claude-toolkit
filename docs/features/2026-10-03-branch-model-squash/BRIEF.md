# branch-model-squash — brief

Follow-up to `docs/features/2026-10-03-branch-model/` (read its DECISION.md "Known gaps"). The user, after
being shown the two leftover gaps:

> "Fix #4"

1. **Upstream-first + squash-PR landing:** `plan land` ends on a placeholder, `plan carry <the commit(s) the
   squash merge created…>`, because the squash commit cannot be known before the PR merges.
2. **Gitflow + squash-PR landing** is not in the executed end-to-end tests ("plan, followed end to end, per
   preset").

## Direction (orchestrator's design call)

The commit can't be known *in advance* — but it can be found *afterwards*. `plan carry <work-branch>` resolves
"the commit(s) that landed this branch on integration" itself: by patch equivalence of the branch's combined
diff (squash) or per-commit patch-ids (rebase), falling back to the PR number in the subject. The land plan
then ends on a real, runnable `plan carry <work-branch>`, and the branch must not be deleted before it.
