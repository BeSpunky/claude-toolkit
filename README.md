# claude-toolkit

BeSpunky's **one place** for Claude Code skills, subagents, and commands. Develop them here once,
install them into any project, and upgrade everywhere with a single update.

This is a **Claude Code plugin marketplace** (a git repo). It currently ships one plugin:

| Plugin | Provides | Purpose |
| --- | --- | --- |
| `project-starter` | skill `new-project` | Scaffold a new BeSpunky-standard project: integrated Nx monorepo + Angular (clean `--minimal` app) + devcontainer (Claude CLI & VS Code extension) + tailored CLAUDE.md. |

## Layout

```
claude-toolkit/
├── .claude-plugin/marketplace.json          # lists the plugins in this marketplace
└── plugins/project-starter/
    ├── .claude-plugin/plugin.json
    └── skills/new-project/
        ├── SKILL.md                          # the scaffolding skill (orchestrator)
        └── assets/
            ├── scaffold.sh                   # thin launcher: resolve Node, docker run, bootstrap + run house generators
            ├── CLAUDE.md.tmpl                # base CLAUDE.md (generator-first guidance), authored by the skill
            └── nx-tools/                     # @bespunky/nx-tools — house Nx generators, run post-scaffold
                ├── generators.json
                └── src/generators/
                    ├── serve-options/        # sets serve host 0.0.0.0 + poll 1000
                    ├── devcontainer/         # writes .devcontainer/devcontainer.json
                    └── claude-settings/      # writes .claude/settings.json (+ .gitignore)
```

To add a skill: `plugins/<plugin>/skills/<name>/SKILL.md`.
To add a subagent: `plugins/<plugin>/agents/<name>.md`.
To add a slash command: `plugins/<plugin>/commands/<name>.md`.
Register new plugins in `.claude-plugin/marketplace.json`.

## Install

```
/plugin marketplace add BeSpunky/claude-toolkit
/plugin install project-starter@claude-toolkit
```

…or add to `~/.claude/settings.json` so every project sees it:

```json
{
  "extraKnownMarketplaces": {
    "claude-toolkit": { "source": { "source": "github", "repo": "BeSpunky/claude-toolkit" } }
  },
  "enabledPlugins": { "project-starter@claude-toolkit": true }
}
```

Skills are namespaced as `project-starter:new-project`. Scaffolded projects already get a
`.claude/settings.json` referencing this marketplace, so the toolkit's skills are available inside
every new project automatically.

## Upgrade everywhere

Every project points at the same marketplace repo, so upgrading is central:

```
git -C ~/projects/claude-toolkit pull        # or push new skills up
/plugin marketplace update claude-toolkit     # in any session
/reload-plugins                               # pick up changes mid-session
```

Enable auto-update for the marketplace (in `/plugin` → Marketplaces) to fetch updates at startup.

## How the scaffolder works

`scaffold.sh <project> [app]` is a thin launcher; everything runs **inside the base image via `docker run`** (as your uid, mounting `~/projects`) so there's no host Node/nvm dependency:
1. Resolves the newest `mcr.microsoft.com/devcontainers/typescript-node:<major>` tag (the Node source).
2. Bootstraps the workspace:
   - `yarn create nx-workspace <project> --preset=apps --packageManager=yarn --nxCloud=skip --no-interactive`
   - `yarn nx add @nx/angular`
   - `yarn nx g @nx/angular:application apps/<app> --minimal --style=scss --routing --e2eTestRunner=none`
3. Copies `@bespunky/nx-tools` into the workspace's `node_modules` and runs the **house generators** — every config change is Nx-native (devkit `Tree`), no hand-rolled file edits:
   - `nx g @bespunky/nx-tools:serve-options --project=<app>` → serve `host`/`poll`
   - `nx g @bespunky/nx-tools:devcontainer --name=<project> --nodeMajor=<major>` → `.devcontainer/devcontainer.json`
   - `nx g @bespunky/nx-tools:claude-settings` → `.claude/settings.json` (+ `.gitignore`, `.claude/data`)

The `new-project` skill then authors a tailored `CLAUDE.md` (the one piece that stays contextual, not a template).

The generated `.devcontainer/devcontainer.json` **pre-installs this marketplace on build** via its
`postCreateCommand` (`claude plugin marketplace add BeSpunky/claude-toolkit && claude plugin install
project-starter@claude-toolkit --scope project`), so the toolkit's skills/agents are live the moment the
container comes up. Declaring `enabledPlugins` in settings alone does **not** auto-install — the CLI step
is what makes it immediate inside the container; on the host, the settings declaration offers a one-click
install on first run.

> **Generator-first, manual last.** A literal `angular-*` preset always forces a demo app (verified
> against Nx source), so we use `apps` + `nx add @nx/angular` + a `--minimal` app — the only one-shot
> path to an Angular workspace with no demo content.
