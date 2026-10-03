---
effort: house-plugin-rename
status: concluded
concluded: 2026-10-03
summary: project-starter is now bespunky-house — /bespunky-house:new|upgrade|add-layer over engine/house.sh, internals renamed to match; a project-starter stub hands existing users over, payload 0.39.0 migrates their settings and .gitignore
tags: [house, rename, cli, migration, plugin-transition]
---

# Decision — the house plugin says what it does

## Why

> "Our sync command is confusing. It doesn't really sync. It... what? updates? upgrades? It updates the
> toolkit and applies changes to the workspace. It also appears under `project-starter`, which is a confusing
> term when you update."

"Sync" described the convergence era (every generator re-asserted desired state). Since the migration ladder
it is an **upgrade**: move the project to a newer toolkit version, run the one-way migrations in between,
regenerate the owned artifacts. `--ensure` is a second job hiding in the same command — **adding a layer**.
`project-starter` described the plugin's first job only; the repo already has the word for what it manages —
the **house** standard (`HOUSE.md`, `HOUSE.rules.md`).

On `add`: *"Excellent. But make `add` more explicit"* → `add-layer`.
On scope: the user chose **"Engine too"** — the script is renamed and moved as well, one vocabulary everywhere.

## The names

| Was | Is |
| --- | --- |
| plugin `bespunky-project-starter` (`plugins/project-starter/`) | `bespunky-house` (`plugins/house/`) |
| skill `new-project` | skill `new` → `/bespunky-house:new` |
| command `/sync` (`commands/sync.md`) | `/bespunky-house:upgrade` (`commands/upgrade.md`) |
| `--sync --ensure=<csv>` | `/bespunky-house:add-layer <csv>` (`commands/add-layer.md`) |
| `skills/new-project/assets/scaffold.sh` | `engine/house.sh` (the whole `assets/` dir → `engine/`) |
| `SYNC_OK`, `SYNC_REFUSED`, `SYNC_NEXT`, … (every `SYNC_*` token) | `UPGRADE_OK`, `UPGRADE_REFUSED`, `UPGRADE_NEXT`, … |
| internals that mirror the commands: run mode `MODE=scaffold\|sync`, planner `--mode=scaffold\|sync`, descriptor `ensurable: { scaffold, sync }`, `HOUSE_LAYERS_ENSURABLE_SCAFFOLD\|_SYNC`, `house_layer_ensurable_scaffold\|_sync`, `SCAFFOLD_OK`, the new-project program's `SCAFFOLD_*_BLOCK`s, the engine-wide `SCAFFOLD_WORK_ROOT` / `_PROJECT_DIR_NAME` / `_ENGINE_ROOT` / `_GIT_*` env, lock `.bespunky-sync.lock/` | `new\|upgrade` everywhere (`RunMode`), `HOUSE_LAYERS_ENSURABLE_NEW\|_UPGRADE`, `house_layer_ensurable_new\|_upgrade`, `NEW_OK`, `NEW_*_BLOCK`, `HOUSE_*` env, `.bespunky-upgrade.lock/` |

### The internal names follow

The first pass renamed only what a user types and kept the internals that mirror the commands. Asked *"why keep
internal names?"*, the user answered: **"yes, rename them"**. So every internal name that *means a command* now
says it (table above). The planner's **ensure** vocabulary (ensure set, ensurable, `ENSURE_ARG`) is **kept** — it
is not a mirror of `add-layer`: it is also what `new` creates and the always-ensured Nx floor.

The lock's rename reaches existing projects through a payload migration, `0.39.0/rename-upgrade-lock`: the
`gitignore` generator only appends, so it retargets the old `.gitignore` line (and its house heading) in place. A
`.bespunky-sync.lock/` **directory** still in the tree is **reported, never deleted** by the migration — it cannot
tell a crashed run's leftover from an older engine's upgrade still running (pid liveness is a process fact, and
across the container path not even in its namespace). `house.sh`, which owns the lock protocol and can check the
holder, treats the old name as the same lock: a live holder refuses the run, a dead one's directory is taken over
before the ladder runs.

### The engine's command line

```
house.sh new       [flags] <project-name> [app-name]              # create; layers via --preset / --add-layer=<csv>
house.sh upgrade   [flags] <project-path> [app-name]              # migrate + regenerate; adds NO layer
house.sh add-layer [flags] <layers-csv> <project-path> [app-name] # an upgrade that also brings layers into being
house.sh help | --help
```

- The subcommand is the **first** token. Flags follow it and precede the positionals (the existing
  flags-before-positionals rule and its guards are kept).
- `upgrade` adds no layer: `--add-layer`, `--preset` and `--firebase` on `upgrade` are refused with a message
  naming `add-layer`. Each command's name says what it does.
- `add-layer` is `upgrade` + an ensure set; `--preset` and `--firebase` are accepted there (a preset is a named
  layer set; `--firebase` = `firebase` in the set).
- `--sync` / `--ensure` / a missing subcommand are **not** understood by `house.sh`. Old invocations go
  through `engine/scaffold.sh`, a **deprecated shim** that translates (`--sync` → `upgrade`,
  `--sync --ensure=X` → `add-layer X`, no `--sync` → `new`, `--ensure=` → `--add-layer=`), prints one
  deprecation line to stderr and `exec`s `house.sh`. Precedent: `--nonAngular`.

## The transition for existing users

- **The old plugin stays as a stub** (`plugins/project-starter/`, still `bespunky-project-starter`): no
  engine, a `commands/sync.md` that installs `bespunky-house` and hands off to its `upgrade`, and a
  SessionStart hook that relays the rename (detect, don't execute). Why this works: the old `/sync` procedure
  already updates the plugin, resolves the newly installed root and *follows the newest copy of its own
  instructions* (step 2, `diff -q … sync.md`) — so the stub's `sync.md` is what an existing user's next
  `/sync` executes.
- **A payload migration** renames `bespunky-project-starter@claude-toolkit` → `bespunky-house@claude-toolkit`
  in the consumer's `.claude/settings.json` `enabledPlugins` (preserving its value). The `claude-settings`
  generator preserves keys it does not declare, so without the migration the old plugin would stay enabled
  forever. The `agent` layer's `claudePlugins` names the new plugin.
- Version continuity: `bespunky-house` continues from `0.39.1` (the `HOUSE.md` stamp's `plugin=` keeps
  ordering); the payload goes `0.38.2` → `0.39.0` with the migrations (`rename-house-plugin`, `rename-upgrade-lock`).

## Out of scope / left as is

- Past feature packages under `docs/features/` keep the old words — they are history.
- This repo's own `.claude/settings.json` gets the new plugin name from its next dogfood upgrade (the
  migration does it), not by hand.

## Superseded — the hand-over stub is removed (2026-10-03)

The `bespunky-project-starter` stub was never explicitly asked for — it rode along inside a larger proposal.
The user, on learning it shipped:

> "I didn't ask you to do that. Remove it completely."

So `plugins/project-starter/` and its marketplace entry are gone, along with the code that existed only for
it (the resolver's other-plugin guard and its test). Existing users switch by hand (README → *Renamed from
`project-starter`*). The 0.39.0 settings migration stays: it migrates project state, it is not a compat layer.
The user also asked that the toolkit never default to backwards compatibility — Claude must ask whether it is
needed; that rule is its own effort.
