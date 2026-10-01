# Contract — the layer registry (phase 1)

> Owner: U-core. Later units (devcontainer fragments, dev-process contract, firebase/DS adapter split, presets)
> build on this. Code: `plugins/project-starter/skills/new-project/assets/nx-tools/src/layers/`.

## The shape

One file per layer, `layers/<id>.ts`, exporting a `LayerDescriptor` (`layers/descriptor.ts`):

| field | meaning | read by |
|---|---|---|
| `id` | open string, `^[a-z][a-z0-9-]*$`, unique | everything |
| `title` | one line | errors, `--help` |
| `requires` | ids that must be present; must be registered **earlier** (registry order = topological order) | `requireLayer`, planner (unmet → steps skipped + `SYNC_PARTIAL`), scaffold requires-closure |
| `evidence` | declarative: `files`, `dependencies`, `targets`, `tags`, `projects`, `executors` (prefix) | `evidence.ts` (exact, on a Tree) **and** `layers.sh` (grep, for the hook) |
| `detect?(tree)` | refinement OR-ed with evidence, for what grep can't say (DS tag-or-name) | registry only |
| `ensurable` | `{ scaffold, sync }`, each `true \| false \| { via: id }` | scaffold.sh validation |
| `ensureHint` | how a human adds it | errors |
| `brings` | one line, what its tooling brings | hook drift notice |
| `generators` | `{ workspace?: GeneratorStep[], app?: GeneratorStep[] }`; a step is `{ generator, args?(ctx), skip?(ctx) }` | planner |
| `devcontainer?` | **phase 2** — the layer's devcontainer fragment | nothing yet |
| `docSections?` | **phase 2** — HOUSE.md/HOUSE.rules.md section flags | nothing yet |
| `claudePlugins?` | **phase 2** — `plugin@marketplace` ids this layer enables (`angular` → `bespunky-angular`) | nothing yet |
| `migrationScope?` | phase 1/4 — the `layer` its rungs declare (defaults to `id`) | nothing yet |

`PlanContext` (what `args`/`skip` see): `tree, mode, active, ensured, project, app, nodeMajor, voice, staging`.
Args are argv words; the planner **refuses** a word with whitespace/shell syntax and any flag passed twice.

Current graph: `nx[]` (floor) · `agent[]` · `js[nx]` · `web[agent]` · `angular[nx]` · `design-system[angular]` ·
`navigation[angular]` · `firebase[angular]` (phase 4 splits firebase/DS into core + adapter).

**No `node` layer.** It was considered and not added: nothing runs for it (no generator, no doc section yet),
and its only job in the DECISION draft — being `nx`'s prerequisite — was removed by the wrapper host. "Is this a
JS/TS project?" is already `js`; "does it have a package.json?" is a *hosting* fact the sync decides (below), not
a capability a project wears. Add it when a phase gives it a generator or a devcontainer fragment.

## How to add a layer

1. Write `layers/<id>.ts` exporting the descriptor.
2. Add it to `REGISTERED` in `registry.ts` after everything it requires (validated at load).
3. `node tools/test-layers/run.mjs --write` — regenerates `assets/layers.sh`; add a fixture/plan case there.
4. Nothing else: scaffold.sh, `--help`, the hook and house-doc's `--layers` all follow.

## How scaffold.sh consumes it

- **Outer shell** (before anything is installed; on the Docker path the host may have no usable Node) sources
  `assets/layers.sh`, the **generated** pure-bash projection (`cli.js shell`): `HOUSE_LAYERS`,
  `HOUSE_LAYER_FLOOR`, `HOUSE_LAYERS_ENSURABLE_{SCAFFOLD,SYNC}`, `house_layer_{title,requires,hint,brings,
  ensurable_scaffold,ensurable_sync,evidence}`, and the evaluator `house_layers_evident <dir>`. Drift between
  projection and registry fails `tools/test-layers/run.mjs` (CI: `migration-tests.yml`).
