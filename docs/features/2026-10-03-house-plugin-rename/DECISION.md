---
effort: house-plugin-rename
summary: Rename the project-starter plugin to bespunky-house, its sync command to upgrade, and --ensure to add-layer, so the names say what they do
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
  ordering); the payload goes `0.38.2` → `0.39.0` with the migration.

## Out of scope / left as is

- Past feature packages under `docs/features/` keep the old words — they are history.
- This repo's own `.claude/settings.json` gets the new plugin name from its next dogfood upgrade (the
  migration does it), not by hand.
