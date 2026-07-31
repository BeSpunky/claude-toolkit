# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- @bespunky/house-tooling:start (generated pointer — do not edit between these markers; `scaffold.sh --sync` regenerates it) -->
## House rules & tooling

The house **directives** that govern every change in this project — architect mentality, **architecture-first**, the **branch & release rules**, and **a feature is a package** — are imported on the line below, so they are **always in context**. They are **mandatory, not optional reference.**

@HOUSE.rules.md

The **mechanical how-to** — the stack · generators · Nx — lives in **[`HOUSE.md`](HOUSE.md)**. **Read it before you branch, or reach for a house command.**

Both files are **generator-owned**, regenerated on every `scaffold.sh --sync` to match the installed `@bespunky/nx-tools`. **Never hand-edit them** — this project's own guidance goes below, outside these markers.
<!-- @bespunky/house-tooling:end -->

## What this repo is

`claude-toolkit` is a **Claude Code plugin marketplace** — a git repo whose product is **skills** (and, where added, subagents/commands) authored as markdown. There is no application and no root build: editing a skill *is* the work. `README.md` holds the exhaustive plugin/skill catalog and the install/upgrade story; this file is the map for **developing the toolkit itself**.

The repo is also its own **local marketplace**: `.claude-plugin/marketplace.json` lists every plugin with a **relative** `./plugins/...` source, so `claude plugin marketplace add .` loads the plugins live from the working tree. The devcontainer's `.devcontainer/post-create.sh` does exactly this on build, so your edits are live in-session (dogfooding).

## Architecture (the big picture)

**Marketplace → plugins → skills.**
- `.claude-plugin/marketplace.json` (repo root) — the registry: one entry per plugin (`name`, relative `source`, `version`).
- `plugins/<plugin>/.claude-plugin/plugin.json` — the plugin manifest (`name`, `description`, `version`).
- `plugins/<plugin>/skills/<skill>/SKILL.md` — a skill. Subagents go at `plugins/<plugin>/agents/<name>.md`, slash commands at `plugins/<plugin>/commands/<name>.md`, hooks at `plugins/<plugin>/hooks/hooks.json`.

**Hooks are the "runs without being chosen" escape hatch.** A skill only fires when Claude judges it relevant, and there is **no plugin-install/update hook event** at all — so anything that must happen *reliably* (not "if the model thinks to") needs a hook. A plugin's hooks run in the sessions of everyone who has that plugin **installed**, i.e. in the consumer's project, not here. `project-starter` uses this: a `SessionStart` hook orders the stamp in the project's `HOUSE.md` header against the installed `@bespunky/nx-tools` version and, when the toolkit has moved on, tells Claude to offer `scaffold.sh --sync`.

Three rules that hook earned the hard way, and that any new hook should keep:
- **Detect, don't execute.** It *relays a fact*; it never runs the sync (Docker, minutes, rewrites files). A hook that commands the model to act is one compliant model away from doing the thing you refused to automate — and in a headless run there is no one to consent.
- **Compare what actually drives the output** (`nx-tools`, where the generators live) — *not* the plugin version, which this repo's own convention bumps for a README typo. A notice that fires when nothing would change is a notice everyone learns to ignore.
- **A stamp is a repo fact; an install is a machine fact.** Order them, don't just diff them: "the project is ahead of this machine" is an ordinary state (a teammate who hasn't updated), and treating it as staleness would push a sync that *downgrades* the project. And keep the stamp somewhere unambiguously committed — `.claude/` is where *local* state lives, so a stamp there is one `.gitignore` line from vanishing.

**The `description` frontmatter of a SKILL.md is load-bearing** — it is the *only* text Claude sees when deciding whether to fire the skill. Writing/editing that description is designing the trigger; it matters as much as the body. Skills cross-reference each other by namespaced id `bespunky-<plugin>:<skill>` (e.g. `bespunky-engineering:architecture-first`).

**Two skill shapes:**
- **Standalone** — a single SKILL.md carries the whole thing.
- **Router / domain skills** — SKILL.md is only an *index* of technique clusters; the depth lives in sibling `reference/*.md` files loaded **on demand** (progressive disclosure). When editing these, keep SKILL.md thin (routing + when-to-use) and put substance in the reference files. Most of `engineering` and the `product-ux` visual skills (`astonishing-to-use`, `stage-the-vision`, `realize-the-vision`) follow this shape.

