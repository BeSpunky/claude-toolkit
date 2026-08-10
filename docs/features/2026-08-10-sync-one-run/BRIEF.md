# BRIEF — `/sync` completes in one run

## The ask

> "Our sync command currently requires users to run it between 2 and 3 times so Claude applies
> mid-process changes in a new session. How can we avoid that and have the sync run once and
> complete everything?"

Asked when the third run's cause was no longer remembered:

> "Not necessarily. I can't remember what it was. Maybe the installation of the latest nx-tools"

That guess turned out to be right, and to collapse into the first cause — see below.

## Diagnosis — four session boundaries, not one bug

### 1. The plugin-root freeze — the guaranteed wasted run

`commands/sync.md` §1 updates the plugin, then §2/§3 run
`${CLAUDE_PLUGIN_ROOT}/skills/new-project/assets/scaffold.sh`. `CLAUDE_PLUGIN_ROOT` is fixed for the
life of a session, so when the update reports a new version the command **stops and demands a
restart** — and run #1 syncs nothing. That is every run that matters: nobody syncs when the toolkit
has not moved.

But the new version is on disk the instant the update returns. The cache is versioned per plugin
(`~/.claude/plugins/cache/claude-toolkit/bespunky-project-starter/<version>/`) and
`~/.claude/plugins/installed_plugins.json` names the current one authoritatively as `installPath`.

**`CLAUDE_PLUGIN_ROOT` is *a* pointer to the scaffolder, not *the* pointer.**

The existing prohibition — *"Do not work around this by hunting for the new version's directory
yourself"* — was correct against the alternative it was written for (`find … | head -1`, an
arbitrary pick that once handed back a scaffolder ten releases old). A keyed read of a manifest the
CLI itself just wrote is a different act. The downgrade guard survives, inverted: if the resolved
version is *older* than the frozen root, that is the genuine anomaly and the sync stops.

### 2. …which is also the nx-tools cause (the user's guess)

`scaffold.sh` derives `NX_TOOLS_VERSION` from `$ASSETS_DIR/nx-tools/package.json`, and `ASSETS_DIR`
comes from `${BASH_SOURCE[0]}` — the directory of the `scaffold.sh` that actually ran. So **which
payload gets installed is purely a function of which plugin copy executed.** An old frozen root
installs the old pinned payload, `house-doc` stamps `HOUSE.md` with it, and the *next* sync has to
walk old→new through the migration ladder. Two installs, two ladders.

Not a separate fix: resolving the scaffolder path correctly fixes the payload version for free.

### 3. `node_modules/.bin/nx not found` — a genuine second round trip

`scaffold.sh` hard-exits with *"run '<pm> install' in the project first, then re-run --sync"*. The
sync needs the workspace's own `nx` to migrate and generate — fair — but it already runs installs a
few lines later at the `install` stage. Bailing out to make the human type the command the script is
about to run anyway buys nothing.

### 4. The config-takes-effect boundary — real, but it belongs at the END

The sync writes what Claude Code only reads at startup: `.claude/settings.json` (`enabledPlugins`,
`extraKnownMarketplaces`, `outputStyle`), `.mcp.json`, hooks from newly-enabled plugins. Nothing
applies those mid-session. That is a real constraint, not a design flaw — but it is a **restart
after the sync**, not a re-run, and it only reads as a re-run today because cause #1 already spent a
restart, teaching the shape "sync, restart, sync again".

Two refinements:

- **`HOUSE.rules.md` / `HOUSE.md` / `CLAUDE.md` need no restart at all.** They are `@`-imported at
  session start, but Claude can simply **Read** them once the sync finishes. Content in context, no
  boundary.
- **A devcontainer rebuild absorbs the restart.** Mounts, `runArgs` and features only apply at
  creation, but a rebuild *is* a new session and its post-create reinstalls every plugin. So the tail
  must be **one** boundary chosen by what actually changed, never two.

### Open question, deliberately not guessed

`settings.json.tpl` sets `"autoUpdate": true` on the `claude-toolkit` marketplace. If that update
lands *after* the session's plugin root resolves, §1 reports "already up to date", carries on, and
quietly runs the pre-update copy — the silent variant of the same trap. Whether it fires depends on
ordering inside the CLI. The `installed_plugins.json` fix makes it moot either way, since the
manifest is what autoUpdate writes.

## The target shape

**One run, at most one terminal boundary, and never a boundary mid-flight.**

| Change | Where |
| --- | --- |
| Resolve the scaffolder from `installed_plugins.json`, not `CLAUDE_PLUGIN_ROOT` | a resolver script + `sync.md` §2 |
| Follow the *resolved* version's `sync.md` when it differs from the running one | `sync.md` §2 |
| Install the workspace's deps instead of bailing on missing `nx` | `scaffold.sh` |
| State the required tail boundary as a machine-readable fact | `scaffold.sh` → `SYNC_NEXT:` |
| Read `HOUSE.rules.md` in-session so new directives are live immediately | `sync.md` §5 |

`SYNC_NEXT` keeps the house detect-don't-execute rule: the script states the fact, the model relays
it, the human acts. Claude never rebuilds a container or restarts a session on its own initiative.

Two legitimate re-runs remain and are already handled: `SYNC_REFUSED` (which aggregates every
blocker so one round trip surfaces them all) and `SYNC_PARTIAL`.
