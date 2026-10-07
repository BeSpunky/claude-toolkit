---
description: Upgrade this project to the current house standard — update the claude-toolkit plugins, then migrate and regenerate this repo's house tooling. Adds no layer (that is /bespunky-house:add-layer).
argument-hint: "[--voice] [--staging] [--local] [--docker] [--no-backup]"
allowed-tools: Bash, Read
---

The user ran `/bespunky-house:upgrade $ARGUMENTS`, which means **they have explicitly asked for this upgrade,
in this conversation, right now**. That matters for step 4 — it is the one thing that authorises `--yes`.

An upgrade **adds no layer**: it migrates the project to the current toolkit version and regenerates the house
files of the layers it already wears. Bringing a new layer into being is `/bespunky-house:add-layer`, which is
this same procedure with a different step-4 command — if you were sent here from `add-layer.md`, use the
command it gave you in step 4 and follow everything else here as written.

Do these in order, stopping at the first that genuinely fails.

## 1. Update the toolkit — BOTH steps, and they are not the same thing

The generators come from **npm** (`@bespunky/nx-tools`). What lives on disk in the plugin is the **version
number** the upgrade installs and migrates to, plus the `engine/house.sh` that drives the sequence. Updating first is
what raises that target: without it the upgrade faithfully installs and migrates to whatever version this
machine's plugin still names, and stamps the project with it.

**Updating the marketplace is not updating the plugin.** `marketplace update` refreshes the *listing*; the
installed plugin stays where it was. Skip the second command and the upgrade executes an OLDER engine —
which, on a project that is already current, walks it BACKWARDS: an older stamp, an older dependency, and
none of the guards that exist to prevent exactly that. So run both:

```
claude plugin marketplace update claude-toolkit
claude plugin update bespunky-house
```

- Marketplace not configured here (the command errors saying so)? Say so and offer
  `claude plugin marketplace add BeSpunky/claude-toolkit`, then stop — adding a marketplace is the user's
  call, not yours.
- Offline or either step fails? Say so plainly and **ask whether to upgrade anyway** with the version already
  installed. Do not decide that for them: upgrading from a stale toolkit is a legitimate choice, but it is
  theirs, and it quietly writes an older stamp into the project.

**A new version does NOT end this run.** `${CLAUDE_PLUGIN_ROOT}` is frozen for the life of this session, so
the CLI's *"restart required to apply"* is true of that variable — and of nothing else. The new version is on
disk the moment the update returns, and step 2 resolves it. Relay what was updated and carry on.

## 2. Resolve the plugin root that is installed NOW — not the one this session started with

```
PLUGIN_NOW="$(bash "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-plugin-root.sh")" && echo "$PLUGIN_NOW"
```

This reads `installPath` out of `~/.claude/plugins/installed_plugins.json` — the record the CLI itself just
wrote — so it names the version step 1 installed, in this session, with no restart. **It exits non-zero
rather than guess.** Two failures it reports, both of which end the run:

- **the resolved plugin is OLDER than the one this session is running** — the downgrade case. Running it
  would re-stamp `HOUSE.md` backwards and apply older generators over a newer shape, which migrations cannot
  undo. Report both versions and stop.
- **no installed plugin could be located** — report the paths it names and stop.

Use `$PLUGIN_NOW` for every path below. **Never fall back to `find … | head -1`**: that picks an arbitrary
cached version — on a machine with several it has handed back an engine ten releases old — and the cache
retains versions that are no longer installed, so "newest directory" and "installed" are different questions.

**Then check whether the procedure itself moved:**

```
diff -q "${CLAUDE_PLUGIN_ROOT}/commands/upgrade.md" "$PLUGIN_NOW/commands/upgrade.md"
```

If they differ, the steps you are reading are the *old* release's. **Read `$PLUGIN_NOW/commands/upgrade.md` and
follow that instead**, from step 3 onward — the engine you are about to run is its engine, not this
one's. (Running `add-layer`? Diff and follow `commands/add-layer.md` the same way.) Say in one line that you did so.

## 3. Decide WHERE it runs — before it runs, from the project's DECLARED branch model

