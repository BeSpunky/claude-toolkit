---
name: branch-and-release
description: >-
  The BeSpunky git methodology — how work flows from idea to production. Use at the START of any request (the relevance check runs before you design, read code, or edit), when opening or serving a git worktree, when branching, whenever you are about to commit work in progress, when integrating/merging a finished feature, and on any promotion or release phrasing ("done / verified", "go to staging", "go live / ship it / release / deploy to prod / cut a version"). A one-way promotion pipeline across four branches (feature → development → staging → main), unrelated work isolated in per-feature worktrees off the integration branch, small committed increments as you work in the worktree (not one big commit at the end), rebase-and-re-verify at the single divergence point, and three human-gated promotions. Deploy bindings (which branch deploys where) are per-project and live in the project's CLAUDE.md; this skill is the durable method behind them.
---

# Branch & release workflow (non-negotiable)

**A one-way promotion pipeline across four branches.** Work flows `feature` → `development` → `staging` → `main`:

| Branch | Role |
| --- | --- |
| `development` | integration — holds all ongoing/finished work not yet promoted |
| `staging` | pre-production / release-candidate line |
| `main` | production / released line |

Each branch is an ancestor of the one upstream (`main` ⊆ `staging` ⊆ `development`): a branch only ever advances by **merging the branch directly upstream of it**, never by a direct commit. So promotions are clean fast-forwards and `staging`/`main` stay as close to the work as the last promotion. **Never commit onto `development`, `staging`, or `main` directly** — they're integration/promotion branches, not workbenches.

**Deploy bindings are a per-project parameter, not part of this method.** Whether (and how) `staging` and `main` auto-deploy to a live environment on push is stated in the **project's `CLAUDE.md`** — e.g. Firebase App Hosting rolls out on push to `staging`/`main`; another project might bind a CI workflow, or bind nothing yet. This skill governs how work *moves through the branches*; the project says what a push to each branch *triggers*. When conversation says "master", it means whatever branch production is bound to (`main` here) — never assume a literal `master` branch.

## Step 0 of every request — the relevance check runs BEFORE anything else

Before you design, read code, invoke another skill, plan, or make the first edit, classify the request against the *current* worktree's in-flight work:

- **Related** (continues what this tree is already doing) → keep working in the current tree.
- **Unrelated** (a new feature, a different bug, tooling, docs — anything that isn't this tree's task) → **immediately open a new git worktree branched from `development`** and do *all* the work there. Don't ask; don't "just start" in the current tree and relocate later.

⚠️ **The exact failure to avoid:** beginning an unrelated change in the current tree "because it's quick", then discovering afterward that `git status` mixes two unrelated changes. The check is a **precondition for touching files**, not a cleanup step — if you're about to design or edit and you haven't consciously classified the request, stop and classify it first. Never pile unrelated changes onto an in-flight branch.

## Opening a worktree

```bash
git worktree add .claude/worktrees/<slug> -b <feat|fix>/<slug> development   # ALWAYS base off development
cd .claude/worktrees/<slug> && <install>                                    # worktrees start with no deps installed
mkdir -p docs/features/"$(date -u +%F)-<slug>"                             # the effort's package namespace (real once a file lands)
```

**The slug you choose here is the effort's identity — use it everywhere.** It names the branch, the worktree, *and* the effort's **package** ([[feature-package]]: `docs/features/<YYYY-MM-DD>-<slug>/`), which holds everything durable the effort produces that isn't code — its brief, vision, staging, decisions, throwaway mocks, and handoff batons. Create it with the tree, not at the end (a doc written afterwards is a memory, and memories are where the reasons go missing), and never invent a second name for the same effort. Skip it only for genuinely trivial work — a package for a typo fix is noise.

**Worktree-blind tooling is the one trap a worktree adds.** A tool that caches *one* workspace root across trees (a daemon, a language server, a build cache keyed on an absolute path) can silently build, test or serve the **main** tree's source from inside a worktree — every check "passes" against unchanged code. Point such tooling at the worktree explicitly. **In an Nx workspace (every house project — Nx is the floor) this is mandatory for every `nx` command run from a worktree** — `NX_DAEMON=false NX_WORKSPACE_ROOT_PATH="$(pwd)" <pm> nx …`; the why, the symptom that catches it, and the cleanup are in [`reference/nx-worktree-override.md`](reference/nx-worktree-override.md). `.claude/worktrees/` is gitignored.

## Commit small increments as you go (inside the worktree)

**Work in a series of small, committed steps on the feature branch — never accumulate one large uncommitted pile that you commit all at once at the end.** After each *coherent, working* unit — a passing test, a completed sub-step, a green refactor, a fixed edge case — commit it with a clear message describing that step. Aim for commits that each leave the branch in a working state and read as one idea.

