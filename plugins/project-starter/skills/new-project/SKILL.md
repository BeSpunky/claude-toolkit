---
name: new-project
description: Scaffold a brand-new BeSpunky-standard project - an integrated Nx monorepo with Angular (a clean --minimal app, no demo content), a devcontainer (Claude CLI + VS Code extension), a tailored CLAUDE.md, and the bespunky/claude-toolkit marketplace wired in. Node comes from the devcontainer base image via Docker (no nvm). Use when the user asks to "start", "create", "scaffold", "bootstrap", or "spin up" a new project.
---

# Start a new project (BeSpunky standard)

Scaffold a new project into the projects root (see step 1).

## Hard requirements (do not deviate)

- **Nx-first**, created via `yarn create nx-workspace` (latest Nx, no version pinning).
- **Integrated monorepo** (`apps/` + `libs/`), via `--preset=apps` then `nx add @nx/angular`. (A literal `angular-*` preset always forces a demo app and is verified impossible to suppress; `apps` + `nx add @nx/angular` is the only one-shot Angular-ready path with no demo.)
- **Angular** wired in, with **one clean `--minimal` app** (no Nx welcome/demo content).
- **Dev server**: the app's `serve` target gets `host: 0.0.0.0` and `poll: 1000` (reachable from outside the devcontainer; reliable file-watching over WSL/Docker mounts).
- **Node from the devcontainer base image, via Docker** - never nvm. The script resolves the newest `mcr.microsoft.com/devcontainers/typescript-node:<major>` tag and uses it both to run the scaffold and as the devcontainer image (single source of truth for Node).
- **Devcontainer** with the **Claude CLI** (feature) and the **Claude VS Code extension** (`Anthropic.claude-code`), plus the `.claude` persistence mount.
- **CLAUDE.md** capturing the project's intentions.
- **bespunky/claude-toolkit** marketplace wired into the new project's `.claude/settings.json` with **`autoUpdate: true`** (toolkit refreshes at startup), AND pre-installed by the devcontainer's `postCreateCommand` (`claude plugin marketplace add` + `claude plugin install --scope project`), so the toolkit's skills/agents are live the moment the container builds - no manual install. (Declaring `enabledPlugins` alone does not auto-install; the CLI step is what makes it immediate. Note: for third-party marketplaces the guaranteed auto-update switch is the `/plugin` UI toggle / managed settings.)

## Generator-first, manual last (applies to ALL scaffolding)

For anything Nx can generate - apps, libraries, components, services, project config - **use the Nx generator (`nx g ...`); never hand-create and fill files.** Before hand-writing anything structural, check what exists: `nx list <plugin>` / `nx g <generator> --help` (or the `nx-generate` skill / the Nx MCP server). Only fall back to manual file creation when no generator covers the task. **Never guess flags** - verify against `--help` / `nx_docs`.

In this skill that means: the workspace, the Angular plugin, and the app all come from generators. The **only** hand-written files are the ones Nx genuinely doesn't own: `.devcontainer/devcontainer.json`, `.claude/settings.json`, and the tailored `CLAUDE.md`.

## 0. Gather inputs (skip any already provided)

1. **Project name** - kebab-case; becomes the project folder and the workspace name.
2. **Project intentions** - 2-4 sentences: what it's for, who uses it, the core domain. Drives CLAUDE.md.
3. **First app name** - defaults to the project name. Lives at `apps/<app-name>`.

## 1. Run the scaffold script (does the heavy lifting; Node via Docker, no nvm)

The bundled script is at **`${CLAUDE_SKILL_DIR}/assets/scaffold.sh`** (that variable resolves to wherever this skill is installed - never hardcode a path). It needs **bash + Docker** and writes into the **projects root**:

- Default: **`$HOME/projects`** (resolves to the current user's home at runtime).
- Override: export **`PROJECTS_DIR=/some/other/root`** before running (e.g. set it once in your shell profile for a permanent personal choice).

Invoke it according to the environment you're running in:

- **Windows host where Docker runs inside WSL** (this is the common BeSpunky setup): `${CLAUDE_SKILL_DIR}` is a Windows path, and Docker/the projects root live in WSL - so run the script inside WSL, converting the path with `wslpath`. Construct and run, via the Bash tool:
  ```
  wsl.exe bash -lc 'bash "$(wslpath "<CLAUDE_SKILL_DIR>")"/assets/scaffold.sh <PROJECT_NAME> [<APP_NAME>]'
  ```
  (substitute `<CLAUDE_SKILL_DIR>` with the resolved value; quote carefully).
- **Linux/macOS, or inside a devcontainer** where Docker is local: run it directly:
  ```
  bash "${CLAUDE_SKILL_DIR}/assets/scaffold.sh" <PROJECT_NAME> [<APP_NAME>]
  ```

Wait for the final `SCAFFOLD_OK <path>` line. First run pulls the base image (a few hundred MB). If a generator/CLI flag is rejected, check `yarn create nx-workspace --help` or `nx g @nx/angular:application --help` - **never guess**.

## 2. Author a tailored CLAUDE.md

Read `${CLAUDE_SKILL_DIR}/assets/CLAUDE.md.tmpl`. Use it as the base:

- Fill **Project Overview / Intentions** from the user's answer in step 0.
- Keep the **Generator-first** and **Working with Nx** guidance verbatim.
- Set the component/directive prefix to something derived from the project name.

Write the result to `<project>/CLAUDE.md`.

## 3. Report back

Tell the user:
- the absolute path of the new project and the app at `apps/<app-name>`,
- that the devcontainer ships the Claude CLI + VS Code extension, persists `.claude`, and **pre-installs the bespunky/claude-toolkit plugins on build** - so every house skill/agent is live inside the container with no setup (open via "Dev Containers: Reopen in Container"),
- that on the host (outside the container), `.claude/settings.json` already declares the marketplace, so Claude offers a one-click install on first run.

## Notes

- **Canonical source** of this skill, `scaffold.sh`, and all templates is the `claude-toolkit` repo. Edit there - never fork copies into individual projects.
- Layout is **integrated**: apps in `apps/`, libraries in `libs/`. Generate more with `nx g @nx/angular:application apps/<name> --minimal` and `nx g @nx/angular:library libs/<name>`.
- `yarn create nx-workspace` runs `git init` + an initial commit inside the container (git identity is passed through from the host).