An upgrade is a change like any other: the ladder commits as it goes, and the generators rewrite files. So the
always-on branch rule applies to it exactly as to any other request (`bespunky-workflow:branch-and-release`,
*Step 0*): classify first, and when the answer is "not this tree", **open the worktree yourself — don't ask,
and don't run the upgrade here to see whether it refuses.** The `protected-branch` refusal below is the
engine's backstop for when this step was skipped, not a question for the user.

**Which branches are protected, and what the worktree is based on, are facts of the project's branch model** —
declared in `.bespunky/branches.json`, never assumed to be `development` → `staging` → `main`. **Invoke the
`bespunky-workflow:branch-and-release` skill and resolve the model through it** (its engine's `status`: the
copy on the integration line's tip is the one in force; exit `3` means undeclared). Don't reach for the engine
by a path written here — the skill knows where it lives. Then:

- **Declared, and HEAD is on one of its protected lines** (a name in `projection.protected`, or a release line
  matching `projection.protectedPatterns`) — the upgrade is its own unit of work. Open a worktree off the
  **integration line** (`projection.integration`) and upgrade THERE:

  ```
  SLUG="house-upgrade-$(date -u +%F)"
  git worktree add ".claude/worktrees/$SLUG" -b "chore/$SLUG" <integration>
  ```

  If that worktree already exists (an earlier upgrade today, not yet landed), it is the same effort — use it.
  Run step 4 from inside the worktree, with the Nx workspace-root override the branch rule requires for any
  Nx command in a worktree (`NX_DAEMON=false NX_WORKSPACE_ROOT_PATH="$PWD"`). A fresh worktree is clean, so
  uncommitted work in the tree you started from is untouched and irrelevant to this run. An upgrade needs no
  feature package — its migration commits and `UPGRADE_OK` are the record.
- **On a work branch** — upgrade there only if the upgrade belongs to that branch's in-flight work (it is testing a
  toolkit change, say, or the branch exists to adopt the house tooling). Otherwise it is unrelated: open the
  worktree off the integration line exactly as above.
- **UNDECLARED** — see *3b*. Until a model is declared, every branch named `main`, `master`, `development`,
  `develop` or `staging` is protected: on one of them, open the worktree **off the branch you are on** (same
  commands, `<integration>` replaced by the current branch); on any other branch, apply the work-branch rule
  above.

Say in one line where the upgrade is running and why. Promotion afterwards waits for the user's signal like any
other change — the worktree is where the upgrade happens, not a licence to land it.

### 3b. No declared model — investigate and ASK, but don't hold the upgrade hostage to it

The user's rule for this state: *"Projects without a json file should trigger Claude to investigate the current
layout and suggest one to the user. That should happen on `/sync`."* (this command's former name) — and *"no json means asking the user."*
So when the model is undeclared (the skill's `status` exits `3`, or the run prints
`[preflight] branch-model: undeclared`), **follow the branch-and-release skill's *choosing a branch model*
procedure** (`reference/choosing-a-branch-model.md`): gather the evidence — not the branch list alone, since
projects the toolkit once forced into three lines all *have* `development`/`staging`/`main` whether they need
them or not — judge whether each line justifies itself, propose a model, and **ask**. Never write the
declaration without the user's answer, and never let the upgrade write it: it lands through the skill's own
change procedure, on the integration line the user chooses.

**Where this sits, and why: the upgrade runs first, the question is asked in the report — unless the user wants
the model settled first.** The upgrade's commits land on its own worktree branch, and *landing* that branch is a
human-gated move that needs the model anyway (it names the line to land on). So nothing the upgrade writes
depends on the answer, and the answer gates the one step that does. Running the investigation's evidence
first is cheap and read-only — do it before step 4 if you like — but put the proposal and the question at the
end, in step 6, alongside the upgrade's own report; don't make the user wait on a branch-model conversation to
get the house tooling they asked for. **Settle it first instead when** the user says so, or when the evidence
shows the current branch is a production line with live deploy bindings and nothing else to base on — then
ask before step 4, and base the upgrade's worktree on the integration line the user chose.

The house docs this upgrade renders will carry the *undeclared* wording until a model is declared; the next upgrade
after the declaration lands renders them with the real line names.

