---
name: branch-and-release
description: >-
  The BeSpunky git methodology - how work flows from idea to production on the project's DECLARED branch model (trunk, a staged chain like development → staging → main, gitflow release and hotfix lines, maintained releases). Use at the START of any request (the relevance check runs before you design, read code, or edit), when opening or serving a git worktree, when branching, before committing work in progress, when landing a finished feature, and on any promotion or release phrasing ("done / verified", "go to staging", "ship it / release / deploy to prod", "cut a release branch", "hotfix"). Also when the user wants to change, simplify or set up the branching model ("change our branching model", "simplify our branches", "set up gitflow"), or the repo has no declared model yet. Resolves line names from .bespunky/branches.json, then applies one method - a worktree per effort, small commits, rebase at the divergence point, human-gated moves, and the carry rule.
---

# Branch & release workflow (non-negotiable)

**The method is invariant; the branch model is a declared project fact.** A worktree per effort, small commits, rebase at the single divergence point, every move between lines human-gated, nothing committed directly onto a protected line — none of that depends on how many branches a repo has. What varies is the **model**: which lines exist, what role each plays, how each advances. It is declared once in **`.bespunky/branches.json`** (the copy on the integration line's tip is authoritative) and interpreted by one engine shipped beside this skill. **This skill never assumes a branch name — it resolves them.**

## The engine, and the first move on every branch action

Run it from anywhere in the repo — `<base>` is the base directory this skill was loaded from:

```bash
node "<base>/scripts/branches.mjs" status        # the model in one line; --json for the full object: state, source, projection, protected, protectedPatterns, notes, reason
node "<base>/scripts/branches.mjs" describe      # every line, its role, how it advances, its bindings
node "<base>/scripts/branches.mjs" plan <gate>   # the exact commands for a move — printed, NEVER executed
node "<base>/scripts/branches.mjs" verify        # the invariants: direct commits, containment, no regression
```

**Before any branch, worktree, landing, promotion or release action, resolve the model with `status`** (once per session is enough unless the model changes). It reads, plans and writes only the declaration — it never moves a branch; **you** execute what `plan` prints, after the human's signal. Exit codes decide what happens next:

- **`0` — declared.** Speak in roles, fill in the names it reports. `describe` when you need the whole table.
- **`3` — undeclared.** No model exists yet, so **assume none**:
  - **Protect** every existing local or remote branch named `main`, `master`, `development`, `develop` or `staging` — the names the toolkit once forced, plus gitflow's. Never commit onto them, never promote between them.
  - **Once per session, before the first branch or promotion action**, run the investigation in [`reference/choosing-a-branch-model.md`](reference/choosing-a-branch-model.md) and **ASK** the user which model to declare. *"No json means asking the user"* — never pick one silently, and never write the file to escape this state. If they defer, ask which line *this* effort forks from and lands on, use that for the session, and ask again next session.
  - **The one deliberate exception is a sync** (`/sync`, its step *3b*): it opens its own worktree off the *current* branch without asking and defers the model question to its report — nothing a sync writes depends on the model; only *landing* its branch does, and that waits on the answer anyway. Everywhere else, the ask-once-per-session rule holds.
- **`1` — the declaration is `unreadable`**: not valid JSON, no projection (it was not written by `branches.mjs write`), a projection schema major the engine does not know, or failed validation. Stop, report the engine's reason verbatim, fix the declaration through [`reference/changing-the-model.md`](reference/changing-the-model.md). Never guess past it. (A projection that has *drifted* from its declaration is not caught here — `status` reads the projection as written; `verify` catches drift, invariant 5.)

## The roles

| Role | What it is | How it advances |
| --- | --- | --- |
| **integration** | exactly one; where work lands (`development`, `develop`, or `main` on trunk) | `--no-ff` merge (or PR) of a rebased work branch |
| **stages** | 0..N, ordered after integration (`staging`, `qa`, …) | from its predecessor — `ff`, `merge` or `pr`, as declared; a **release-fed** stage advances by shipping a release line instead |
| **production** | a role, not a line kind: the last stage (integration on trunk), plus every **maintained** release line | — |
| **release lines** | a pattern (`release/{version}`), cut from integration or a stage, stabilised while integration moves on | stabilisation work lands on it; it **ships into** a stage, or is itself production when maintained |
| **hotfix lines** | a pattern (`hotfix/{line}/{slug}`), forked from a production line | a work branch with a different base; lands back on its line, then is **carried** |
| **work branches** | a pattern (`{type}/{slug}`), single-owner, one per effort | your commits |

**Protected** lines — integration, every stage, every release line — **only advance by their declared move, never by a direct commit.** When conversation says "master" or "prod", it means the production line, whatever it is named. **Deploy bindings** (`deploys` in the model) are documentation of what a push triggers, never verified by the engine — the project's CI and `HOUSE.md` say what actually fires.

## Step 0 of every request — the relevance check runs BEFORE anything else

Before you design, read code, invoke another skill, plan, or make the first edit, classify the request against the *current* worktree's in-flight work:

- **Related** (continues what this tree is already doing) → keep working in the current tree.
- **Unrelated** (a new feature, a different bug, tooling, docs — anything that isn't this tree's task) → **immediately open a new git worktree off the model's work base** (integration, unless the effort is release stabilisation or a hotfix) and do *all* the work there. Don't ask; don't "just start" in the current tree and relocate later.

⚠️ **The exact failure to avoid:** beginning an unrelated change in the current tree "because it's quick", then discovering afterward that `git status` mixes two unrelated changes. The check is a **precondition for touching files**, not a cleanup step. Never pile unrelated changes onto an in-flight branch.

## Opening a worktree

`plan start <type> <slug>` prints the commands, on the right base, for the model. Their shape:

```bash
git worktree add .claude/worktrees/<slug> -b <type>/<slug> <work-base>   # the base comes from the model, never from memory
cd .claude/worktrees/<slug> && <install>                                # worktrees start with no deps installed
mkdir -p docs/features/"$(date -u +%F)-<slug>"                         # the effort's package namespace
```

**The slug is the effort's identity — use it everywhere.** It names the branch, the worktree *and* the effort's **package** ([[feature-package]]: `docs/features/<YYYY-MM-DD>-<slug>/`). Create the package with the tree, not at the end; skip it only for genuinely trivial work.

**Worktree-blind tooling is the one trap a worktree adds.** A tool that caches *one* workspace root across trees (a daemon, a language server, a build cache keyed on an absolute path) silently builds, tests or serves the **main** tree's source from inside a worktree. **In an Nx workspace (every house project) every `nx` command run from a worktree is prefixed** — `NX_DAEMON=false NX_WORKSPACE_ROOT_PATH="$(pwd)" <pm> nx …`; see [`reference/nx-worktree-override.md`](reference/nx-worktree-override.md). `.claude/worktrees/` is gitignored.

## Commit small increments as you go (inside the worktree)

**Work in small, committed steps on the work branch — never one large uncommitted pile committed at the end.** After each *coherent, working* unit — a passing test, a completed sub-step, a green refactor — commit it with a message describing that step. **Every commit is a restore point**; the branch's history tells the story; **rebasing stays cheap** (conflicts stay local to one step); and **the integration line still sees one unit** — the grouping merge at landing reverts the whole effort in one `git revert -m 1`. Rhythm: change → verify → **commit** → repeat.

## Serving an in-flight worktree — without merging it back

Resolve the tree, install its deps if missing, serve **its** source with worktree-blind tooling pointed at it, on an isolated port block ([[local-server-isolation]]). **Two traps on any stack:** a worktree serve often does **not** hot-reload over a container mount — **restart after each edit**; and for a **long-lived** tree, rebase onto its base *before* serving whenever the base has moved. **In a house project with the `web` layer**, `<pm> nx serve <app> --worktree=<branch|slug>` does all of it — see [`reference/serving-a-worktree.md`](reference/serving-a-worktree.md).

## The single divergence point — integrate in the work branch, never on the shared line

Protected lines meet only through their declared moves, so they stay conflict-free. **A work branch is the one place two lines of history diverge**: it forks its base at one commit, and the base moves on. **Never let them meet *on* the shared line** — that lands work never verified against the current base. From the worktree, **`git rebase <its base>`** (integration for ordinary work; the release or production line for stabilisation and hotfixes), resolve, and **re-verify** — a rebase can bring *semantic* conflicts with no textual ones. Work branches are single-owner, so the rewrite is safe; a pushed branch needs `--force-with-lease`.

## The moves — each waits on an explicit signal; nothing moves on its own

**Every move is `plan <gate>` → show the user what it will do → execute it on their signal.** Before a promotion or a ship, run `verify`; a violation means something reached a protected line outside its declared move — **stop and reconcile, never `--force`**. The engine refuses a gate the model doesn't have.

| Signal | Gate |
| --- | --- |
| "done / verified" | `land <work-branch>` |
| "go to `<stage>`" | `promote <stage>` (a chain-fed stage) |
| "go live", "ship it", "deploy to prod" | depends on how production advances: **chain-fed** (two-line, three-line) → `promote <production stage>`; **release-fed** (gitflow: `main` is fed by release lines) → `ship-release <version>` — `promote` refuses it; **trunk** → no gate: landing on integration *is* production (a release is a tag the project cuts); **maintained releases** → no promotion: `ship-release <version>` tags the maintained line (`cut-release` first if it doesn't exist) |
| "cut a release `<v>`" | `cut-release <version>` |
| "ship release `<v>`" | `ship-release <version>` |
| a production bug to fix alone | `hotfix <line> <slug>` |
| after anything lands off integration — or, upstream-first, after a fix lands on it | `carry <branch>` (or `carry <commit…>`) |

**Landing ("done / verified").** First rebase onto the base and re-verify. Then **settle the package** ([[feature-package]]): its conclusions are committed and travel with the code; its self-ignoring `mocks/` will not — **offer keep-or-bin now** (*"keep the mocks as a record, or bin them?"*), because keeping means `git add -f` **before** the merge, and after teardown the folder is gone. **Finalize `DECISION.md` and stamp its `status:` frontmatter** (`concluded | abandoned | superseded`, `concluded:` date, a one-line `summary:`, `tags:`) — the one legitimate moment to distil the package, additively. Then run what `plan land` prints (a grouping `--no-ff` merge or a PR, per `landing`), push, and tear down the worktree and branch.

**Two judgments the engine cannot make — ask:**
- **"Release" is ambiguous when the model has release lines** — cut one, or ship one? Ask which. (Without release lines, a release is a promotion to production — or, on trunk, a tag.)
- **Hotfix or fix on integration?** Only in models that declare hotfixes: a fix on integration ships with everything else unreleased there; a hotfix ships it alone. That changes what reaches users — ask.

## The carry rule

**A change that lands anywhere but integration is not done until it is carried** — to integration and to every open line that would otherwise regress. *How* is the model's `fixFlow`: **merge-forward** (land at the source, then merge that line into integration and every newer open release line) or **upstream-first** (land on integration first, then `cherry-pick -x` back to each maintained line). `plan carry <branch>` prints the steps — run it **after** the branch has landed and **before** deleting it (`plan land` hands off to it and leaves the branch for it to remove). Under a squash or rebase PR landing the commits that reached integration are new ones; carry finds them itself — the one commit whose patch equals the branch's combined diff (squash), or one patch-equivalent commit per branch commit (rebase), and only failing that a `(#N)` PR commit that names the branch, flagged as matched by reference, not content. When it cannot decide it refuses rather than guesses: name the commits yourself, `plan carry <commit> [<commit>…]`. `verify` (no regression) catches what was missed. A fix that cannot apply upstream carries a `Not-applicable-upstream:` trailer saying why.

## Changing the model

The model may change at any time — add, remove or rename a line, adopt release lines, collapse to trunk — **but never unverified and never unconfirmed**: [`reference/changing-the-model.md`](reference/changing-the-model.md) (verify → risk → confirm → apply). Choosing the first model, or simplifying one a repo was forced into: [`reference/choosing-a-branch-model.md`](reference/choosing-a-branch-model.md).

## What runs automatically vs. what waits for you

**Only resolving the model, the relevance check and opening a work worktree run without asking.** Every move between lines, every write of the declaration and every branch created or deleted for the model waits on an explicit signal. If a push fails with an auth / "Repository not found" error, the environment has no git credentials — the user authenticates (e.g. `gh auth login`) and you retry; never work around it.
