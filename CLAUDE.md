# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`claude-toolkit` is a **Claude Code plugin marketplace** — a git repo whose product is **skills** (and, where added, subagents/commands) authored as markdown. There is no application and no root build: editing a skill *is* the work. `README.md` holds the exhaustive plugin/skill catalog and the install/upgrade story; this file is the map for **developing the toolkit itself**.

The repo is also its own **local marketplace**: `.claude-plugin/marketplace.json` lists every plugin with a **relative** `./plugins/...` source, so `claude plugin marketplace add .` loads the plugins live from the working tree. The devcontainer's `.devcontainer/post-create.sh` does exactly this on build, so your edits are live in-session (dogfooding).

## Architecture (the big picture)

**Marketplace → plugins → skills.**
- `.claude-plugin/marketplace.json` (repo root) — the registry: one entry per plugin (`name`, relative `source`, `version`).
- `plugins/<plugin>/.claude-plugin/plugin.json` — the plugin manifest (`name`, `description`, `version`).
- `plugins/<plugin>/skills/<skill>/SKILL.md` — a skill. Subagents go at `plugins/<plugin>/agents/<name>.md`, slash commands at `plugins/<plugin>/commands/<name>.md`, hooks at `plugins/<plugin>/hooks/hooks.json`.

**Hooks are the "runs without being chosen" escape hatch.** A skill only fires when Claude judges it relevant, and there is **no plugin-install/update hook event** at all — so anything that must happen *reliably* (not "if the model thinks to") needs a hook. A plugin's hooks run in the sessions of everyone who has that plugin **installed**, i.e. in the consumer's project, not here. `project-starter` uses this: a `SessionStart` hook orders the stamp in the project's `HOUSE.md` header against the installed `@bespunky/nx-tools` version and, when the toolkit has moved on, tells Claude to offer `scaffold.sh --repair`.

Three rules that hook earned the hard way, and that any new hook should keep:
- **Detect, don't execute.** It *relays a fact*; it never runs the repair (Docker, minutes, rewrites files). A hook that commands the model to act is one compliant model away from doing the thing you refused to automate — and in a headless run there is no one to consent.
- **Compare what actually drives the output** (`nx-tools`, where the generators live) — *not* the plugin version, which this repo's own convention bumps for a README typo. A notice that fires when nothing would change is a notice everyone learns to ignore.
- **A stamp is a repo fact; an install is a machine fact.** Order them, don't just diff them: "the project is ahead of this machine" is an ordinary state (a teammate who hasn't updated), and treating it as staleness would push a repair that *downgrades* the project. And keep the stamp somewhere unambiguously committed — `.claude/` is where *local* state lives, so a stamp there is one `.gitignore` line from vanishing.

**The `description` frontmatter of a SKILL.md is load-bearing** — it is the *only* text Claude sees when deciding whether to fire the skill. Writing/editing that description is designing the trigger; it matters as much as the body. Skills cross-reference each other by namespaced id `bespunky-<plugin>:<skill>` (e.g. `bespunky-engineering:architecture-first`).

**Two skill shapes:**
- **Standalone** — a single SKILL.md carries the whole thing.
- **Router / domain skills** — SKILL.md is only an *index* of technique clusters; the depth lives in sibling `reference/*.md` files loaded **on demand** (progressive disclosure). When editing these, keep SKILL.md thin (routing + when-to-use) and put substance in the reference files. Most of `engineering` and the `product-ux` visual skills (`astonishing-to-use`, `stage-the-vision`, `realize-the-vision`) follow this shape.

**The "always-on half" pattern (consumer-facing).** A skill only fires when judged relevant — insufficient for a mindset/rule that must hold on *every* change. So `engineering`'s `architect-mentality` + `architecture-first` (and `product-ux`'s `redesign-means-rethink`) are paired with **always-on directives** the scaffolder bakes into a consumer project's `CLAUDE.md`. The canonical directive text lives in `README.md` ("The always-on half") — if you change those skills' contract, update that text with it.

## `project-starter` is special — it carries the scaffolder

Most plugins are pure markdown. `project-starter` also ships an executable **scaffolder** under `skills/new-project/assets/`:
- `scaffold.sh <project> [app]` — thin launcher; **everything runs inside the `typescript-node` base image via `docker run`** (the host Node is too old for modern Nx). `--repair [--firebase] <project>` re-applies the house generators idempotently.
- `nx-tools/` — `@bespunky/nx-tools`, the **house Nx generators** (TypeScript, Nx-devkit `Tree`-based — every config change is Nx-native, never a hand-rolled file edit). This is a **payload for scaffolded projects, not this repo's own build.**
- `CLAUDE.md.tmpl` — a *thin* base CLAUDE.md the skill writes into new projects; the bulk of house guidance is a **generated, repairable `HOUSE.md`** in the consumer project (never hand-edited there).

`skills/new-project/SKILL.md` is the orchestrator and the source of truth for the scaffold sequence; the README's "How the scaffolder works" mirrors it.

## `nx-tools` payload — build & publish

The generators live as TypeScript in the toolkit. Nx can't run raw TS from `node_modules`, so distribution is a separate step:
- Compile: `assets/compile-generators.mts` (reused by the publisher).
- Publish `@bespunky/nx-tools` to npm: `tools/publish-nx-tools/publish.sh` (validate first with `--dry-run`; **bump `assets/nx-tools/package.json` version first**). Runs in Docker.

`tools/extract-tool/` is the cross-workspace half of reusable-tool extraction (`extract-tool.sh --from <project> [--lib <lib>]`), also Docker-run. Background: `docs/reusable-tool-extraction.md`.

## Release & versioning

A plugin's version lives in **two** places that must agree: `plugins/<plugin>/.claude-plugin/plugin.json` and that plugin's entry in `.claude-plugin/marketplace.json`. **Bump both together** on any change to a plugin; version bumps land as dedicated `chore(release): bump …` commits. Consumers upgrade with `git pull` → `/plugin marketplace update claude-toolkit` → `/reload-plugins`.

## Common commands

This repo has **no root package.json, build, lint, or test** — the skills are markdown. The dev loop:

| Task | How |
| --- | --- |
| Load your working-tree skills into a session | `claude plugin marketplace add .` (the devcontainer's post-create does this on build) |
| Pick up mid-session skill edits | `/reload-plugins` (or `/plugin marketplace update claude-toolkit` if added from GitHub) |
| Validate the nx-tools payload | `tools/publish-nx-tools/publish.sh --dry-run` |
| Publish nx-tools | bump `assets/nx-tools/package.json`, then `tools/publish-nx-tools/publish.sh` |
| Exercise the scaffolder | `bash plugins/project-starter/skills/new-project/assets/scaffold.sh <project> [app]` |
| Repair / retrofit a project | `… /scaffold.sh --repair [--firebase] <project>` |

## Conventions

- **Skills are the product; the frontmatter `description` is the trigger.** Invest there.
- **Router skills:** SKILL.md indexes, `reference/*.md` holds the depth — don't inline reference material back into SKILL.md.
- **Extending the scaffolder is generator work:** add or modify an `@bespunky/nx-tools` generator (Nx-devkit `Tree`) — never hand-write file edits into `scaffold.sh`. A literal `angular-*` Nx preset forces a demo app, so the scaffold path is the `apps` preset + `nx add @nx/angular` + a `--minimal` app.
- **Adding/renaming a plugin touches three catalogs in sync:** `marketplace.json`, the plugin's `plugin.json`, and `README.md`.