## 4. Run the upgrade

```
NX_DAEMON=false NX_WORKSPACE_ROOT_PATH="$PWD" bash "$PLUGIN_NOW/engine/house.sh" upgrade --yes $ARGUMENTS .
```

Running the *resolved* engine is also what makes the payload right: `house.sh` derives the
`@bespunky/nx-tools` version it installs and stamps from its own directory, so whichever copy executes
decides which payload the project lands on. The frozen root would install and stamp the old one, leaving the
ladder for a later run to walk.

**The trailing `.` is the target, and only flags may come before it.** `house.sh` takes flags first and
positionals last, so the first non-flag token it sees *is* the project path. Read what `$ARGUMENTS` actually
expanded to above **before you run this**: if any token there does not start with `--`, that token lands in
the project slot, the `.` behind it is silently absorbed as an *app name*, and the upgrade runs against a
different repo than the one this command promises. In that case **do not run it** — say what happened, and
point at the raw script (the `bespunky-house:new` skill, §1a) for upgrading a project other
than this one. Never reorder the `.` to the front either: a flag after the path is rejected outright.

**About `--yes`.** The upgrade refuses to run unattended because it rewrites generated files, and your shell
has no TTY to ask through. `--yes` asserts a human explicitly agreed *in this conversation* — which is
exactly what invoking `/bespunky-house:upgrade` (or `/bespunky-house:add-layer`) is. **This is the only situation in which you may pass it.** Never carry that
reasoning to an upgrade you decided to run yourself, one suggested by the SessionStart hook, or one in a
scripted or headless run.

**Do not add `--no-backup`.** In a git repository it changes nothing — the restore point is the clean `HEAD`
preflight requires — and its only remaining meaning is "upgrade a directory that is NOT a git repository, with no
restore point at all". That is the user's call to make, never yours.

**Pass `$ARGUMENTS` through, and add nothing of your own.** An upgrade adds no layer, and the engine refuses
`--add-layer`, `--preset` and `--firebase` on `upgrade`, naming `add-layer`: adding a layer CREATES capability
the project did not ask for, so it is a separate command the user chooses (`/bespunky-house:add-layer`). Never
switch to it on their behalf. The one layer an upgrade always ensures without being asked is the **Nx floor** —
see *The rest*, below.
Make no assumption about the stack either: the project may be Angular, plain TypeScript, Python, Go or docs;
the upgrade detects what it wears and refreshes exactly that.

## 5. Handle the outcomes that aren't plain success

### The `[migrate]` line — read it, it is the most consequential thing the upgrade prints

Before any generator runs, the upgrade hands `nx migrate` the house tooling's **versioned one-way migrations**
(see the `bespunky-house:new` skill, §1d). It works out where the project actually is with a **probe** taken before
anything is written — the older of the version installed (in `node_modules`, or `.nx/installation` on the
wrapper host) and the one stamped in `HOUSE.md` — and passes that as an explicit `--from`. Exactly one `[migrate]` outcome line appears. **Match it by
meaning, not by its exact wording** (it is prose, and it gets tuned):

- **the ladder ran**, naming the two versions it walked between. **Relay this loudly.** These are one-way
  deltas, not idempotent re-assertions: they rewrite **every project in the workspace**, not just the one app
  the per-app generators target, and there is no reverse. Name the two versions and point at the restore point
  from `BACKUP_OK` (the clean pre-upgrade `HEAD` sha), because that commit is the only way back.
- **the baseline line**, saying the toolkit was not installed here before this run — normal on a first
  retrofit. There is no applied version to migrate *from*; the project is simply being brought to baseline.
- **the steady-state line**, saying the project is already at the version being installed, so there is
  nothing to run — the ordinary case.

A **fourth** `[migrate]` line may accompany the first: when the installed version and the `HOUSE.md` stamp
disagree, the upgrade reports both and says which it migrated from. Relay it — that disagreement is the
caret-float case (a plain install floated `node_modules` ahead with no migration behind it), and the line is
the proof the ladder was run from the honest floor rather than silently skipped.

