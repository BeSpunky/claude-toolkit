---
name: new-project
description: Scaffold a brand-new BeSpunky-standard project - an integrated Nx monorepo with Angular (a clean --minimal app, no demo content), a devcontainer (Claude CLI + VS Code extension), a tailored CLAUDE.md, and the bespunky/claude-toolkit marketplace wired in. Node comes from the devcontainer base image via Docker (no nvm). Use when the user asks to "start", "create", "scaffold", "bootstrap", or "spin up" a new project.
---

# Start a new project (BeSpunky standard)

Scaffold a new project into the projects root (see step 1).

## Prerequisite (do not skip)

The `project-starter@claude-toolkit` plugin must be installed and **current** in the session running this skill — otherwise this SKILL.md isn't even loaded and the procedural details below aren't in your context. If you have this skill available (you're reading this), good. If you've been asked to scaffold but this skill is **not** available in your session, ask the user to install/refresh the plugin first (`/plugin marketplace update claude-toolkit` then `/reload-plugins`), then re-trigger the scaffolding request. **Do not improvise scaffolding from memory** — every step below encodes a hard requirement and dropping any one of them produces a non-compliant project.

## Hard requirements (do not deviate)

- **Nx-first**, created via `yarn create nx-workspace` (latest Nx, no version pinning).
- **Integrated monorepo** (`apps/` + `libs/`), via `--preset=apps` then `nx add @nx/angular`. (A literal `angular-*` preset always forces a demo app and is verified impossible to suppress; `apps` + `nx add @nx/angular` is the only one-shot Angular-ready path with no demo.)
- **Angular** wired in, with **one clean `--minimal` app** (no Nx welcome/demo content).
- **Dev server reachable from outside the devcontainer**: the app's `serve` target gets `host: 0.0.0.0`. Reliable file-watching over WSL/Docker mounts is handled by `CHOKIDAR_USEPOLLING` + `CHOKIDAR_INTERVAL` env vars set on the **devcontainer** (covers any chokidar-based watcher across old and new Angular builders). Modern Angular's `@angular/build:dev-server` does **not** accept a `poll` option, which is why polling lives in the devcontainer env, not on the serve target.
- **Node from the devcontainer base image, via Docker** - never nvm. The script resolves the newest `mcr.microsoft.com/devcontainers/typescript-node:<major>` tag and uses it both to run the scaffold and as the devcontainer image (single source of truth for Node).
- **Devcontainer** with the **Claude CLI** (feature) and the **Claude VS Code extension** (`Anthropic.claude-code`), plus the `.claude` persistence mount.
- **CLAUDE.md** capturing the project's intentions, with the `engineering` plugin's always-on directives (**Architect mentality** + **Architecture-first**) verbatim and a **toolkit version stamp** at the top.
- **bespunky/claude-toolkit** marketplace wired into the new project's `.claude/settings.json` with **`autoUpdate: true`** (toolkit refreshes at startup), AND pre-installed by the devcontainer's `postCreateCommand` (`claude plugin marketplace add` + `claude plugin install --scope project`) for both `project-starter@claude-toolkit` and `engineering@claude-toolkit`, so the toolkit's skills/agents are live the moment the container builds - no manual install. (Declaring `enabledPlugins` alone does not auto-install; the CLI step is what makes it immediate. Note: for third-party marketplaces the guaranteed auto-update switch is the `/plugin` UI toggle / managed settings.)
- **Firebase support is opt-in**: when scaffolded with `--firebase`, the scaffolder wires Firebase end-to-end:
  - **Devcontainer**: adds the **Firebase CLI** (`ghcr.io/devcontainers-extra/features/firebase-cli`) + **Google Cloud CLI** (`ghcr.io/jajera/features/gcloud-cli`) features, the `toba.vsfire` VS Code extension, and emulator port-forwards (4000 UI, 9099 Auth, 8080 Firestore, 9199 Storage, 5001 Functions).
  - **Emulator config**: writes **`firebase.json`** (emulator suite + `singleProjectMode: true`) and **`.firebaserc`** (default project `demo-<workspaceName>` — Firebase's convention for emulator-only projects; works without GCP credentials).
  - **App initialization** (uses `ngDevMode`): generates **`apps/<app>/src/app/firebase.config.ts`** exporting `provideAppFirebase()`, which uses Angular's `ngDevMode` global to switch between `emulatorFirebaseConfig` and `productionFirebaseConfig` *and* to conditionally call `connectAuthEmulator` / `connectFirestoreEmulator` / `connectStorageEmulator` / `connectFunctionsEmulator`. `@angular/build` tree-shakes the dev branches out of prod bundles.
  - **App wiring**: best-effort insertion of `provideAppFirebase()` into `apps/<app>/src/app/app.config.ts`'s providers array (logs a warning if the file shape is unrecognized — you then add it manually).
  - **Nx targets** on the app: **`emulators`** (start the whole suite), **`emulators:auth` / `emulators:firestore` / `emulators:storage` / `emulators:functions`** (start one + UI), and the **`serve`** target is rewrapped as an `nx:run-commands` orchestrator that runs `emulators` + the renamed `serve-app` (the original Angular dev-server) **in parallel**. So `nx serve <app>` brings up the emulator suite + the app in one command.
  - **Deps**: the generator adds `firebase` + `@angular/fire` to `package.json` and runs the package-manager install via Nx's `installPackagesTask` (post-commit). Versions resolve to current at scaffold time; the lockfile pins after. No shell-side `yarn add`.
  - **Never enabled by default** — only when the user explicitly asks for Firebase or **you asked and they said yes**.

## Generator-first, manual last (applies to ALL scaffolding)

For anything Nx can generate - apps, libraries, components, services, project config - **use the Nx generator (`nx g ...`); never hand-create and fill files.** Before hand-writing anything structural, check what exists: `nx list <plugin>` / `nx g <generator> --help` (or the `nx-generate` skill / the Nx MCP server). Only fall back to manual file creation when no generator covers the task. **Never guess flags** - verify against `--help` / `nx_docs`.

In this skill that means: the workspace, the Angular plugin, the app, the serve options, the devcontainer, and the Claude settings all come from generators - the `@nx/*` ones plus the house `@bespunky/nx-tools` generators (`serve-options`, `devcontainer`, `claude-settings`). The **only** non-generated artifact is the tailored `CLAUDE.md`, which the skill authors from the project's intentions.

## 0. Gather inputs (skip any already provided)

1. **Project name** - kebab-case; becomes the project folder and the workspace name.
2. **Project intentions** - 2-4 sentences: what it's for, who uses it, the core domain. Drives CLAUDE.md.
3. **First app name** - defaults to the project name. Lives at `apps/<app-name>`.
4. **Firebase?** - will the project use Firebase (Firestore, Auth, Hosting, Functions, Storage)? **If the user hasn't stated it, ASK** — yes/no, one question. Default: **no**. When **yes**, pass `--firebase` to the script (step 1) so the devcontainer ships with the Firebase CLI + Google Cloud CLI features, the `toba.vsfire` extension, and the standard emulator port-forwards. Do **not** silently turn this on — it's an opt-in.

## 1. Run the scaffold script

The bundled script is at **`${CLAUDE_SKILL_DIR}/assets/scaffold.sh`** (that variable resolves to wherever this skill is installed - never hardcode a path). It performs three phases inside the devcontainer base image (via Docker, no nvm). **Run the whole script** - do not replicate its steps by hand; the phases together are the project's hard requirements:

- **1.1 Bootstrap Nx + Angular + the app**: `yarn create nx-workspace … --preset=apps` → `nx add @nx/angular` → `nx g @nx/angular:application apps/<APP> --minimal --style=scss --routing --e2eTestRunner=none`.
- **1.2 Install the house plugin (`@bespunky/nx-tools`)** into the workspace's `node_modules` and compile its TypeScript generators to JS (so Nx can load them from `node_modules`).
- **1.3 Run the house generators** (Nx-native via devkit `Tree`, format-aware, **all idempotent**):
  - `nx g @bespunky/nx-tools:serve-options --project=<APP>` → sets `serve.options.host = "0.0.0.0"`.
  - `nx g @bespunky/nx-tools:devcontainer --name=<PROJECT> --nodeMajor=<MAJOR>` `[--firebase=true]` → writes `.devcontainer/devcontainer.json` (Claude CLI feature, VS Code extension, `.claude` persistence mount, polling env vars, `postCreateCommand` pre-installing the toolkit plugins; with `--firebase=true` adds the firebase-cli + gcloud-cli features, `toba.vsfire`, and emulator port-forwards).
  - `nx g @bespunky/nx-tools:claude-settings` → writes `.claude/settings.json` (marketplaces + `autoUpdate: true` + `enabledPlugins`) and keeps `.claude/data` out of git.
  - **Only with `--firebase`:** `nx g @bespunky/nx-tools:firebase-emulators --project=<APP> --workspaceName=<PROJECT>` → writes `firebase.json` + `.firebaserc`, generates `apps/<APP>/src/app/firebase.config.ts` (the `provideAppFirebase()` factory using `ngDevMode`), wires `app.config.ts`, adds the `emulators` / `emulators:<svc>` Nx targets while wrapping `serve` to orchestrate emulators + `serve-app` in parallel, AND adds `firebase` + `@angular/fire` to `package.json` (the generator's post-commit `installPackagesTask` runs the install). No shell-side `yarn add`.

Projects root:
- Default: **`$HOME/projects`** (resolves to the current user's home at runtime).
- Override: export **`PROJECTS_DIR=/some/other/root`** before running.

Invoke it according to the environment you're running in:

- **Windows host where Docker runs inside WSL** (the common BeSpunky setup): `${CLAUDE_SKILL_DIR}` is a Windows path, and Docker/the projects root live in WSL - so run the script inside WSL, converting the path with `wslpath`:
  ```
  wsl.exe bash -lc 'bash "$(wslpath "<CLAUDE_SKILL_DIR>")"/assets/scaffold.sh [--firebase] <PROJECT_NAME> [<APP_NAME>]'
  ```
- **Linux/macOS, or inside a devcontainer** where Docker is local:
  ```
  bash "${CLAUDE_SKILL_DIR}/assets/scaffold.sh" [--firebase] <PROJECT_NAME> [<APP_NAME>]
  ```

Include `--firebase` **only** if step 0 input 4 was yes (the user opted in). Omit it otherwise.

Wait for the final `SCAFFOLD_OK <path>` line. First run pulls the base image (a few hundred MB). If a generator/CLI flag is rejected, check `yarn create nx-workspace --help` or `nx g @nx/angular:application --help` - **never guess**.

### 1a. Recovery (if the script can't complete end-to-end)

If `scaffold.sh` fails partway, **do not improvise the remaining phases by hand** - the house generators encode hard requirements that are easy to miss. Use the script's **repair mode**, which re-runs **only** phases 1.2 and 1.3 on the existing project (all generators are idempotent):

```
bash "${CLAUDE_SKILL_DIR}/assets/scaffold.sh" --repair [--firebase] <PROJECT_PATH_OR_NAME> [<APP_NAME>]
```

(Through WSL on Windows hosts, wrap as in step 1.) `--firebase` and `--repair` may be combined to retrofit Firebase support onto an existing project. If repair errors with "node_modules/.bin/nx not found," run `yarn install` in the project first, then re-run.

## 2. Author a tailored CLAUDE.md

Read `${CLAUDE_SKILL_DIR}/assets/CLAUDE.md.tmpl`. Use it as the base:

- Fill **Project Overview / Intentions** from the user's answer in step 0.
- Keep the **Architect mentality**, **Architecture-first (non-negotiable)**, **Generator-first**, and **Working with Nx** sections verbatim - the architect-mentality and architecture-first directives are the always-on half of the `engineering` plugin and must not be softened or dropped.
- Set the component/directive prefix to something derived from the project name.
- Fill **`{{TOOLKIT_STAMP}}`** with a stamp identifying the toolkit version that scaffolded this project. Read `cat "${CLAUDE_SKILL_DIR}/.claude-plugin/plugin.json"` for the `version`, and if the toolkit is a git checkout, append the short SHA (`git -C "${CLAUDE_SKILL_DIR}" rev-parse --short HEAD 2>/dev/null`). Example: `0.1.0 (git ae5cf49)`. If neither is available, write `unknown`.

Write the result to `<project>/CLAUDE.md`.

## 3. Verify (do not skip)

Before reporting back, confirm each item. **If any check fails, fix it by running `scaffold.sh --repair` (or the matching generator directly) BEFORE step 4** - never report a partial scaffold.

| Check | Where | Fix |
| --- | --- | --- |
| App's `serve` target has `options.host == "0.0.0.0"` | `apps/<APP>/project.json` | `--repair` (or `nx g @bespunky/nx-tools:serve-options --project=<APP>`) |
| `.devcontainer/devcontainer.json` exists with: Claude CLI feature, `remoteEnv` polling vars (`CHOKIDAR_USEPOLLING`/`CHOKIDAR_INTERVAL`), and a `postCreateCommand` pre-installing **both** `project-starter@claude-toolkit` and `engineering@claude-toolkit` | `<project>/.devcontainer/devcontainer.json` | `--repair` |
| **If `--firebase` was used:** devcontainer has the `firebase-cli` + `gcloud-cli` features, `toba.vsfire` in extensions, and `forwardPorts` `[4000, 9099, 8080, 9199, 5001]`. **If not used:** devcontainer has **none** of these | `<project>/.devcontainer/devcontainer.json` | `--repair --firebase` (to add) or `--repair` (to remove) |
| **If `--firebase` was used:** `firebase.json` (emulators block w/ singleProjectMode) and `.firebaserc` (default `demo-<workspaceName>`) exist at workspace root | `<project>/firebase.json`, `<project>/.firebaserc` | `--repair --firebase` |
| **If `--firebase` was used:** `apps/<APP>/src/app/firebase.config.ts` exists and exports `provideAppFirebase()` using `ngDevMode`; `apps/<APP>/src/app/app.config.ts` includes `provideAppFirebase()` in its providers (if missing, add it — the generator logs a warning when it cannot auto-wire) | `<project>/apps/<APP>/src/app/firebase.config.ts`, `app.config.ts` | `--repair --firebase`; manual edit to `app.config.ts` if the warning fired |
| **If `--firebase` was used:** the app's `project.json` has `serve` as an `nx:run-commands` orchestrator (parallel: `emulators` + `serve-app`), the original Angular dev-server preserved as `serve-app`, and targets `emulators` + `emulators:auth` / `:firestore` / `:storage` / `:functions` | `<project>/apps/<APP>/project.json` | `--repair --firebase` |
| **If `--firebase` was used:** `firebase` and `@angular/fire` are present in `package.json` (and installed in `node_modules`) | `<project>/package.json` | `--repair --firebase` re-runs the generator (which updates `package.json` + triggers Nx's `installPackagesTask`) |
| `.claude/settings.json` declares the `claude-toolkit` marketplace with `"autoUpdate": true` and enables `project-starter@claude-toolkit` + `engineering@claude-toolkit` | `<project>/.claude/settings.json` | `--repair` |
| `CLAUDE.md` carries the **Architect mentality** + **Architecture-first** + **Generator-first** sections verbatim, with the scaffolder stamp populated at the top | `<project>/CLAUDE.md` | re-author per step 2 |

## 4. Report back

Tell the user:
- the absolute path of the new project and the app at `apps/<app-name>`,
- that the devcontainer ships the Claude CLI + VS Code extension, persists `.claude`, and **pre-installs the bespunky/claude-toolkit plugins on build** - so every house skill/agent is live inside the container with no setup (open via "Dev Containers: Reopen in Container"),
- that on the host (outside the container), `.claude/settings.json` already declares the marketplace, so Claude offers a one-click install on first run.

## Notes

- **Canonical source** of this skill, `scaffold.sh`, and all templates is the `claude-toolkit` repo. Edit there - never fork copies into individual projects.
- **Repair an existing project** with `scaffold.sh --repair <project-path-or-name> [<app-name>]` to re-apply the three house generators (idempotent).
- Layout is **integrated**: apps in `apps/`, libraries in `libs/`. Generate more with `nx g @nx/angular:application apps/<name> --minimal` and `nx g @nx/angular:library libs/<name>`.
- `yarn create nx-workspace` runs `git init` + an initial commit inside the container (git identity is passed through from the host).

### Recipe: add Firebase to an existing project

If a project was scaffolded **without** `--firebase` and you now need it, use repair mode + the flag — **never hand-create the artifacts**, always go through the generator (this is the BeSpunky way: *generator-first, manual last*):

```
bash "${CLAUDE_SKILL_DIR}/assets/scaffold.sh" --repair --firebase <PROJECT_PATH_OR_NAME> [<APP_NAME>]
```

(Wrap with `wsl.exe bash -lc '…'` on Windows hosts, as in step 1.) This re-runs the four house generators idempotently on the existing project; the `firebase-emulators` generator writes `firebase.json` + `.firebaserc`, generates `apps/<APP>/src/app/firebase.config.ts` (only if absent — your edits are preserved), best-effort-wires `app.config.ts`, adds the `emulators` / `emulators:<svc>` Nx targets, wraps `serve` to orchestrate `emulators` + `serve-app` in parallel, and updates `package.json` (the post-commit `installPackagesTask` runs install). The `devcontainer` generator simultaneously adds the Firebase CLI + Google Cloud CLI features, the `toba.vsfire` extension, and the emulator port-forwards. **Rebuild the devcontainer** afterwards (VS Code → *Dev Containers: Rebuild Container*) to materialize the new features.

After the retrofit, run step 3 (Verify) against the project — every check that mentions "if `--firebase` was used" must pass. If `app.config.ts` couldn't be auto-wired, the generator logged a warning; add `provideAppFirebase()` to its providers array by hand.