Why it matters:
- **Every commit is a restore point.** A wrong turn costs you one small step to undo (`git revert`/`reset` that commit), not a day of tangled work.
- **The branch's history tells the story** of how the change was built — reviewable step by step, not as one opaque blob.
- **Rebasing stays cheap.** The divergence-point rule below rebases the feature onto current `development` before merging; small, coherent commits make any conflict local to one step instead of one giant hard-to-resolve diff.
- **`development` still sees one unit.** The `git merge --no-ff` at the "feature done" gate groups all these commits under a single merge commit, so `development`'s history stays clean and the whole feature reverts in one command (`git revert -m 1`) — you get granular *and* grouped, not one or the other.

Practical rhythm: make the change → verify it → **commit** → repeat. Don't wait for "the whole feature" to commit; commit the moment a piece stands on its own. Tidy only if needed (an interactive rebase before promotion), but small-as-you-go is the default, not a cleanup afterthought.

## Serving an in-flight worktree — without merging it back

Testing a feature means serving *its* worktree — its own source, on ports that can't collide with the main tree's server, without merging anything back. The generic shape: resolve the tree, install its deps if missing, serve **its** source with any worktree-blind tooling pointed at it, on an isolated port block (see [[local-server-isolation]]). **Two traps on any stack:** (1) a worktree serve often does **not** reliably hot-reload source edits over a container mount — **restart the serve after each edit** rather than trusting HMR (if a change still doesn't show, clear the framework build cache before restarting); (2) for a **long-lived** worktree, `git rebase development` *before* serving whenever `development` has moved, so you test against the latest integration, not a stale fork.

**In a house project with the `web` layer** (its `HOUSE.md` stamp lists `layers=…web…`), one command does all of it from anywhere — `<pm> nx serve <app> --worktree=<branch|slug>` (a thin Nx wrapper over the stack-free `tools/dev/dev serve`): per-worktree port offsets, a `http://<slug>.localhost` domain, the shared browser. Flags, port isolation and the domain model are in [`reference/serving-a-worktree.md`](reference/serving-a-worktree.md). Outside a house project, do the `cd` + override dance by hand.

## The single divergence point — integrate in the feature, never on the shared branch

Every promotion *upstream* is conflict-free because each downstream branch is a strict ancestor of the next (pure fast-forwards). A **feature branch is the sole exception**: it forks `development` at one commit, and by the time it's done `development` has usually moved on. **Don't let the two lines meet *on* `development`** (resolving a conflict on the shared branch lands a feature that was never verified against current `development`). Instead bring `development` *into the feature* first: from the worktree, **`git rebase development`**, resolve any conflicts, and **re-verify the feature** — a rebase can introduce *semantic* conflicts (an API `development` changed under you) even with no textual ones. Now the feature sits cleanly on top of `development`, its integration risk contained to an isolated branch where a mistake is cheap. Feature branches are single-owner, so this history rewrite is safe; a pushed branch needs `--force-with-lease` on its next push.

## Three promotion gates — each waits on an explicit signal; nothing promotes on its own

1. **Feature done** — *on the explicit "done / verified"*: **first `git rebase development` in the worktree and re-verify** (per the divergence-point rule — integration is settled here, in isolation). **Then settle the effort's package** ([[feature-package]]): its conclusions (`BRIEF.md`, `VISION.md`, `STAGING.md`, `DECISION.md`, batons) are committed and promote with the code; its throwaway `mocks/` self-ignores and will not. **This is the moment to offer keep-or-bin** for any evidence the user wants to retain — *"keep the mocks as a record, or bin them?"* — because keeping means `git add -f` **before** the merge; after teardown the worktree is gone and so is the folder. Then land it with a grouping merge commit (`git switch development && git merge --no-ff <feat|fix>/<slug>`; the merge commit gives a one-command revert via `git revert -m 1`) and push `development`. Finally tear down the worktree (`git worktree remove .claude/worktrees/<slug>` → `git branch -d <feat|fix>/<slug>`, plus `git push origin --delete <branch>` if it was pushed). `development` is the integration line — consult the project's CLAUDE.md for whether pushing it deploys (typically it does not).
2. **Go to staging** — *on the explicit "go to staging" signal*: `git switch staging && git merge --ff-only development`, then **push `staging`** (fires whatever the project binds to a `staging` push).
3. **Go live** — *on any go-live phrasing ("go live", "ship it", "release", "deploy to prod", "cut a version")*: `git switch main && git merge --ff-only staging`, then **push `main`** (fires whatever the project binds to a `main` push).

`--ff-only` on promotions 2 and 3 is a guard: the merge is a fast-forward by construction, so if git refuses, something was committed directly onto the downstream branch — **stop and reconcile, never `--force`**. Promote often so the gaps stay small; after go-live `main == staging`.

## What runs automatically vs. what waits for you

**Only the relevance check and worktree creation off `development` run without asking.** Everything that moves work downstream — feature→`development`, `development`→`staging`, `staging`→`main` — waits on an explicit signal. If a push fails with an auth / "Repository not found" error, the environment has no git credentials by default — the user authenticates (e.g. `gh auth login`) and you retry; never work around it.