**Migrations land as commits, one per migration** (`chore: [nx migration] <name>`), preceded by a
`checkpoint before running migrations` commit. So `git log --oneline` after a migrating upgrade is the honest
account of what changed, and a single bad migration can be reverted on its own rather than unpicked out of
one large diff. Two consequences worth relaying:

- Every one of those commits is built with `git add -A`. **This is why a dirty tree is refused before the
  ladder runs at all** (see *The upgrade refused before writing anything*, below) — `git add -A` cannot tell the
  files a migration wrote from the ones that were already there, so uncommitted work would be committed under
  a migration's message. Nx *may* also open a `checkpoint before running migrations` commit first, but do not
  rely on it to separate anything: it is Nx's behaviour, not the house's, it has not appeared in every run,
  and when it doesn't, the in-flight work lands inside the **first migration commit** — named after that
  migration, describing something else entirely. The gate exists because that separation was promised here and
  did not hold.
- On a repo with no git, the upgrade says so and runs the migrations **without** commits rather than failing —
  `--create-commits` is a hard error outside a repository.
- **If `node_modules` is not git-ignored, the upgrade also drops the commits** and says so. That same `git add -A`
  would otherwise commit thousands of vendored files as a side effect of a version bump, which is far worse
  than losing the per-migration granularity. This fires on exactly the repos `add-layer agent` exists to
  retrofit. Relay it and suggest adding `node_modules` to `.gitignore` — the migrations still ran; only the
  commit ladder was skipped, so `git diff` is the record for this run instead of `git log`.

Do not offer to squash, amend or reword these commits unless the user asks. They are the record.

**If a migration fails mid-ladder, STOP.** Do not re-run the upgrade to "get past it": the version bump (in
`package.json`, or `nx.json` → `installation` on the wrapper host) and the install have already happened, the project is half-migrated, and Nx leaves its `migrations.json` sitting
in the workspace root. Re-running restarts the ladder against a tree that is partly through it. Surface the
failing migration's name, the restore point, and the leftover `migrations.json`, and let the user decide between
fixing forward and restoring — with the commands the failure printed: `git restore --source=<sha> --staged
--worktree -- .` puts every tracked file back, then `git clean -n` lists what the run ADDED (review before any
`-f`). **Never `git reset --hard`**: it moves the branch and discards the working tree wholesale, the one undo
that can destroy something the upgrade did not make.

One failure there is worth recognising on sight, because Nx's message gives no clue what it is about:

```text
TypeError: Cannot use 'in' operator to search for '0' in <a sentence of English prose>
```

That is a **`//`-prefixed documentation key sitting inside `targets`** in some `project.json`. Inside
`targets` — and only there — Nx reads every value as a target, so it spreads the comment string character by
character; the `'0'` is a character index. On older Nx the same path did not throw, it wrote the spread back,
which is how a comment becomes a several-hundred-key object in `project.json`. The `convert-target-comment-keys`
migration (0.26.0) moves these onto the target's `metadata.description`, but migrations older than it call the
same Nx API and will fail first on a project that is far enough behind. The fix is one edit: find the `//` key
inside `targets` named in the message, move it onto the target it documents (or up to the project root, where
it is harmless), and re-run. Do not delete it on the user's behalf — it is their documentation.

### The branch-model signal — `[preflight] branch-model: …`

Every upgrade in a repository with history prints one line about the branch model, whether it then runs or is
refused. It **blocks nothing by itself**:

