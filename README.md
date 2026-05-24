# claude-toolkit

BeSpunky's **one place** for Claude Code skills, subagents, and commands. Develop them here once,
install them into any project, and upgrade everywhere with a single update.

This is a **Claude Code plugin marketplace** (a git repo). It currently ships two plugins:

| Plugin | Provides | Purpose |
| --- | --- | --- |
| `project-starter` | skill `new-project` | Scaffold a new BeSpunky-standard project: integrated Nx monorepo + Angular (clean `--minimal` app) + devcontainer (Claude CLI & VS Code extension) + tailored CLAUDE.md. |
| `engineering` | skills `architect-mentality` + `architecture-first` (more to come: advanced TypeScript, Angular architecture, Nx, general software dev) | **`architect-mentality`** — the stack-agnostic mindset of a great architect (mentality only, no techniques): everything is a black box with deliberate connections, model the missing concept instead of patching, refuse false tradeoffs, go the extra mile, and more. **`architecture-first`** — the operational discipline that enforces it: solve every feature/bug/change through design and infrastructure, **never a patch**; fix bugs at the **root cause**; **design + confirm refactors before implementing**. Ships an always-on policy the scaffold bakes into every project's CLAUDE.md. |

## Layout

```
claude-toolkit/
├── .claude-plugin/marketplace.json          # lists the plugins in this marketplace
├── plugins/engineering/
│   ├── .claude-plugin/plugin.json
│   └── skills/
│       ├── architect-mentality/
│       │   └── SKILL.md                      # the architect mindset (mentality only, stack-agnostic): 13 principles
│       └── architecture-first/
│           └── SKILL.md                      # architecture-first discipline (loop, root-cause + refactor gates, patch smells, redesign moves)
└── plugins/project-starter/
    ├── .claude-plugin/plugin.json
    └── skills/new-project/
        ├── SKILL.md                          # the scaffolding skill (orchestrator)
        └── assets/
            ├── scaffold.sh                   # thin launcher: resolve Node, docker run, bootstrap + run house generators
            ├── CLAUDE.md.tmpl                # base CLAUDE.md (architecture-first + generator-first guidance), authored by the skill
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
/plugin install engineering@claude-toolkit
```

…or add to `~/.claude/settings.json` so every project sees it:

```json
{
  "extraKnownMarketplaces": {
    "claude-toolkit": { "source": { "source": "github", "repo": "BeSpunky/claude-toolkit" } }
  },
  "enabledPlugins": {
    "project-starter@claude-toolkit": true,
    "engineering@claude-toolkit": true
  }
}
```

Skills are namespaced as `project-starter:new-project`, `engineering:architect-mentality`, and `engineering:architecture-first`. Scaffolded
projects already get a `.claude/settings.json` referencing this marketplace, so the toolkit's skills are
available inside every new project automatically.

## The always-on half

Installing the `engineering` plugin makes the `architect-mentality` and `architecture-first` skills
available — but a skill only fires when the model judges it relevant, which isn't enough for a mindset and
a rule that must hold on **every** change. So the policy has two halves:

1. **Always-on directives in `CLAUDE.md`** — loaded into context every session, so the mindset and the rule are never out of mind.
2. **The `engineering` skills** — the depth: `architect-mentality` (the full architect mindset) and `architecture-first` (the loop, the patch smells to refuse, the redesign moves).

**New projects** get half (1) automatically — the `new-project` scaffold bakes both directives into the
generated `CLAUDE.md` and enables both plugins. **Existing projects** that install the plugin should paste
the canonical directives below into their `CLAUDE.md` so the mindset and rule are always in context:

```markdown
## Architect mentality

Approach every decision — at any scale, from a single function to the whole workspace — as a software architect. Treat **everything as a black box**: a clear boundary, a small deliberate public contract, hidden internals, dependencies received from the outside, and connections to other black boxes only through well-defined, intentionally-directed connection types (dependency injection, parent–child, layered/domain-driven dependency rules). Never reach across a boundary into another box's internals. Model the missing **concept** instead of working around gaps; concentrate complexity so the edges stay simple; refuse false tradeoffs; keep abstractions empowering and honest; design for the next consumer; lead with *why* and one consistent mental model; and **go the extra mile — always** (find or invent the elegant solution; never settle for the easy-but-complex; *easy ≠ simple*). Be lazy about repetition, relentless about design quality.

For the full mindset, think with the **`engineering:architect-mentality`** skill. It is the *why*; the rule below is the *operational discipline* that enforces it.

## Architecture-first (non-negotiable)

Every change — feature, bug, edge case, or "quick fix" — is solved through **design and infrastructure, never a patch.** No special-case `if`s keyed on one input/customer/env, no magic values, no copy-paste, no boolean flags to make one unit do two things, no casts to silence a type mismatch, no bumped timeouts to mask a structural problem. **For bugs, find and fix the root cause — never mask the symptom** (no swallowed errors, defaulted bad data, or guards bolted on at the symptom site). When the current design does not account for a requirement, **redesign and refactor** the relevant seam (model the missing concept, extract, decouple, build the missing abstraction, reuse) so the new behavior is a natural case of the design — don't bolt it on. Coupling, duplication, and special-casing must never grow. **If a refactor is needed to lay infrastructure for a feature or to fix a bug, design it first, get confirmation, and only then implement** — never refactor ad hoc mid-edit; if a correct redesign is genuinely large, surface it and its cost rather than patching silently.

For any non-trivial change, invoke the **`engineering:architecture-first`** skill before writing code — it carries the full loop, the bug root-cause and refactor gates, the patch smells to refuse, and the redesign moves.
```

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
project-starter@claude-toolkit --scope project && claude plugin install engineering@claude-toolkit
--scope project`), so the toolkit's skills/agents are live the moment the container comes up. Declaring `enabledPlugins` in settings alone does **not** auto-install — the CLI step
is what makes it immediate inside the container; on the host, the settings declaration offers a one-click
install on first run.

> **Generator-first, manual last.** A literal `angular-*` preset always forces a demo app (verified
> against Nx source), so we use `apps` + `nx add @nx/angular` + a `--minimal` app — the only one-shot
> path to an Angular workspace with no demo content.
