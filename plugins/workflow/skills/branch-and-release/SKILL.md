---
name: branch-and-release
description: The BeSpunky git methodology — how work flows from idea to production. Use at the START of any request (the relevance check runs before you design, read code, or edit), when opening or serving a git worktree, when branching, when integrating/merging a finished feature, and on any promotion or release phrasing ("done / verified", "go to staging", "go live / ship it / release / deploy to prod / cut a version"). A one-way promotion pipeline across four branches (feature → development → staging → main), unrelated work isolated in per-feature worktrees off the integration branch, rebase-and-re-verify at the single divergence point, and three human-gated promotions. Deploy bindings (which branch deploys where) are per-project and live in the project's CLAUDE.md; this skill is the durable method behind them.
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
```

**In an Nx workspace, EVERY nx command run from a worktree MUST be prefixed**, or the Nx daemon — which caches **one** workspace root across trees — silently builds/tests/serves the **MAIN** tree's source instead of this worktree's (builds "pass", tests "pass", against unchanged code):

```bash
NX_DAEMON=false NX_WORKSPACE_ROOT_PATH="$(pwd)" <pm> nx <target> <project>
```

The symptom that catches it: a deliberately-failing canary test in the worktree never fails; the spec count doesn't change after you edit specs. `.claude/worktrees/` is gitignored; clean up any stray package-manager store the worktree install drops at the repo root.

## Serving an in-flight worktree — without merging it back

There is usually only **one** set of forwarded dev ports, so exactly one serve owns them at a time; testing a feature means pointing that single serve at its worktree. In **BeSpunky-scaffolded (Nx) projects** the `serve-worktree` target does this for you — run it from anywhere:

```bash
<pm> nx run <app>:serve-worktree                            # arrow-key picker of all worktrees → Enter
<pm> nx run <app>:serve-worktree --worktree=<branch|slug>   # skip the prompt (scripting / non-TTY shells)
<pm> nx run <app>:serve-worktree --dryRun                   # print what it would serve, without serving
```

It collects every git worktree, lets you pick one (current tree pre-highlighted), installs the worktree's deps if missing, then runs *that worktree's own* `serve` target with the `NX_WORKSPACE_ROOT_PATH` / `NX_DAEMON=false` overrides applied for you. (Provided by the `@bespunky/nx-tools:serve-worktree` executor, wired onto every app by the house `app` generator.) Outside a scaffolded project, do the `cd` + env-override dance by hand.

**Two worktree-serve traps:** (1) a worktree serve often does **not** reliably hot-reload source edits over a container mount — **restart the serve after each edit** rather than trusting HMR (if a change still doesn't show, clear the framework build cache before restarting to force a fresh compile). (2) For a **long-lived** worktree, `git rebase development` *before* serving whenever `development` has moved, so you test against the latest integration, not a stale fork.

## The single divergence point — integrate in the feature, never on the shared branch

Every promotion *upstream* is conflict-free because each downstream branch is a strict ancestor of the next (pure fast-forwards). A **feature branch is the sole exception**: it forks `development` at one commit, and by the time it's done `development` has usually moved on. **Don't let the two lines meet *on* `development`** (resolving a conflict on the shared branch lands a feature that was never verified against current `development`). Instead bring `development` *into the feature* first: from the worktree, **`git rebase development`**, resolve any conflicts, and **re-verify the feature** — a rebase can introduce *semantic* conflicts (an API `development` changed under you) even with no textual ones. Now the feature sits cleanly on top of `development`, its integration risk contained to an isolated branch where a mistake is cheap. Feature branches are single-owner, so this history rewrite is safe; a pushed branch needs `--force-with-lease` on its next push.

## Three promotion gates — each waits on an explicit signal; nothing promotes on its own

1. **Feature done** — *on the explicit "done / verified"*: **first `git rebase development` in the worktree and re-verify** (per the divergence-point rule — integration is settled here, in isolation). Then land it with a grouping merge commit (`git switch development && git merge --no-ff <feat|fix>/<slug>`; the merge commit gives a one-command revert via `git revert -m 1`) and push `development`. Finally tear down the worktree (`git worktree remove .claude/worktrees/<slug>` → `git branch -d <feat|fix>/<slug>`, plus `git push origin --delete <branch>` if it was pushed). `development` is the integration line — consult the project's CLAUDE.md for whether pushing it deploys (typically it does not).
2. **Go to staging** — *on the explicit "go to staging" signal*: `git switch staging && git merge --ff-only development`, then **push `staging`** (fires whatever the project binds to a `staging` push).
3. **Go live** — *on any go-live phrasing ("go live", "ship it", "release", "deploy to prod", "cut a version")*: `git switch main && git merge --ff-only staging`, then **push `main`** (fires whatever the project binds to a `main` push).

`--ff-only` on promotions 2 and 3 is a guard: the merge is a fast-forward by construction, so if git refuses, something was committed directly onto the downstream branch — **stop and reconcile, never `--force`**. Promote often so the gaps stay small; after go-live `main == staging`.

## What runs automatically vs. what waits for you

**Only the relevance check and worktree creation off `development` run without asking.** Everything that moves work downstream — feature→`development`, `development`→`staging`, `staging`→`main` — waits on an explicit signal. If a push fails with an auth / "Repository not found" error, the environment has no git credentials by default — the user authenticates (e.g. `gh auth login`) and you retry; never work around it.
