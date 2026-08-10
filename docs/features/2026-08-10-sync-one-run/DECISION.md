# DECISION — `/sync` completes in one run

Read `BRIEF.md` first: it holds the diagnosis (four session boundaries, not one bug) and the target
shape. This records what was decided, what was rejected, and why.

## 1. Resolve the plugin root from the CLI's own manifest

**Decided:** `plugins/project-starter/scripts/resolve-plugin-root.sh` reads `installPath` out of
`~/.claude/plugins/installed_plugins.json` and prints the root that is installed *now*. `/sync` uses
that for every path instead of `${CLAUDE_PLUGIN_ROOT}`.

**Why a script and not prose in `sync.md`.** The resolution has three failure modes worth guarding
(older-than-session, nothing installed, unreadable manifest) and a version comparison. Written as
instructions for a model to follow by hand, that is a repeated manual process — the house rule is to
automate it and derive from one source of truth. As a script it is also testable, which is what
`tools/test-scaffold/resolve-plugin-root.test.sh` now does in 11 cases.

**Rejected — hunting the cache directory.** `find … | sort -V | tail -1` looks equivalent and is not:
the cache retains versions that are no longer installed, so "newest directory" and "installed" are
different questions. It survives only as an announced last resort when the manifest cannot be read.

**Rejected — keeping the restart.** The previous rule ("do not work around this by hunting for the
new version's directory yourself") was right about `find | head -1` and wrong as a general
prohibition. A keyed read of a manifest the CLI just wrote is not a guess. **The guard it protected
is kept, inverted:** resolving *older* than the running session is a hard failure, because that is
the downgrade — older generators over a newer shape, `HOUSE.md` re-stamped backwards, and migrations
do not walk backwards.

**Consequence that needed no extra work.** `scaffold.sh` derives `NX_TOOLS_VERSION` from
`${BASH_SOURCE[0]}` → its own `assets/nx-tools/package.json`, so *which copy executes decides which
payload the project lands on*. The user guessed the third run was "the installation of the latest
nx-tools" — correct, and it collapses into this decision rather than needing one of its own.

**Residual, handled:** the `/sync` command text is frozen too. Step 2 diffs the running `sync.md`
against the resolved one and follows the resolved version when they differ. The resolver itself must
therefore stay a pure manifest read, with nothing version-specific in it — noted in the script.

## 2. Install the workspace deps instead of bailing

**Decided:** a missing `node_modules/.bin/nx` triggers `$PM_INSTALL` and a re-check, rather than
exiting with "run it yourself and start over".

**Why it is not a patch.** The sync already installs at the `install` stage two lines later; the exit
was making the human type a command the script was about to run anyway. Placed *after* the preflight
verdict deliberately — an install is a write, and every refusal promises nothing was written before
it fired.

**Still an error, twice:** the install failed, or it succeeded and there is still no `nx` (meaning
the workspace does not depend on Nx at all, so there is nothing for the sync to drive).

## 3. State one boundary; never perform it

**Decided:** `scaffold.sh` computes what the run actually changed and prints exactly one
`SYNC_NEXT:` verdict — `rebuild-container` / `restart-session` / `none` / `unknown` — plus a separate
`SYNC_RELOAD:` naming regenerated guidance files.

**The insight that made it one line rather than two.** A rebuild *is* a new session and its
post-create reinstalls the plugins, so `rebuild-container` **subsumes** `restart-session`. Reporting
both is two boundaries where one will do.

**`SYNC_RELOAD` is deliberately not a boundary.** `HOUSE.rules.md` / `HOUSE.md` / `CLAUDE.md` are
`@`-imported at session start, but their *content* needs no restart — Claude reads the files and the
new directives are in context. Banking that into a restart would be charging for something free.

**Detect, don't execute** — the same rule the `SessionStart` version hook lives by. The script states
a fact; the user chooses the moment. Both actions throw away the session they are working in.

**Made a seam, not inline code.** It is a `_sync_next()` function between extraction markers, because
this is the half that regresses *silently*: a boundary that stops being reported looks like a clean
run. `tools/test-scaffold/sync-next.test.sh` covers 17 assertions in both directions of failure —
under-reporting (a needed rebuild called `none`) and over-reporting (a verdict on every run).

## 4. The devcontainer mount — the trap that would have poisoned the whole line

Raised by the user mid-build:

> "Consider our DevContainers mount the .claude folder in-workspace. See if that's something
> relevant to incorporate."

It is, and sharply. The generated devcontainer carries:

```
"source=${localWorkspaceFolder}/.claude/data,target=/home/node/.claude,type=bind,consistency=cached"
```

So Claude Code's entire runtime state — the plugin cache, `installed_plugins.json`, auth — physically
lives **inside the project a sync diffs**. And `/sync` step 1 runs `claude plugin update`, which
writes there on the way in.

**Had `SYNC_NEXT` matched `^\.claude/` as a prefix, every sync ever run would have reported
`restart-session`** — earned by nothing but the sync's own bookkeeping. That is precisely the failure
the house already names for the version hook: *a notice that fires when nothing would change is a
notice everyone learns to ignore*. The verdict would have been noise from its first release.

The detection was anchored exactly (`^\.claude/settings\.json$`) and so was safe by construction, but
that safety was invisible and one well-meaning "simplification" from being lost. **Decided:** name
the mount in a comment at the match site, and pin it with two test cases — untracked churn and
tracked churn — so `.claude/data/` being gitignored is not the only thing holding the line.

**Also confirmed, and needing no change:** the bind mount means the plugin cache is per-workspace
(two projects can sit on different toolkit versions without fighting) and survives
`Rebuild Container` intact, unlike a named volume. Both are wanted. The resolver reads `$HOME/.claude`
either way — a plain file read whether or not it lands in the workspace.

## What was deliberately not done

- **No payload release.** `assets/nx-tools/` is untouched: no generator, template or project shape
  changed, so **nothing to migrate**. The scaffolder, the resolver and the command are the plugin's
  own driver, not something projects hold on disk. (Recorded here and in the release commit so a
  later reader can tell a considered "nothing to migrate" from a forgotten one.)
- **No end-to-end sync was run.** The reporter is unit-tested against real git fixtures and its
  wiring verified by reading the call site; a full `--sync` would install the payload, run the
  migration ladder and commit onto this branch — a lot of unrelated regenerated-file noise on a
  branch about the sync command. **This is the one thing still unverified in anger.**
- **The `autoUpdate` ordering question is left open**, as flagged in `BRIEF.md`. If the marketplace's
  `autoUpdate: true` lands after a session's plugin root resolves, step 1 would report "already up to
  date" while the session runs a stale copy. The manifest read makes it moot either way, since
  `installed_plugins.json` is what autoUpdate writes — so it needs no fix, only a test if anyone
  wants certainty.
