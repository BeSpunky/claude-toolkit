---
effort: standing-sees-branches
summary: project-standing missed an in-flight effort that lived only on an unmerged branch; make every in-flight effort show up wherever it lives.
---

## The incident

A standing report for this repo listed three live efforts and omitted `house-postgres-supabase`, on which a consumer project waits.

## What was verified (2026-11-03)

- **The hypothesis was right about the engine.** `standing.mjs` read the session's checkout plus what `git worktree list` lists; a package only on an unmerged branch could not appear. Running from the main checkout and from a worktree gave the same answer (59 packages, no postgres); only the `worktree` paths differ, relative vs absolute.
- **It was not alone.** `fix/house-docker-pm` is in the same state, with a concluded package.
- **Why git lost the registration.** The directory's `.git` file reads `gitdir: /home/shy/Projects/claude-toolkit/.git/worktrees/house-postgres-supabase`: it was created on the host, and `/home/shy` does not exist in this devcontainer. `.git` is shared between the two, so from here the entry is `prunable`. An explicit `git worktree prune` removes such an entry at once. Reproduced in a scratch repo: `git gc` left it alone (its expiry is 3 months), `git worktree add` left it alone, `git worktree prune -v` printed `Removing worktrees/w: gitdir file points to non-existent location`.
- **Who pruned.** This session's own subagents, as scratch cleanup, from the transcripts: 2026-11-02T12:52:47Z and 2026-11-03T10:00:27Z (the only explicit prunes in any transcript since Oct 28). Which of the two removed which entry can't be told after the fact. No tracked skill or tool prescribes it.
- **Nothing was lost.** `git archive <branch>` compared with each orphan directory by `diff -rq`: identical apart from an empty `handoffs/` in the postgres one. Neither directory holds uncommitted work.
- **Is it common here?** Any worktree made on the host is unreachable from the container and the reverse, so yes for anyone working on both sides. On disk now: 2 orphaned checkouts (host-made, Oct 28 and Nov 2), 4 leftovers with no `.git` at all (dated Sep 8), and `fb-container-check`, which has a `.git` directory: a repository of its own, not an orphan.

## Decisions

- **An effort is what a branch CHANGED, not what its tree contains.** A branch counts for a package only through commits no checkout and no integration line holds. Reading every unmerged branch's whole `docs/features/` (the first candidate, `ls-tree` per branch) would bring back the old copy of every package a stale branch forked with, as in flight. This also solves cost: one `git log --stdin --source`, then one `git cat-file --batch`, however many branches exist.
- **Integration comes from `branches.mjs status --json`**, the frozen contract the PreCompact hook and mods use, not from importing its internals. It is only asked when a branch not checked out exists at all, so a repo with none pays nothing.
- **A branch copy wins a tie**, unlike every other source: a checkout's activity comes from `git log --all` keyed by path, so it gets credited with the branch's own commit, and equal times mean exactly that.
- **Remote branches are included, marked `remote: true`, only with no local branch of that name.** Cost is the same log. A fresh clone or another machine has the effort only there, which is this incident's class. They stay out of the notice and out of the "recent activity" fact: someone else's push is not what you walked away from.
- **The SessionStart notice includes local branch-only efforts.** This is exactly what the notice exists for, and it adds no nagging: same dormancy gate, same single notice per dormant stretch, same 8-line cap. Printed as `feat/x:docs/features/<pkg>/ (on that branch, no worktree)`, which `git show` reads. Orphans are not in the notice; they are not efforts, and the pane and the skill name them.
- **Orphaned checkouts are read when they have a `.git` link** (uncommitted packages exist nowhere else) and reported either way; leftovers with no link are reported, never read. Never repaired: reasons are `registered-elsewhere`, `unregistered`, `no-git-link`.
- **One baton convention: `handoffs/`.** `feature-package` now says a received handoff goes to `handoffs/<stamp>-inbound.md`. The engine still recognises a `*handoff*.md` at the package root, as a fallback only: `INBOUND-HANDOFF.md` is on someone's branch and isn't ours to move. Nothing was added to read the old shape beyond that; it is a recognised misfiling, and the name `INBOUND-HANDOFF.md` remains in that package.
- **`branch-and-release` now says never to run a blanket `git worktree prune`.** The engine fix finds what git lost; this is what stops it being lost.
- **Git calls run with optional locks off**, since other sessions work in those worktrees.

## Timing (this repo: 11 worktrees, 2 unlanded branches, 2 orphans)

Hook 155ms → 200ms; engine 150ms → 190ms (37ms of it the model engine). A fixture with 1000 branches, 500 of them unlanded with a package each: 90ms → 310ms.

## Open

- Whether to remove the two orphans and the four leftovers under `.claude/worktrees/`, and re-register `house-postgres-supabase`: the user's call. Nothing was touched.
- `feat/house-postgres-supabase` is 22 behind `development`; it needs a new worktree (from inside the container) when the work starts.

## After review (sanity review, 2026-11-03)

The ledger is `reviews/20261103-sanity-review.md`. Decisions it added or changed:

- **A remote copy only fills a gap.** It never outranks a local copy: its date is its author's clock, and someone else's push must not close your effort.
- **`hasWorktree` means a worktree readable here.** An unreachable registration no longer pins an effort `live`; age decides. Such a package carries `checkedOutElsewhere: true`, because `git worktree add` refuses that branch without `--force`. That is what "needs a new worktree" above takes for `house-postgres-supabase` if its registration is still present.
- **No line to land on, no branch reported.** An undeclared repo's line also comes from `origin/HEAD`. With no base at all, unlanded means nothing, and a missed effort beats calling the main line one.
