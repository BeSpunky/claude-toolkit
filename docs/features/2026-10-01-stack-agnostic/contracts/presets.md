# Contract — presets, and scaffold = sync with an ensure set (phase 6)

> Owner: U-scaffold. Code: `nx-tools/src/layers/presets.ts` (data), `layers/cli.ts` (shell projection),
> `assets/scaffold.sh` (bootstrap). Builds on contracts/layers.md and contracts/adapters.md.

## What a new project is

A new project is **the `agent` layer on the Nx floor** unless asked otherwise. `scaffold.sh <project>` creates an
empty directory, `git init`s it, lays the Nx floor and applies the house layers — exactly what `--sync` does to an
existing repo. The default project has **no package.json, no Angular, no app**: Nx is hosted by its own wrapper
(`./nx`, `.nx/nxw.js`, pins in `nx.json` → `installation`), like a Python or Go repo retrofitted with
`--sync --ensure=agent`.

Today's house web shape is no longer the default; it is a **named preset**: `--preset=angular`.

## Presets are data beside the registry

`layers/presets.ts` exports `PRESETS` (ordered) and `DEFAULT_PRESET`. A preset is `{ id, title, layers }` — a named
ensure set, nothing more. Validated at load (like the registry): every id registered; the set is **closed under
`requires`**; every `via` partner present. Projected into `assets/layers.sh` (`HOUSE_PRESETS`,
`HOUSE_PRESET_DEFAULT`, `house_preset_title`, `house_preset_layers`) so scaffold.sh and `--help` read them like
everything else. Add a preset = one entry + `node tools/test-layers/run.mjs --write`.

| preset | layers | what you get |
|---|---|---|
| `agent` (default) | nx, agent | the house DX on the Nx floor; wrapper-hosted, no Node project |
| `node` | nx, agent, node | a Node workspace: root package.json (create-nx-workspace, `apps` preset), toolkit as exact devDeps |
| `angular` | nx, agent, node, web, angular, design-system | the house web app: Angular app + dev loop + design system (`--firebase` adds Firebase) |

## How the ensure set is formed (scaffold)

`ENSURE = floor ∪ preset(--preset, or the default when neither --preset nor --ensure is given) ∪ --ensure ∪
{firebase if --firebase}`, then **closed under `requires`** (a scaffold starts from nothing, so a requested layer's
prerequisites are created with it — announced, not an error). `via` partners are still refused when missing
(`web` alone cannot say which app it serves). A sync is unchanged: nothing above the floor unless `--ensure`/
`--preset` asks, and a preset whose layers a sync cannot ensure is refused like any other `--ensure`.

## Bootstrap, gated on the ensure set — no layer names in scaffold.sh

- **Host.** `node` ∈ ENSURE → `HOST=node`: `create-nx-workspace --preset=apps` (package.json, yarn). Otherwise
  `HOST=wrapper`: `mkdir` + `git init` + the same `nx init --useDotNxInstallation` block a sync uses.
- **Nx plugins.** Each ensured layer's `nxPlugin` (descriptor field; `angular` → `@nx/angular`) is `nx add`ed, in
  registry order.
- **The first app.** Created only when an ensured layer is a stack whose adapter can create apps (projected as
  `house_layer_app_stack <id>` from `adapters/registry.ts`): `nx g @bespunky/nx-tools:app apps/<app>
  --stack=<adapter> --layers=<ensure set>`. `[app]` on the command line without such a layer is refused.
- Then the planner, exactly as in a sync; `house-doc` stamps last.

`angular` and `firebase` now `require` `node` (an Angular app and Cloud Functions are Node projects); `node` is
scaffold-ensurable (create-nx-workspace creates it), never sync-ensurable.

## Invocation — the default changed, deliberately

`scaffold.sh <project> [app]` used to mean "the Angular house app". Keeping that as the default would make the
`agent` default a lie, so the old meaning is now spelled `scaffold.sh --preset=angular <project> [app]`
(`--firebase`, `--staging` as before). A bare `scaffold.sh <project>` is the agent-only project.
