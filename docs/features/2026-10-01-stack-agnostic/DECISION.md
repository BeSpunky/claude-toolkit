# Stack-agnostic toolkit — design (PROPOSED, awaiting confirmation)

Evidence: `research/01..04`. Brief: `BRIEF.md`.

## What the audit found
The layer model is the right idea, but three things defeat it:

1. **The delivery mechanism is mistaken for a layer.** `agent` requires `nx` only because the generators are invoked through `nx g`. So "house DX on any repo" today means `nx init` + `package.json` + lockfile + `node_modules` written into a Python or Go repo, and the sync refuses anything without `nx.json`. Yet the scaffolder already runs generators on a bare `FsTree`, and `--local` already collects the migration ladder without `nx migrate` — Nx-as-runtime is not load-bearing.
2. **The layer list is closed and copied ~8 times** (registry `LayerId` union, `KNOWN_LAYERS`, `*_ENSURABLE`, hint cases, hard-coded `if layer_active X; then nx g …` blocks, devcontainer flags, house-doc flags, the hook's drift greps). A new stack is an edit in eight places, not a natural case.
3. **Stack-neutral capabilities are welded to Angular.** Firebase (`requires: angular`, but only the client wiring is Angular), the design system (tokens + SASS API are neutral; only `src/lib/*.ts` is Angular), the worktree serve engine (port offsets, `<slug>.localhost`, browser, multi-process shutdown — all stack-free, trapped in an Nx executor hard-coded to 4200 + Firebase), the devcontainer (always `typescript-node`, always `$PM_INSTALL` defaulting to yarn, web OS floor on every container), the house docs (`nx g`, 4200, "Monorepo: Nx" ungated), and several skills (design-system, typed-reactive-navigation, playwright, shared-browser, local-server-isolation, branch-and-release).

## The concepts that were missing
- **Runtime ≠ stack.** The generators need *Node on the machine running them*, never Nx/Node *in the project*. A **toolkit-hosted runner** installs `@bespunky/nx-tools@X` (+ devkit) into a toolkit cache and runs `FsTree(target) → generator → flushChanges`. Same runner executes the **migration ladder** (in-house collector, already exists for `--local`; per-rung commit). The **HOUSE.md stamp** becomes the sole version record for non-Node projects; the exact devDependency pin stays only where the project itself executes nx-tools code at runtime (the Nx `serve` executor).
- **An open layer registry as the single source of truth.** Each layer is a descriptor: `requires`, `detect`, ensurability, ensure steps, the generators it runs (workspace / per-app), its devcontainer fragment, its doc sections, the Claude plugins it enables, its migration scope. `scaffold.sh` asks the registry (`runner plan --active=…`) instead of re-encoding it; the SessionStart hook shares its detectors.
- **Two kinds of layer: stacks and capabilities.** A **stack adapter** (`node`, `nx`, `angular`; later `react-vite`, `python`, `go`) knows how to detect itself, own a project, create an app/lib, describe a dev server, write env config, wire providers, attach styles. A **capability** (`agent`, `web`, `firebase`, `design-tokens`, `navigation`) does its framework-neutral part itself and attaches to an app *through the adapter's ports*; a missing port is reported, never a crash. `app` becomes `adapter.createApp` + `attach` for every present capability — no hard-coded composition list.
- **A dev-process contract.** Per app, committed data: processes `{id, cmd, ports:{name:base}, primary, ready}` + install command. A stack-free `dev serve [app] [--worktree]` engine (extracted from the executor) reads it, derives the offset block from the declared ports, spawns, registers the domain, drives the browser. Angular / Firebase / Nx contribute fragments; `nx serve` becomes a thin wrapper so existing projects keep working. `web` then needs only `agent`.

Re-cut graph: `agent[]` · `node[]` (package.json) · `nx[node]` · `js[nx]` · `web[agent]` · `angular[nx]` · `firebase[]` (+ client adapter per stack) · `design-tokens[]` (+ adapter) · `navigation[angular]`.

## Phases (each shippable on its own)
0. **Bug fixes found on the way** — `0.24.0/unify-serve-targets` step 3b strips `host` from *any* `serve` target; shared-browser / worktree-domains declare `projectType: library` and so falsely switch on `js`; scaffold's Angular bootstrap ignores `--ensure`; README claims non-web repos aren't told about 4200 (they are); `--portOffset` vs `--port-offset` drift; `bespunky-communication` missing from the post-create plugin list; dead `serve-and-share` reference; `window-identity` reads `package.json` unguarded.
1. **Nx-free core** — toolkit-hosted runner, in-house migration ladder with per-rung `layer`, stamp as floor, `agent` requires nothing, open registry driving `scaffold.sh` + the hook. *This is what lets `/sync` fix any repo.*
2. **Agnostic agent artifacts** — devcontainer assembled from layer fragments (image per stack; base Debian when no stack; web OS floor only with `web`; one plugin list shared with claude-settings); house-doc gated on `nx`/`js`/`web` with generic cores; layer-gated CLAUDE seed replaces the Angular `CLAUDE.md.tmpl`.
3. **Dev-process contract** — engine extraction, declaration, adapters; migration writes the declaration for existing serve targets.
4. **Capability/adapter split** — firebase core + Angular client adapter; design-tokens core + Angular adapter; navigation by tag + `resolveLibsDir`; publishable-lib's `--nonAngular` boolean → adapter delegate; one `ownsProject` instead of three `isAngularApp`s.
5. **Skills** — generic cores with stack adapter references (design-system ×2, typed-reactive-navigation, branch-and-release, local-server-isolation, shared-browser, playwright, realize-the-vision); skills read the active layers from the HOUSE.md stamp. Angular-only skills move to an optional plugin (see open decision).
6. **Scaffold = sync with an ensure set, for real** — new project defaults to `agent`; today's house shape becomes a named preset (Nx + Angular + design system [+ Firebase]); new-project SKILL's "hard requirements" become per-layer.

Every phase touching project shapes ships its migrations + fixture cases with the payload bump. Existing Nx/Angular projects keep their Nx — nothing is removed from them; they simply stop being the only shape.

## Open decisions
- Approve the direction and phase order.
- Repackage Angular-only skills (`angular-architecture`, `angular-native-wrappers`, Angular references) into an optional `bespunky-angular` plugin (and Nx ones into `bespunky-nx`)? Consumers who rely on them would need to install the new plugin.
- Rename the stamp key `nx-tools=` → a neutral `house=`? (needs a migration-aware read of both.)
