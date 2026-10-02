# Audit 1 — scaffolder core (2026-10-01)

Paths relative to `plugins/project-starter/skills/new-project/assets/`.

## Genuine layer dependencies (keep, scoped)
angular/design-system/navigation/firebase generators `requireLayer('angular')`; web serve generators need an Nx dev-server; js generators need `@nx/js`.

## Accidental: Nx forced under `agent`
- `registry.ts:71` `agent.requires: ['nx']` — justified (60-62) by "every generator runs through `nx g`": a dependency of the **delivery mechanism**, not the layer.
- scaffold.sh: `--ensure=agent` implies nx (480-482); sync refuses without `nx.json` (1539-1544); needs `node_modules/.bin/nx` (1553-1566); `NX_INIT_BLOCK` seeds package.json, empty lockfile, `nx init` (1305-1333); installs `@nx/devkit` into the target (1356-1360).

## Accidental: Node + package manager in the target
`detect_package_manager` defaults to yarn (208-219, 390-414); `local_node_ok` requires the project's PM (226-231); exact `@bespunky/nx-tools` devDep (713); probe reads `node_modules/@bespunky/nx-tools` (993); stray-lockfile logic every sync (1792-1815).

## Accidental: agent artifacts that assume Node/Nx
devcontainer image always `typescript-node` + `node_modules`/`.nx` volumes; post-create always `$PM_INSTALL`; claude-settings always enables `nx@nx-claude-plugins` + Nx cache gitignore; `window-identity/generator.ts:155-157` reads `package.json` unguarded.

## Accidental: Nx/monorepo prose in generated docs
`HOUSE.md.tpl:10` "Monorepo: Nx, integrated layout", Common Commands (~302-336), `HOUSE.rules.md.tpl:80` "use `nx g`", `:84` port 4200 — all ungated; "regenerated from @bespunky/nx-tools" wording; `house-doc/generator.ts:278-284` PM falls back to yarn → `yarn nx …` rendered into a Python repo. `CLAUDE.md.tmpl` assumes Angular throughout, no gating. Sync app inference hard-codes `apps/*/project.json`, falls back to `APP=$PROJECT`, reports `app=apps/$APP` even for agent-only repos (328-352, 2018).

## Is making the target an Nx workspace necessary? No.
- scaffold.sh already builds `new FsTree(process.cwd(), false)` directly (1366, 1587).
- `--local` already collects the migration ladder in plain Node (1140-1154) — `nx migrate`'s collection is duplicated already.
- Every agent-scope migration is a pure `(tree) => void` edit.
- **Toolkit-hosted runner:** install `@bespunky/nx-tools@X` + `nx` + `@nx/devkit` into a toolkit cache (`~/.cache/bespunky/nx-tools/<X>`); `run-generator.mjs` = `FsTree(target)` → `impl(tree)` → `flushChanges` → callback. Target needs no package.json/lockfile/node_modules; only host Node (Docker fallback covers it). `nx g` remains right when the target *is* Nx and the layer is Nx-native.
- Rehoming: exact pin only where the project resolves nx-tools at runtime (serve executor); ladder = in-house collector + per-rung `git commit`; probe's node_modules read becomes optional evidence, stamp is the floor; stamp already language-neutral (`<!-- @bespunky/house-tooling:stamp nx-tools=… layers=… -->`); SessionStart hook reads the plugin's own version — unaffected. Add `layer:` per migration entry.

## Layer model
Graph: nx[] · agent[nx] (accidental) · js[nx] · web[nx] · angular[nx,web] · design-system[angular] · navigation[angular] · firebase[angular] (half right). Detection all Nx-graph/package.json except agent (HOUSE.md). Angular-requires-web is debatable (component-lib-only shape).
**Closed and duplicated:** `LayerId` union (registry.ts:29-37); scaffold.sh re-encodes it in `KNOWN_LAYERS` (486), `SYNC/SCAFFOLD_ENSURABLE` (502,506), hint cases (519-539), hard-coded `if layer_active X; then nx g …` (1396-1446, 1589-1611); also house-doc flags, devcontainer `--web/--angular/--firebase`, hook `note_drift`, `--help`, `--ensure` error. Adding React/Python/Go ≈ 8 edits.
→ Layer descriptor carries its generators, ensure steps, ensurability, doc sections, devcontainer fragment; scaffold.sh asks the registry (`node runner plan --active=…`). Stack layers detectable without Nx from marker files (`pyproject.toml`, `go.mod`, `package.json`). `agent` requires `[]`.

## Scaffold path forces Nx + Angular + yarn + apps/
`ENSURE_DEFAULT="nx,agent,web,angular,design-system"` (446); INNER hard-wired `yarn create nx-workspace --preset=apps`, `nx add @nx/angular`, `nx g …:app` (1500-1509) — **not gated by `layer_active`, so `--ensure=nx,agent` on a scaffold still bootstraps Angular (latent bug)**; commit msg "Nx + Angular" (1516); `SKILL.md:17-19` "Hard requirements: Nx, integrated monorepo, Angular".
"No framework" new project: git init → ensure requested layers (agent default) via runner → house-doc gated → CLAUDE seed from house-doc → commit. Angular house shape = one preset.