- **`branch-model: declared — <summary>`** — the model in force and where it was read from (the integration
  line's tip, normally). Notes beneath it say when this tree's copy differs from that one; relay them.
- **`branch-model: undeclared`** — no model is declared. Run *3b* if you haven't already: investigate, propose,
  and ask (in the report, unless the user wants it settled first). Also printed when this tree carries a
  declaration that has **not landed** on its integration line yet — it is not in force until it does.

### The upgrade refused before writing anything — `UPGRADE_REFUSED`

The upgrade checks a handful of **preconditions before its first write** and stops if any fails. The first line
of the output is the contract, in the same vocabulary as `UPGRADE_OK` and `UPGRADE_PARTIAL`:

```text
UPGRADE_REFUSED: dirty-tree protected-branch
```

**It may carry several codes** — every check runs before anything is reported, so a run that is wrong in three
ways says so once. Read them all; fixing one and re-running to discover the next
is the round-tripping the aggregation exists to prevent.

**Lead your reply with the fact that nothing was written.** The project is byte-for-byte as it was — no
install, no migrations, no generators, no commits. That is the whole point of refusing at this position, and
it is the first thing the user needs to know before they read a wall of blockers.

**The gate deliberately does not resolve anything, and — `protected-branch` and `unwritable-mounts` aside, whose answers are already fixed — neither should you on your own.** It stops because a
shell script cannot know what you know: whether the uncommitted work is related to this upgrade, whether a
feature package is open, whether a worktree already exists for it, or what the user asked for five minutes
ago. **Read the situation, propose the options that actually fit it, and let the user choose.** Do not stash,
commit, branch or check anything out on your own initiative — an upgrade is not authorisation to rearrange
someone's git state.

- **`dirty-tree`** — uncommitted changes; the report splits them into staged / modified / **untracked** and
  gives the totals. Weigh the untracked count especially: those are whole new files and directories, the work
  least likely to be reconstructable, and `git add -A` sweeps them exactly like an edited line. Look at what
  the paths actually are before you offer anything, then put the fitting options to the user — commit it (is
  it a coherent unit? does it belong on this branch at all?), stash it, branch and commit it there, upgrade in a
  separate worktree, or something the situation suggests that this list doesn't. If the work is unrelated to
  the current branch, say so — that is usually the most useful observation you can make here.

- **`protected-branch`** — HEAD is on a protected line: one the declared model protects (by name, or a release
  line matching its glob), or — with no model declared — a branch named `main`, `master`, `development`,
  `develop` or `staging`. The ladder commits as it goes, so upgrading here would commit straight onto a line
  that is supposed to advance only by landings and promotions. **This is a code you resolve yourself, without
  asking:** it means step 3 was skipped. Open the worktree exactly as step 3 says — off the integration line the
  message names, or, undeclared, off the current branch — and re-run there. The branch-model question (3b) is
  separate and does not have to be answered first.

- **`branch-model-unreadable`** — `.bespunky/branches.json` exists but cannot be read with certainty: invalid
  JSON, no `projection`, or a `projection.schema` major this toolkit does not know (a newer engine wrote it).
  The run stops rather than guess which lines are protected. An unknown schema means this machine's toolkit is
  behind — check step 1 updated it. Anything else is a damaged declaration: repair it through the
  branch-and-release skill's change procedure, never by hand (the projection is derived). Tell the user which.

- **`staging-without-stage`** — `--staging` was passed, and the declared model has no pre-production stage for
  the staging bundle to deploy from (trunk, two-line, gitflow, maintained releases). Put the choice to the user: drop
  `--staging`, or add a pre-production stage to the model first — a model change, which goes through the
  branch-and-release skill's change procedure (verify, risks, confirm) — then re-run.

- **`unwritable-mounts`** — a directory the upgrade must write into (`node_modules`, `.nx`, or any workspace
  volume the project's `devcontainer.json` mounts) exists but is not writable by the current user. The usual
  cause: Docker creates a named volume's mount point **root-owned**, the container's post-create never reclaimed
  it, so its install died with `EACCES` and the project has no dependencies — and the upgrade's own install would
  die the same way. **Resolve this one yourself, without asking:** the remedy is a deterministic ownership fix
  of the project's own mount points, not a choice about anyone's work. In the directory the upgrade ran on, run
  the exact `sudo chown -R "$(id -un):$(id -gn)" <paths>` line the refusal prints, then re-run the container's
  post-create it names (`bash .devcontainer/post-create.sh`, or `post-create.bespunky.sh` beside it), then
  re-run this command from the top. Tell the user in one line: *the dependency volumes were root-owned, so I
  reclaimed them and re-ran post-create.* If `sudo` is unavailable, that is the one case to hand back.

- **`detached-head`** — HEAD is on no branch, so the ladder's commits would belong to nothing and become
  unreachable the moment anything is checked out. Check out a branch, or create one at this commit, and
  re-run. Ask which; do not pick a branch for them.

- **`downgrade`** — the project has been on house tooling **newer** than this checkout's version (the message
  names both sources: `node_modules` and the `HOUSE.md` stamp). Continuing would install an older payload, run
  older generators over a newer shape, and re-stamp `HOUSE.md` backwards — and migrations do not walk
  backwards, so there is no repair path. Check that step 1 actually updated the plugin; if it reported nothing
  new, this machine is genuinely the older one, and say so plainly. **There is no flag to override this, by
  design; don't look for one.**

**There is no override flag for any of these, deliberately.** Every resolution — commit, stash, backup branch,
new branch, worktree — ends with a clean tree on a working branch, so a bypass could only ever reproduce the
failure the gate removes. If you find yourself looking for one, the answer is the resolution, not the flag.

Once the user has chosen and the state is resolved, **re-run this command from the top** rather than resuming
mid-way. Step 1 may matter again, and the gate is cheap.

### The rest

- **`BACKUP_ABORT: … is not a git repository`** — very common on a first retrofit. The upgrade **refused to
  change anything** rather than rewrite files with no restore point. Relay the two ways out it printed:
  `git init && git add -A && git commit` in the project, or `--no-backup`. Prefer the first, and only pass
  `--no-backup` if the user asks for it — see the rule above. (In a git repository there is no backup step to
  fail: preflight requires a clean tree, so the restore point is simply `HEAD`.)

- **`[layers] ensure nx: …`** — the repo had no `nx.json`, so the upgrade laid the **Nx floor** in place
  (`nx init`). Not an error: the floor is always ensured, because every house generator and migration runs
  through Nx; everything *above* it stays opt-in. Relay which host it chose, since it decides what the repo
  gained. With a `package.json`, Nx went into `node_modules` through the project's own package manager. With
  **none** (a Python, Go or docs repo), Nx came through its **wrapper**: the repo gains `nx.json`, `./nx`,
  `nx.bat` and `.nx/nxw.js`, with the toolkit pinned exactly in `nx.json` → `installation.plugins` — and no
  `package.json`, lockfile or `node_modules`, so it does not become a Node project. Nx commands there are
  `./nx …`. If the user ran a plain upgrade on such a repo, they got the floor — Nx, the house docs
  (`HOUSE.rules.md` + `HOUSE.md`, imported from `CLAUDE.md`, seeded if absent) and each layer's `.gitignore`
  entries — and nothing above it; **offer** `/bespunky-house:add-layer agent` for the house DX (devcontainer, Claude
  settings, window identity) and wait for a yes.

- **`… cannot ENSURE the '<layer>' layer`** (from `add-layer`) — relay the message verbatim (a `--preset`
  naming such a layer is refused the same way). It already names the native command to add that layer, after
  which a plain upgrade detects it. Don't work around it.

- **`[install] node_modules/.bin/nx is missing …`** — **not an error.** The project's dependencies were never
  installed (a fresh clone), so the upgrade installs them itself and carries on. (On the wrapper host the same
  thing happens silently: `./nx` reinstalls `.nx/installation` from the pins in `nx.json`.) Nothing to relay beyond the fact
  that it happened, and nothing to re-run. It only becomes an error two ways, both of which end the run and
  both of which say so: the install *failed*, or it succeeded and the workspace still has no `nx` — meaning
  this workspace does not depend on Nx at all, so there is nothing here for the upgrade to drive.

- **`ERROR: could not read this workspace layers`** — the layer registry failed to load, so the upgrade stopped
  rather than guess. This is a **refusal, not a crash**: a failed detection is indistinguishable from an empty
  project, and continuing would skip the house tooling for every layer the project actually has. Relay it as a
  toolkit-side fault (usually a broken or partial `@bespunky/nx-tools` install); a reinstall and re-run is
  the fix, not a different flag.

## 6. Report

**The upgrade is finished when it prints `UPGRADE_OK`. It does not need running again** — say so, because two or
three passes used to be the habit and people still expect it. **But `UPGRADE_OK` means the run completed, not that
the result builds** — never report it as a verification.

### Verify what it rewrote — `UPGRADE_VERIFY`

If the output carries an `UPGRADE_VERIFY:` line, **run the command it names** in the upgrade's tree (with the
worktree prefix from step 4) before you report. It builds, lints and tests exactly the projects the run touched,
measured from the pre-upgrade restore point. A failure is the most important thing in your report: say which
target failed and in which file. If that file is one the upgrade **wrote** (a generator-owned file, or a file a
migration named in its log), the fault is the toolkit's, not the project's — say so, and do not patch a
generator-owned file locally (the next upgrade rewrites it); the fix belongs upstream in `@bespunky/nx-tools`.
A target that already failed before the upgrade (check it at the restore point if unsure) is not the upgrade's —
report it as pre-existing.

