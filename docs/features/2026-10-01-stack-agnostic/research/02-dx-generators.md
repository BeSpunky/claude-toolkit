# Audit 2 — stack-agnostic DX generators (2026-10-01)

Paths relative to `plugins/project-starter/skills/new-project/assets/`.

## Cross-cutting
- No DX generator calls `requireLayer`; gating lives only in `scaffold.sh` (`layer_active agent` ~1396, `web` 1427/1589).
- `agent` requires `nx` (registry.ts:71); `nx` requires root `package.json` + `nx init` (63-66) → "house DX on any repo" installs Node+Nx into a Python/Go repo. Real split: **generator runtime** (devkit, needs Node on the machine) vs **project stack**. Run generators on an FsTree from a temp/global install; `agent` requires nothing.
- **Bug:** `shared-browser/project.json.tpl` and `worktree-domains/project.json.tpl` declare `projectType: "library"`; `js` detects on `hasProjectOfType('library')` (registry.ts:86) → every web workspace reports `js` present.
- `web` detected only via Nx targets (registry.ts:97).

## devcontainer (agent; Node-shaped content)
- Image `typescript-node:{{nodeMajor}}` unconditional (tpl:10), `remoteUser: node`, `/home/node` hard-coded in post-create (60,173,333).
- Unflagged Node/Nx: eslint/prettier extensions (tpl:51-58), TS settings, `node_modules/.bin` PATH (195), CHOKIDAR (199-202), `node_modules`+`.nx` volumes (214-215).
- Port 4200 labelled for `angular || firebase` (generator.ts:574-580); Firebase ports inline (583-591).
- post-create is static, sniffs at runtime: always runs a package-manager install, defaulting to `yarn install` with no package.json (33-46, 89-90); web OS floor (xvfb, novnc…) + Playwright Chromium on **every** container (246-351); hard-coded plugin pre-install list incl. design-system (117-124).
- Adopted devcontainers get node_modules/.nx mounts + PATH merged in additively — stack-specific additions to a non-Node repo.
- → **Layer fragments**: each layer contributes `{features, extensions, settings, mounts, remoteEnv, ports, postCreate, osPackages}`; image from a stack fragment (no js/node → `devcontainers/base`, Node as a feature contributed by whoever needs it).

## claude-settings (agent; mostly fine)
- Hard-codes nx marketplace/plugin (tpl:3-8,18), design-system plugin (25); `.nx/cache` gitignore (generator.ts:54).
- Drift: `bespunky-communication` enabled in settings but missing from post-create pre-install list. → `enabledPlugins` as per-layer contributions, one source for both.

## window-identity — agnostic; name seed from root `package.json` (154-156) needs dir/git-remote fallback.

## playwright — wrong layer: just adds `@playwright/test@latest` to root package.json. Belongs to `js`; shared browser should own a self-contained runtime.

## shared-browser (web) — no Angular coupling; needs `node`, resolves `playwright` from workspace root node_modules (427-431, 716-721). Bash CLI is the real contract; emit `project.json` only with `nx`.

## worktree-domains (web) — `register/unregister/reconcile` + `proxy.mjs` already stack-free; hidden dep on `tools/shared-browser/port-claim.mjs` (155).

## serve / serve-options / serve executor — where the coupling actually is
- serve generator: Angular leaf default (`@angular/build:dev-server`, :19,53-63), injects `buildTarget` (71-80), writes Angular tab label into `app.config.ts` (82-112).
- executor: `BASE_APP_PORT = 4200` and offset step 6000 sized for Firebase (`port-offset.ts`); assumes `--port`/`--buildTarget` flags; Firebase baked in (`firebase.json` sniff, `nx run firebase:emulators`, `?portOffset`/`?emulate=none`, OAuth-origin advice); runs `node_modules/.bin/nx`; guesses yarn/npm/pnpm install.
- **Stack-free but trapped in an Nx executor:** worktree selection, slug, offset hashing, port probe, domain registration, browser nav, multi-child shutdown.

## wiki-summary — no layer, not DX; belongs with `js`/publishable-lib.

## Proposed seam — a dev-process contract
1. **Declaration (committed data)**: per app, a list of processes `{id, cmd, ports:{name:base}, primary, ready}` + an `install` command; ports substituted `${PORT:name}`.
2. **Engine (stack-free CLI)** `dev serve [app] [--worktree] [--offset]`: reads it, derives the offset block from declared ports, spawns, registers domain, drives browser.
3. **Adapters contribute fragments**: angular (dev-server cmd, 4200, tab label), firebase (emulators process, ports, URL decorator, OAuth advice), nx (`nx serve` becomes a thin wrapper, owns NX_DAEMON env), vite/python/go (declaration only).
4. `web` detects "declaration exists or Nx dev-server target", requires only `agent`.