**The "always-on half" pattern (consumer-facing).** A skill only fires when judged relevant — insufficient for a mindset/rule that must hold on *every* change. So `engineering`'s `architect-mentality` + `architecture-first` (and `product-ux`'s `redesign-means-rethink`) are paired with **always-on directives** the scaffolder bakes into a consumer project's generated `HOUSE.rules.md`, which its `CLAUDE.md` imports. The canonical directive text lives in `README.md` ("The always-on half") and in `house-doc/HOUSE.rules.md.tpl` — if you change those skills' contract, update that text with it.

## `project-starter` is special — it carries the scaffolder

Most plugins are pure markdown. `project-starter` also ships an executable **scaffolder** under `skills/new-project/assets/`:
- `scaffold.sh <project> [app]` — thin launcher; runs the generators on the **local Node** when it's 22.18+, falling back to the `typescript-node` base image via `docker run` only for an old host Node. `--sync [--ensure=<csv>] [--firebase] [--local] <project>` brings an existing project up to the current house standard: **probe → install → migrate → detect → generate**.
- **Sync is MIGRATIONS + generators, not convergence.** It used to be convergence alone: every generator re-ran and re-asserted desired state, which meant each one carried unbounded *legacy healing* — code that had to recognise every shape the toolkit had ever produced, forever, so that a project three versions behind still landed on the current one. That doesn't scale, and it made every generator a museum. Now a one-way change ships as a **versioned migration** at `assets/nx-tools/src/migrations/<version>/<name>.ts`, registered in `assets/nx-tools/migrations.json` and exposed through the `nx-migrations` key of the payload's `package.json`, so **native `nx migrate`** collects and orders them. Two consequences that shape everything around it:
  - **`@bespunky/nx-tools` is a real, exactly-pinned npm devDependency** — no longer copied into `node_modules`. The copy is what made migrations impossible: `nx migrate` decides what a project needs by reading the version *resolved out of `node_modules`*, and a copy always read the new one, so the ladder was always empty. For the same reason the pin is exact, never a caret: a floated install would move that version with no migration behind it. **`--local` packs the working tree (`npm pack`) and installs that** — the same real install, different origin — which is how a toolkit change is tested before it reaches npm, on this repo included.
  - **A PROBE runs first — before anything is written — and the migrations run after the install, with an explicit `--from`.** Order: **probe** → ensure the Nx workspace → install → **migrate** → detect layers → generators → `house-doc` **last** (it writes the stamp, so it must see the final layer set). The probe comes before `nx init`, not merely before the install, because its refusal claims to fire *before anything is written* — and `--ensure=nx|agent` would otherwise have created `nx.json`, a `package.json` and a lockfile in someone's repo before the sync decided it should not run at all. The probe answers *where is this project actually at* from two sources — the version resolved in `node_modules` and the `nx-tools=` version stamped in `HOUSE.md` — and takes the **older** of the two as the migration floor. Not caution for its own sake: every project scaffolded before this release declares a **caret** range, so an ordinary `yarn install` has already floated `node_modules` to the newest published version with **no migration having run**. Trust that number alone and the sync concludes "already current", collects nothing, and lets `house-doc` stamp the gap closed — permanently, because the stamp is then the lie that every later sync believes. The same two numbers answer the opposite question with the **newer** of them: if *either* source says this project has been above the version this checkout installs, the sync **refuses before the install** — that is a downgrade, and migrations do not walk backwards, so there is no repair path. The ladder then runs with an **explicit `--from`** taken from the probe, and that is precisely what freed the ordering: the range no longer depends on whatever happens to be resolved in `node_modules`, so the install can safely come first.