### First, close the gap the run left open — `UPGRADE_RELOAD`

If the output carries a `UPGRADE_RELOAD:` line, **Read every file it names** (`HOUSE.rules.md`, `HOUSE.md`,
`CLAUDE.md`) before you report. They are `@`-imported at session start, so the *old* text is what is in your
context right now — and the upgrade just rewrote the house directives you are meant to be working under.
Reading them puts the new content in context immediately; this needs no restart and is not a boundary. Do it
silently and mention it in one clause.

### Then report, summarising from the output, not from assumption

- **whether migrations ran** (the `[migrate]` line) and between which versions — first, because it's the only
  irreversible part;
- the layers it reported active, and the package manager it detected;
- if it printed an `[devcontainer] Adopted the existing …` line, read `.devcontainer/.bespunky-devcontainer.json`
  and tell them which keys were left as theirs — that is the divergence the upgrade will never fix on its own;
- the restore point from the `BACKUP_OK` line (also `backup=` in `UPGRADE_OK`) — the clean pre-upgrade `HEAD` — and how
  to use it: `git diff <sha>` reviews the upgrade; `git checkout <sha> -- <path>` restores one file;
  `git restore --source=<sha> --staged --worktree -- .` (then `git clean -n`) undoes it all. Never `reset --hard`.