- **Rendered sequence** asks the *installed* package: `node $NXT_DIR/src/layers/cli.js detect` and
  `… plan --mode … --active … --ensured … --project … --app …`, and runs each `gen<TAB>generator<TAB>args`
  line as `$NX_RUN g @bespunky/nx-tools:<generator> <args>` (`warn` → printed, `partial` → `SYNC_PARTIAL`).
  Order: per-app steps (sync only), workspace steps in registry order, then `house-doc` — the planner's
  layer-independent **stamp** step, always last.
- **The SessionStart hook** sources the same `layers.sh` and reports `house_layers_evident` minus the stamp.
- Scaffold **bootstrap** (create-nx-workspace, `nx add @nx/angular`, the `app` generator) is still shell, gated
  on `layer_ensured` — phase 6 turns it into presets.

## The Nx floor and the wrapper host — decision and evidence

Nx is **always ensured**: `ENSURE_LAYERS` always contains `HOUSE_LAYER_FLOOR`, and a sync on a repo without
`nx.json` runs `nx init` instead of refusing. Everything above the floor stays opt-in.

How the floor is hosted (`HOST`, decided at render time):

- **node** — the repo has a `package.json`: `nx init --useDotNxInstallation=false`, toolkit as exact devDeps.
- **wrapper** — no `package.json` (or an existing `.nx/nxw.js` + `installation` block): `nx init
  --useDotNxInstallation=true --interactive=false --aiAgents=none --plugins=skip`; the toolkit is pinned in
  `nx.json` → `installation.plugins` (`@bespunky/nx-tools: <exact>`, `@nx/devkit: <nx version>`); `./nx`
  installs to match. The repo gains `nx.json`, `./nx`, `nx.bat`, `.nx/nxw.js` and a `.gitignore` — no
  package.json, lockfile or node_modules.

Evidence (nx 23.2.1, scratch repos, 2026-10-01): exact pin written by `./nx add` and by hand, compared verbatim by
`nxw.js`; `@nx/devkit` resolves (auto-installed peer) but floats unless pinned → we pin it; `house-doc`,
`claude-settings`, `window-identity` ran; `nx migrate @bespunky/nx-tools@0.34.0 --from=…@0.29.0` collected
4 rungs and `--run-migrations` ran them, rewriting the pin exactly; `nx/src/generators/tree` resolves through
nx's exports map; fresh clone (`.nx/installation` gitignored) reinstalls the pins. End to end with this branch:
`scaffold.sh --sync --local --ensure=agent` on a `main.py`-only repo → wrapper, nx,agent applied, stamped
`layers=nx,agent`, second run idempotent, a 0.33.0→0.35.0 ladder ran through `./nx migrate`.
The old registry hint ("the dot-nx installation cannot host devkit plugins") no longer holds on Nx 23.

Known edges: under `--local` the wrapper pin is `file:<tarball>` during the run (the checkpoint commit captures
it, exactly as the node host's package.json does) and is corrected to the plain version at the end.
`house-doc` renders `{{PM}} nx …` — `npm nx` on the wrapper host (and on npm projects); phase 2 should render
the nx invocation (`./nx` / `npx nx`) rather than the package manager.

## Migration scope

Every `migrations.json` entry declares `layer` (a registered id; enforced by `tools/test-layers`). Verified that
`nx migrate` tolerates it: its collector spreads each entry (`{...migration, package, name}`), so the key is
carried into the project's `migrations.json`; the `--local` collector carries it too. **Rungs do not guard on it
through the live registry, deliberately:** Nx calls a rung as `fn(tree, {})` — the entry is not passed — and a
rung must execute the behaviour it was written against (a project jumping 0.23 → 0.40 runs old rungs from the
newest package, so a registry import would hand an old rung *future* detection semantics). Rungs keep guarding on
their own file evidence, which is strictly more specific. `layer` is metadata for readers and tooling.