- **Three classes of generator output, and knowing which is which is how you decide where a change belongs.** **(A) Owned template artifacts** — shared-browser, worktree-domains, `house-doc`/`HOUSE.md`, `post-create.sh`, a devcontainer the generator owns — are regenerated every sync; change them in the generator. **(B) Project state** — `project.json` targets, dependencies, `firebase.json`, env files — is created at baseline and thereafter evolved **only by a migration**; a generator must not reshape it. **(C) Seeded but never owned** — design tokens, `environment.ts`, `ds-theme`, `post-create.local.sh` — is written once and never again, because it is precisely what the project is expected to replace.
- **The scaffolder is LAYERED, and that is its central idea.** A project is a stack of layers — `nx`, `agent` (stack-agnostic DX), `js`, `web`, `angular`, `design-system`, `navigation`, `firebase` — each **detected from the workspace** by `nx-tools/src/layers/registry.ts`, which is also what every generator's `requireLayer()` guard consults. Two questions kept strictly apart: **detect** (what the workspace has — read, never declared) and **ensure** (`--ensure=<csv>` — what this run should create, always explicit; a sync ensures *nothing* by default). **Scaffold is sync with a full ensure set against an empty dir** — one rendered command sequence, gated at run time by `layer_active`, serves both modes so they can't drift. This is what lets `--sync --ensure=agent` retrofit house DX onto *any* repo, this one included (`nx init` creates the workspace in place; `@nx/devkit` is installed because an `nx init` workspace doesn't ship it).
- **Adoption vs ownership.** `.devcontainer/.bespunky-devcontainer.json` marks a devcontainer this generator wrote. Absent it, an existing `devcontainer.json` is **merged additively** (never overwritten, comments preserved via `jsonc-parser` in-place edits — replacing an array wholesale destroys the comments between its members) and an existing `post-create.sh` is **left alone**, with the house script written beside it as `post-create.bespunky.sh`. `post-create.local.sh` is the never-regenerated seam for a consumer's own setup.
- `nx-tools/` — `@bespunky/nx-tools`, the **house Nx generators** (TypeScript, Nx-devkit `Tree`-based — every config change is Nx-native, never a hand-rolled file edit). This is a **payload for scaffolded projects, not this repo's own build.**
- `CLAUDE.md.tmpl` — the *project-specific half* of a consumer CLAUDE.md, which the skill fills into the file `house-doc` already seeded. House guidance is **two generated, syncable files** in the consumer project (never hand-edited there): **`HOUSE.rules.md`**, the always-on directives, which the generated pointer block **`@`-imports** so they load every session; and **`HOUSE.md`**, the mechanical how-to, which it links for on-demand reading. Claude Code follows `@` imports but does not load merely-linked files — so which of the two a rule lands in decides whether it is ever actually in context.

`skills/new-project/SKILL.md` is the orchestrator and the source of truth for the scaffold sequence; the README's "How the scaffolder works" mirrors it.

## `nx-tools` payload — build & publish

The generators live as TypeScript in the toolkit. Nx can't run raw TS from `node_modules`, so distribution is a separate step:
- Compile: `assets/compile-generators.mts` (reused by the publisher).
- Publish `@bespunky/nx-tools` to npm: `tools/publish-nx-tools/publish.sh` (validate first with `--dry-run`; **bump `assets/nx-tools/package.json` version first — and that bump is gated on the migrations question, see *Release & versioning* below**). Runs on the **local Node** when it's 22.18+ (the bar is type-stripping for `compile-generators.mts`), falling back to Docker otherwise — Docker was never the requirement, a modern Node was. Force the container with `--docker`. If npm 2FA is on, pass `--otp <code>`, or drop an npm **automation token** in `~/.npmrc` and it publishes unattended.
- **Publish fails on auth** (`ENEEDAUTH`/`401`/`E403`/missing `~/.npmrc`/expired OTP)? `tools/set-npm-token/set-npm-token.sh` writes an automation token into `~/.npmrc` so publishes run unattended. **The token stays private from Claude: do NOT ask for it in chat or run this script yourself** (the Bash tool is no interactive TTY, and a pasted token would leak into the transcript) — **tell the user to run the script in their own terminal** (silent prompt), then re-run the publish. See `tools/set-npm-token/README.md`.
- **CI auto-publishes on bump.** `.github/workflows/publish-nx-tools.yml` runs `publish.sh` on every push to `main` that touches the payload, but **only publishes when `assets/nx-tools/package.json`'s version isn't already on npm** — so a bump commit ships automatically and every other push is a no-op (it reuses the same script, so CI and hand-publishing can't drift). Auth is the `NPM_TOKEN` repo secret (an npm **automation** token, which bypasses 2FA). Publishing by hand is still the fallback when CI is unavailable.

`tools/extract-tool/` is the cross-workspace half of reusable-tool extraction (`extract-tool.sh --from <project> [--lib <lib>]`), also Docker-run. Background: `docs/reusable-tool-extraction.md`.

## Release & versioning

**Release a plugin with `nx release` — never by hand.** Every plugin is an Nx project (`plugins/<p>/project.json`, tagged `type:claude-plugin`), and `nx.json`'s `plugins` release group versions them independently:

```bash
nx release version --projects=<plugin-name> --specifier=patch|minor|major   # then commit
```

It writes `plugins/<p>/.claude-plugin/plugin.json` through a custom **`versionActions`** implementation (`tools/nx-release/plugin-version-actions.js` — Nx's documented seam for versioning a manifest that isn't a `package.json`), and then **derives `.claude-plugin/marketplace.json`** from the manifests in its `afterAllProjectsVersioned` hook. **The registry is generated: never hand-edit a version in it.** Only `version` is derived — each entry's hand-written `description` is preserved verbatim. The specifier is always explicit (`specifierSource: prompt`), so the house rule still holds: **any change to a plugin gets a bump**, including a README typo. Bumps land as dedicated `chore(release): bump …` commits. Consumers upgrade with `git pull` → `/plugin marketplace update claude-toolkit` → `/reload-plugins`.

**A missed plugin bump fails SILENTLY, which is why it is machine-checked.** A missed `@bespunky/nx-tools` bump is loud — CI skips the publish and the next `--sync` installs the old payload. A missed *plugin* bump is not: the repo has the change, the marketplace advertises the old version, `/plugin marketplace update` is a no-op, and consumers stay behind forever with nothing to see. This repo shipped that bug twice — `bespunky-workflow` at `2c58e20`, then `bespunky-engineering` + `bespunky-design-system` — **both times from a sweep that crossed plugin boundaries while the commit was named after a different plugin.** That is the hazard: a repo-wide rename or ref-fix is one decision applied to N plugins, and the bump checklist fires on decisions.

So `tools/check-release-invariants/check.mjs` asks, after the fact, the question nobody remembers to: *did the thing that should have happened, happen?* It checks that every plugin (and the payload) whose **shipped content** moved since its last release was released again, that the derived registry still agrees with the manifests, and that no migration sits above the payload version. It runs in CI on every push (`.github/workflows/release-invariants.yml`) and as a **pre-push hook** (`tools/git-hooks/pre-push`, wired by `core.hooksPath` in `post-create.local.sh`; bypass with `--no-verify`). It **detects and reports — it never bumps**: patch vs minor is a judgment about what a change means to consumers.

**The migrations invariant: `max(version in migrations.json) <= version in assets/nx-tools/package.json`.** A migration is collected by `nx migrate` only when its declared version falls *within* the range it is walking — from the version the project has, up to the version being installed. Register a migration at a version the package hasn't reached and it sits above the ceiling forever: never collected, never run, and silent about it. So **adding a migration means bumping the payload's version in the same commit** — the migration's `version` field and `assets/nx-tools/package.json` are one decision, not two.

**And the gate runs the other way too: NO PAYLOAD RELEASE SHIPS WITHOUT ITS MIGRATIONS.** Before bumping `assets/nx-tools/package.json`, interrogate every change going out with one question — *does this alter a shape that projects already on disk have?* A renamed target, a relocated project or library, a retired config/environment file, a changed file shape a generator used to heal and no longer does, a moved path, a dropped option: each is a one-way delta, and **the release is not finished until a migration carries it**. "There is nothing to migrate" is a legitimate and common answer — a brand-new generator, a new layer, a fix to an owned template artifact that every sync regenerates anyway — but it is a **finding you reach deliberately, never a default you fall into**; when it *is* the answer, say so in the release commit message, so the next reader can tell a considered "nothing to migrate" from a forgotten one. Skipping a migration the release owed fails **silently and permanently**: existing projects install the new version, the ladder collects nothing, `house-doc` stamps them current — and the shape gap is now sealed behind a stamp every later sync believes.

**A migration CLEANS UP AFTER ITSELF — writing the new state is only half of it.** The migration is not done until the old state is *gone*, and this is where the ladder has actually drawn blood (see `dae4194`, which audited all eight migrations against a fixture carrying every legacy shape):

- **Delete what the new state replaces** — retired targets, configurations, orphaned files, duplicated declarations. A migration that only adds is how a workspace accumulates clutter nobody dares remove.
- **Retarget every reference to anything it moved.** A path move is a *rename*, so every occurrence of the old path **is** a reference to the thing that moved — including all the ones the toolkit never wrote: a jest `moduleNameMapper`, an eslint files glob, a `.vscode` `scss.includePaths`, a README. Rewriting them is mechanical, not clever; name each rewritten file in the log, since a migration lands as its own commit and stays reviewable on its own.
- **Ask what the move breaks by OMISSION, not only what it leaves stale.** The sharpest bug in that audit wasn't a dangling reference — it was `package.json` `workspaces` globs: `tools/*` had covered the design system, `packages/*` may not exist, so relocating the library silently dropped it out of the workspace entirely, surfacing nowhere near the cause.
- **Carrying data means clearing the original.** Copying a value to its new home and leaving the old copy behind is how two sources of truth are born — and "the generator overwrites that file moments later anyway" is not a defence, because the per-app generators are skipped whenever a sync can't resolve the app (`SYNC_PARTIAL`), which is exactly the run where the stale copy survives.
- **Where a deletion would be a GUESS, don't delete — but don't stay silent either: REPORT it.** A file whose name a project may legitimately use for its own purposes, or a declaration something else may still read, is not yours to remove on a hunch (removing a still-referenced declaration turns a duplicated value into a file that doesn't compile). Say what was left, name it, and say why. An unexplained leftover is indistinguishable from an oversight.

## Common commands

**The product is still markdown — there is no build, lint or test for the skills.** But this repo now *dogfoods its own scaffolder*: `scaffold.sh --sync --ensure=agent .` has been run on it, so it carries the `agent` layer (`HOUSE.md`, the devcontainer, `.claude/settings.json`, the window identity) and, underneath it, a minimal Nx workspace — `nx.json`, a root `package.json` and a lockfile. Nx is the *mechanism floor*: every house generator is an Nx-devkit generator invoked through `nx g`, so the DX layer cannot be applied without it. Those files exist to host the tooling, **not** to build the skills; there is still nothing to compile here.

Two consequences worth knowing:

- **`HOUSE.md` is generated — never hand-edit it.** It carries the house architecture directives and is rewritten by every sync. Repo-specific guidance (this file) stays here; `CLAUDE.md` holds only a generated pointer block to it.
- **The `SessionStart` version hook stays silent in this repo**, by design: it exempts a project whose `CLAUDE_PLUGIN_ROOT` lives inside it, because the "installed" plugin *is* the working tree being edited, so comparing versions would be comparing the file to itself.

The dev loop:

| Task | How |
| --- | --- |
| Load your working-tree skills into a session | `claude plugin marketplace add .` (the devcontainer's post-create does this on build) |
| Pick up mid-session skill edits | `/reload-plugins` (or `/plugin marketplace update claude-toolkit` if added from GitHub) |
| Release a plugin | `nx release version --projects=<name> --specifier=patch` — writes `plugin.json` **and** derives `marketplace.json`; never hand-edit either |
| Check the release invariants | `node tools/check-release-invariants/check.mjs` (also CI + the pre-push hook) |
| Validate the nx-tools payload | `tools/publish-nx-tools/publish.sh --dry-run` |
| Publish nx-tools | ask the migrations question (*Release & versioning*), write any migration it owes, bump `assets/nx-tools/package.json`, then `tools/publish-nx-tools/publish.sh` |
| Exercise the scaffolder | `bash plugins/project-starter/skills/new-project/assets/scaffold.sh <project> [app]` |
| Sync / retrofit a project | `… /scaffold.sh --sync [--ensure=<csv>] [--firebase] <project>` |
| Test an nx-tools change before publishing | add `--local` to any of the above — it packs the working tree and installs *that* instead of the registry copy |

## Conventions

- **Skills are the product; the frontmatter `description` is the trigger.** Invest there.
- **Router skills:** SKILL.md indexes, `reference/*.md` holds the depth — don't inline reference material back into SKILL.md.
- **Extending the scaffolder is generator work:** add or modify an `@bespunky/nx-tools` generator (Nx-devkit `Tree`) — never hand-write file edits into `scaffold.sh`. A literal `angular-*` Nx preset forces a demo app, so the scaffold path is the `apps` preset + `nx add @nx/angular` + a `--minimal` app.
- **A one-way change is a MIGRATION, not healing code in a generator.** "The old shape becomes the new shape" (a renamed target, a relocated project, a retired config) belongs in `src/migrations/<version>/`, bumped with the payload. Generators state *desired state* for what they own; they no longer carry the history of every shape the toolkit has shipped. **A migration is only done when the old shape is gone** — deleted, its references retargeted, its duplicates cleared, and anything deliberately left behind *reported*. Both halves of that rule — *every release ships the migrations it owes*, and *every migration cleans up after itself* — are stated in full under **Release & versioning** above; read it before you bump the payload version.
- **Adding a plugin needs four things:** its `plugin.json`, a `project.json` tagged `type:claude-plugin` (this is what makes it a release target — without it `nx release` cannot see it and the invariants checker will not guard it), an entry in `marketplace.json`, and a row in `README.md`. Its **version** is then only ever written by `nx release`.
- **Never hand-edit a version.** `marketplace.json` is derived from the plugin manifests; editing it directly creates the exact drift the derivation exists to make impossible.

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