### Steps only the human may take — `HUMAN_STEP:`

A generator prints `HUMAN_STEP: <line> — <why>` for something the user must do themselves — today, the `ci` layer's
cloud setup (`! bash tools/setup-gcp.sh --environment <env>`) whenever the environments it was rendered for changed, and
its `--rollback` while a removed binding's setup is still recorded.
**Relay each one verbatim, as a step for the user, and never attempt it yourself**: it grants IAM, which Claude Code
refuses to agents by design — no `gcloud iam …`, no workaround, no retry. Say what to paste back (the `gh variable
set …` lines it prints; you may run those once pasted — they are not secrets). It is not a boundary — it does not
count against the one `UPGRADE_NEXT` below. A `[ci] No deploy workflow: …` warning is not a human step: relay its
reason (usually *declare a `ci` binding through the branch-and-release skill*) and offer to do that.

### If the model is undeclared — the proposal and the question (3b)

Unless it was settled before step 4, close the report with the branch-model proposal: the evidence that
decided it (each line justified, ceremonial or unused — and anything *unobservable*, as a question), the model
you propose, and the question itself. Say plainly that the upgrade's worktree branch waits on the answer to land.
It is a question, not a boundary — it does not count against the one `UPGRADE_NEXT` below.

### Last, the one boundary — `UPGRADE_NEXT`

The run states exactly one, computed from what it actually changed. **Relay it and stop there** — never
report two, and never invent one the line didn't ask for:

| `UPGRADE_NEXT:` | What to tell the user |
| --- | --- |
| `none` | Nothing further. Say it plainly — silence here reads as "restart to be safe", which is the habit we are retiring. |
| `restart-session` | Restart Claude Code when convenient, to pick up `.claude/settings.json` / `.mcp.json`. **No rebuild.** |
| `rebuild-container` | Run **Dev Containers: Rebuild Container** when convenient. It *subsumes* the restart — do not also ask for one. |
| `unknown` | The run had no git base to compare against; say so and name the three paths it would have checked. |

**Never perform the boundary yourself** — no rebuild, no restart, no reload of plugins on your own
initiative. The script states the fact, the user chooses the moment; both actions throw away the session
they are working in, and only they know what that costs right now. Same detect-don't-execute rule as the
`SessionStart` version hook.
