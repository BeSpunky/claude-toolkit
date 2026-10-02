---
status: concluded
concluded: 2026-10-02
summary: The toolkit fits any project — Nx is the always-ensured floor (wrapper host when there is no package.json); Angular, Firebase, design system, navigation and the dev loop are optional layers from an open per-file registry, attached through stack adapters; worktree serving runs from .bespunky/dev.json; Angular skills moved to the optional bespunky-angular plugin. Shipped as nx-tools 0.36.2.
tags: [scaffolder, layers, nx-wrapper, adapters, dev-engine, firebase, design-system, angular, presets, nx-tools-0.36.2, migration]
---

# Stack-agnostic toolkit — design

## Revision 1 — 2026-10-01: Nx stays the floor
> "Let's keep Nx as a base assumption. If it's not there, we require/install/init it" — the user

Asked first whether Nx supports Go/Python (it does: language-agnostic task core; official Gradle/Maven/.NET plugins; community Go/Python/Rust plugins; `nx init` can install via the `.nx/installation` wrapper with no root `package.json`).

This **supersedes the "Runtime ≠ stack" concept below**: no toolkit-hosted runner, no in-house migration ladder — `nx g` and native `nx migrate` stay. What changes instead:
- **Nx is the always-ensured floor.** A sync on a repo without `nx.json` inits Nx rather than refusing; every layer *above* the floor stays opt-in (`--ensure`). This amends "a sync ensures nothing by default" to "a sync ensures nothing *above the Nx floor*".
- **Nx ≠ Node project.** Open for phase 1: in a non-JS repo, prefer the Nx wrapper (`.nx/installation`) over seeding a root `package.json` + lockfile, if `@bespunky/nx-tools`' exact pin, the probe, and `nx migrate` all work through it — to be verified, not assumed.
- Phase 1 therefore becomes: **Nx floor auto-init + open layer registry as the single source of truth** (scaffold.sh, hook, house-doc flags all read it). Everything else — the capability/adapter split, the dev-process contract, devcontainer fragments, gated docs, skills — stands, now on an Nx floor. The `node` layer in the re-cut graph is no longer a prerequisite of `nx`; it means "this project is a JS/TS project".

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

## Revision 2 — 2026-10-01: go-ahead, and the open decisions settled
> "implement all phases to completion and verify different scenarios work on throwaway repos." — the user (`/goal`)

Settled by the orchestrator under that mandate (no further question asked; each is reversible):
- **Angular-only skills move to a new optional plugin `bespunky-angular`** (`angular-architecture`, `angular-native-wrappers`, plus Angular adapter references split out of generic skills where they are whole files). It is "something to wear" in the user's words; the `claude-settings` generator enables it per layer (`angular` → `bespunky-angular`), so a sync re-equips existing Angular consumers. `nx-monorepo-and-dx` stays in `bespunky-engineering` — Nx is the floor now.
- **Stamp key stays `nx-tools=`.** Nx is the floor and the package is still `@bespunky/nx-tools`; a rename would buy nothing but a migration.
- **One payload release for the whole effort: `0.35.0`.** Every migration this effort owes registers at `0.35.0`.
- **Contract names fixed up front** so parallel units agree: dev declaration `.bespunky/dev.json`; stack-free engine `tools/dev/dev serve [app] [--worktree=<x>] [--port-offset=<n|auto>] [--dry-run]`; `nx serve <app>` stays as a thin wrapper over it; flags are kebab-case everywhere.

## Revision 3 — 2026-10-01: payload ships as 0.36.0
The phase-1 unit bumped the payload to 0.35.0 at its start; the release-invariants check counts the commit that set a version as its release, so every later payload change read as "changed since 0.35.0 was released". 0.35.0 was never published (CI publishes from `main` only). The release is therefore **0.36.0**, set after the last payload change; the effort's rungs stay at 0.35.0 — still inside every existing project's `from..to` range, and the migrations ceiling holds. Plugin bumps: project-starter 0.36.0, workflow 0.8.0, engineering 0.6.0 (Angular skills moved out), design-system 0.2.0, browser-automation 0.4.0 (minor); product-ux 0.11.6 (patch); bespunky-angular 0.1.0 (new).

## State at end of implementation — 2026-10-01
All phases 0–6 implemented, released on the branch (payload 0.36.1 — 0.35.0/0.36.0 were in-branch versions, never published) and verified on throwaway repos: fresh agent-only / angular+firebase / node scaffolds; sync onto Python, Go-with-own-devcontainer and plain-npm repos; an old 0.34 Angular+Firebase+DS project migrated; Firebase without Angular; refusal paths (research/05-verification.md). Unverifiable here: a real container build, real Firebase emulators.

## Pre-merge review — 2026-10-02
> "Send agents to sanity check, review and critic. Fix anything that comes up, then rebase, retest and merge" — the user

Five adversarial reviewers (migrations, architecture, shell/runtime, docs, clean-clone sanity) → research/06-review-*.md; two fixers → research/07-fixes-*.md. Everything confirmed was fixed with regression tests (incl. pre-existing defects in sync's refusal/recovery paths: the backup tag is gone — a clean HEAD is the restore point, recovery is `git restore`, never `reset --hard`). The second fixer was stopped mid-docs by the user; the orchestrator finished its docs pass. Released as nx-tools **0.36.2** (0.35.0–0.36.1 were in-branch, never published).

**Deferred, deliberately (design, nothing fails today):** `web` ensurable `via` a single stack (A3); one devcontainer image, last layer wins — matters once a second image-owning stack (e.g. Python) exists (A4); per-layer parameters live on `PlanContext` (A8); `--local` checkpoint commits carry the `file:` spec (dev-testing only); a rung importing a live util (pre-existing pattern). Unverifiable here: a real devcontainer build, real Firebase emulators.
