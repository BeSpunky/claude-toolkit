# claude-toolkit

BeSpunky's **one place** for Claude Code skills, subagents, and commands. Develop them here once,
install them into any project, and upgrade everywhere with a single update.

This is a **Claude Code plugin marketplace** (a git repo). It currently ships these plugins:

| Plugin | Provides | Purpose |
| --- | --- | --- |
| `project-starter` | skill `new-project` | Scaffold a new BeSpunky-standard project: integrated Nx monorepo + Angular (clean `--minimal` app) + devcontainer (Claude CLI & VS Code extension) + tailored CLAUDE.md. |
| `product-ux` | skills `keep-users-oriented`, `envision-the-experience`, `realize-the-vision` | **Experience design.** `keep-users-oriented` — whenever you make someone wait or move them through a process, answer the three questions — *expected result? where am I? next step?* — and pick the right feedback (deterministic → steps/progress; nondeterministic → estimate + notify). A universal service-design principle, expressed primarily through software UI (loading/progress, async, multi-step flows, long-running jobs, notifications, optimistic UI). **The experiential pair:** `envision-the-experience` — the upstream **visioning** move: imagine the *world* an interface lives in (its feeling, place, metaphor) before any layout or component, and design every element as a native inhabitant of that world — *the screen is a place, not a page.* Interrogate every element the spec names (a "menu" might become a sunflower whose petals you pick), speak in sensory non-technical language that names no implementation, keep immersive from becoming busy (restraint over spectacle), and produce a **Vision** (exploring several rival worlds, then committing to one — the single place visioning fans out). `realize-the-vision` — the downstream **building** half: the craftsman that turns a Vision into a real, running interface by **researching the truest, soundest means before writing any code** — reads the Vision as a contract, surveys the field (GSAP, Motion, three.js/R3F/angular-three, Web Animations, CSS scroll-driven animations, View Transitions, Lottie/Rive, Canvas/SVG/WebGL, Web Audio, haptics) and its caveats (jank, layout thrash, reduced-motion, accessibility, mobile), **knows when to build in code vs. when to source an asset** — figurative/photoreal art (a couple kissing, a landscape) is generated, licensed, or downloaded, never hand-coded into path-soup (with licensing, review, and art-direction) — chooses deliberately for the vision *and* the constraints, designs + confirms the architecture before building, and verifies against the feeling in the running app. **Fans out across subagents** (research lanes, asset candidates, independent regions, verification lenses) against the Vision as shared contract, always converging on a coherence pass. A **router** over a reference library of technique clusters. |
| `engineering` | skills `architect-mentality`, `architecture-first`, `software-design`, `advanced-typescript`, `angular-architecture`, `angular-native-wrappers`, `nx-monorepo-and-dx` (extensible over time) | **Mindset & discipline (agnostic):** `architect-mentality` — the stack-agnostic mindset of a great architect (mentality only, no techniques): everything is a black box with deliberate connections, place everything on purpose, model the missing concept instead of patching, automate every repeated process, go the extra mile, and more. `architecture-first` — the operational discipline that enforces it: solve every change through design, **never a patch**; fix bugs at the **root cause**; **design + confirm refactors before implementing**; ships an always-on policy the scaffold bakes into every project's CLAUDE.md. **Techniques (general / agnostic):** `software-design` — the cross-stack toolbox (decoupling & dependency inversion, replace conditionals with structure, duplication & abstraction, domain modeling, errors & boundaries, contracts & API design); the stack skills below specialize it. **Techniques (TypeScript):** `advanced-typescript` — type-system mastery (derive types from types, declaration merging, template-literal & branded types, type-level diagnostics, guards & assertions). **Techniques (Angular):** `angular-architecture` — modern-Angular patterns (DI/providers, lifecycle, SSR/zone, extensibility, projection, API ergonomics). `angular-native-wrappers` — wrap an imperative/third-party JS API in idiomatic Angular. **Techniques (Nx / workspace & DX):** `nx-monorepo-and-dx` — monorepo architecture & developer experience (boundaries & entry points, module-boundary enforcement, caching & task pipeline, generators & automation, testing setup, release/versioning/environments). |

## Layout

```
claude-toolkit/
├── .claude-plugin/marketplace.json          # lists the plugins in this marketplace
├── plugins/engineering/
│   ├── .claude-plugin/plugin.json
│   └── skills/
│       ├── architect-mentality/
│       │   └── SKILL.md                      # the architect mindset (mentality only, stack-agnostic): 15 principles
│       ├── architecture-first/
│       │   └── SKILL.md                      # architecture-first discipline (loop, root-cause + refactor gates, patch smells, redesign moves)
│       ├── advanced-typescript/              # DOMAIN skill (router) — TypeScript type-system technique clusters
│       │   ├── SKILL.md
│       │   └── reference/                    # one file per cluster, loaded on demand
│       │       ├── deriving-types-from-types.md
│       │       ├── declaration-merging.md
│       │       ├── template-literal-and-branded-types.md
│       │       ├── type-level-diagnostics.md
│       │       └── guards-and-assertions.md
│       ├── angular-architecture/             # DOMAIN skill (router) — modern-Angular technique clusters
│       │   ├── SKILL.md                      # indexes clusters; links to reference files (progressive disclosure)
│       │   └── reference/                    # one file per cluster, loaded on demand
│       │       ├── di-and-providers.md
│       │       ├── lifecycle-and-reactivity.md
│       │       ├── ssr-zone-and-change-detection.md
│       │       ├── extensibility-and-plugins.md
│       │       ├── content-projection-and-dom-bridging.md
│       │       └── component-api-ergonomics.md
│       ├── angular-native-wrappers/          # standalone technique — wrap an imperative/3rd-party JS API in Angular
│       │   └── SKILL.md
│       ├── nx-monorepo-and-dx/               # DOMAIN skill (router) — monorepo architecture & DX clusters
│       │   ├── SKILL.md
│       │   └── reference/                    # one file per cluster, loaded on demand
│       │       ├── library-boundaries-and-entry-points.md
│       │       ├── module-boundary-enforcement.md
│       │       ├── caching-and-task-pipeline.md
│       │       ├── generators-and-automation.md
│       │       ├── testing-setup.md
│       │       └── release-versioning-and-environments.md
│       └── software-design/                  # DOMAIN skill (router) — general, language-agnostic clusters
│           ├── SKILL.md
│           └── reference/                    # one file per cluster, loaded on demand
│               ├── decoupling-and-dependency-inversion.md
│               ├── replace-conditionals-with-structure.md
│               ├── duplication-and-abstraction.md
│               ├── domain-modeling.md
│               ├── errors-and-boundaries.md
│               ├── contracts-and-api-design.md
│               └── naming.md
├── plugins/product-ux/
│   ├── .claude-plugin/plugin.json
│   └── skills/
│       ├── keep-users-oriented/
│       │   └── SKILL.md                  # the three-questions principle: keep anyone who waits/steps-through oriented (deterministic → steps; nondeterministic → estimate + notify)
│       ├── envision-the-experience/       # the visioning half of the experiential pair
│       │   └── SKILL.md                  # imagine the world before the widgets (the screen is a place, not a page); interrogate every element, name no implementation, restraint over spectacle → a Vision realize-the-vision later builds
│       └── realize-the-vision/            # DOMAIN skill (router) — the building half: research the truest means BEFORE coding, then build & verify against the feeling
│           ├── SKILL.md                  # craftsman mentality + research-first method; routes to the reference clusters below
│           └── reference/                 # one file per technique family, loaded on demand
│               ├── motion-and-timelines.md
│               ├── 3d-spatial-and-webgl.md
│               ├── scroll-and-cinematic.md
│               ├── svg-canvas-and-generative.md
│               ├── sourcing-and-generating-assets.md   # build vs. source: when to generate/license/download an asset vs. hand-code it; licensing, review, art-direction
│               ├── performance-and-budgets.md
│               ├── accessibility-reduced-motion-and-fallbacks.md
│               └── sound-and-haptics.md
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
/plugin install product-ux@claude-toolkit
```

…or add to `~/.claude/settings.json` so every project sees it:

```json
{
  "extraKnownMarketplaces": {
    "claude-toolkit": { "source": { "source": "github", "repo": "BeSpunky/claude-toolkit" } }
  },
  "enabledPlugins": {
    "project-starter@claude-toolkit": true,
    "engineering@claude-toolkit": true,
    "product-ux@claude-toolkit": true
  }
}
```

Skills are namespaced as `project-starter:new-project`, `product-ux:keep-users-oriented`, `product-ux:envision-the-experience`, `product-ux:realize-the-vision`, `engineering:architect-mentality`, `engineering:architecture-first`, `engineering:advanced-typescript`, `engineering:software-design`, `engineering:advanced-typescript`, `engineering:angular-architecture`, `engineering:angular-native-wrappers`, and `engineering:nx-monorepo-and-dx`. Scaffolded
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

Approach every decision — at any scale, from a single function to the whole workspace — as a software architect. Treat **everything as a black box**: a clear boundary, a small deliberate public contract, hidden internals, dependencies received from the outside, and connections to other black boxes only through well-defined, intentionally-directed connection types (dependency injection, parent–child, layered/domain-driven dependency rules). Never reach across a boundary into another box's internals. **Place every element on purpose** — every line, `if`, constant, config, abstraction, and dependency is there deliberately; put each concern where it *belongs* (the place dedicated to it), never merely where it "fits" or happens to work. Model the missing **concept** instead of working around gaps; concentrate complexity so the edges stay simple; refuse false tradeoffs; keep abstractions empowering and honest; design for the next consumer; lead with *why* and one consistent mental model; and **go the extra mile — always** (find or invent the elegant solution; never settle for the easy-but-complex; *easy ≠ simple*). Be lazy about repetition — **automate every repeated process** (never do the same thing by hand twice; derive from a single source of truth and make it runnable in one step) — and relentless about design quality.

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
   - `nx g @bespunky/nx-tools:serve-options --project=<app>` → serve `host: 0.0.0.0` (polling lives in the devcontainer env, since modern Angular's `@angular/build:dev-server` rejects `poll`)
   - `nx g @bespunky/nx-tools:devcontainer --name=<project> --nodeMajor=<major>` `[--firebase=true]` → `.devcontainer/devcontainer.json` (Claude CLI/extension, `.claude` persistence, **`CHOKIDAR_USEPOLLING`/`CHOKIDAR_INTERVAL`** for WSL/Docker file-watching, postCreateCommand pre-installing the toolkit plugins; with `--firebase=true`, adds the Firebase CLI + Google Cloud CLI features, the `toba.vsfire` extension, and labeled `portsAttributes` for the emulator suite — but **no explicit `forwardPorts`**: VS Code auto-detects every container binding and forwards each to a free host port, so multiple devcontainers can run in parallel without colliding on the same host port)
   - `nx g @bespunky/nx-tools:claude-settings` → `.claude/settings.json` (marketplaces + enabled plugins incl. `browser-automation@claude-toolkit`)
   - `nx g @bespunky/nx-tools:playwright` → adds `@playwright/test` as a devDependency so the devcontainer's `post-create.sh` runs `playwright install --with-deps chromium` (Chromium + apt deps) on container build. Browser binary cached in a per-workspace Docker volume so rebuilds don't re-download. Always-on for BeSpunky projects; pairs with the `browser-automation:playwright` skill (loaded via the plugin) which covers when to choose Playwright vs. the preview / Chrome MCPs and how to write headless scripts.
   - **Only with `--firebase`:** `nx g @bespunky/nx-tools:firebase-emulators --project=<app> --workspaceName=<project>` → `firebase.json` (emulator suite + `singleProjectMode`); **no `.firebaserc`** is fabricated — cloud-project linkage is the Firebase CLI's job (`firebase use --add` after `firebase login`); each emulator Nx target passes `--project=demo-<name>` so emulators work without login or a real project. Generates the env files `apps/<app>/src/environments/{environment.interface.ts, environment.ts, environment.prod.ts}` (Angular's canonical environment-files pattern — emulator config in the dev file, real Firebase web config placeholders in the prod file, shared `Environment` type in the interface; user-customizable values live here, the generator preserves `environment.ts` / `environment.prod.ts` across re-runs), writes `apps/<app>/src/app/firebase.config.ts` to the canonical shape that reads from `environment` and gates emulator wiring behind `!environment.production` (the file is written when absent and rewritten when it detects the legacy `ngDevMode`-and-two-consts shape, so `--repair --firebase` self-heals old projects; once the file is on the env-files shape, `--repair` leaves it alone to preserve any app-specific customizations you've added — custom `messagingSenderId`, `initializeFirestore` options, etc.), registers the `environment.ts` → `environment.prod.ts` `fileReplacements` on the production build configuration (idempotently), self-heals legacy `ngDevMode`-and-two-consts projects on `--repair --firebase` (any populated `productionFirebaseConfig` values are migrated into `environment.prod.ts` before the legacy file is overwritten), best-effort AST wiring into `app.config.ts`, Nx targets on the app: `emulators` (flagged `continuous: true`) + `emulators:<svc>` (auth/firestore/storage/functions) for standalone use, and `serve` — the Angular dev-server itself — given **`dependsOn: ["emulators"]`** so Nx's native continuous-task orchestration (Nx 21+) boots the emulator suite alongside the dev-server as one task graph and tears both down together. `serve` is **not** wrapped in `firebase emulators:exec` or renamed: Nx's task runner owns both lifecycles, so no detached process tree orphans emulator JVMs that hold ports + the Nx task lock between restarts (`--repair` un-wraps the legacy `nx:run-commands` wrapper / `serve-app` shape back to this). `nx serve <app>` brings up the suite + the app in one command; Ctrl-C cleans both up — and **adds `firebase` + `@angular/fire`** to `package.json`, installed post-commit via Nx's `installPackagesTask`. (No shell-side `yarn add` — the generator owns deps.)

**Firebase support is opt-in.** Pass `--firebase` to `scaffold.sh` to enable the full setup (devcontainer features + emulator config + Angular environment files + Nx targets). Never enabled by default — only when the user explicitly asks for Firebase or the scaffolding agent asks and they say yes.

**Repair an existing project** (re-apply the house generators idempotently — useful if a previous scaffold was incomplete, or after upgrading the toolkit, or to retrofit `--firebase` onto an existing project):

```
bash <path-to>/scaffold.sh --repair [--firebase] <project-path-or-name> [<app-name>]
```

**Important: `--repair` does NOT touch `CLAUDE.md`.** It's the one artifact preserved verbatim, because it carries the user's project intentions — auto-rewriting would clobber custom edits. Everything else (devcontainer files, `.claude/settings.json`, `project.json`, `package.json` devDeps, Firebase config files) gets brought up to current spec by the generators. After a `--repair` against a project scaffolded with an older toolkit version, hand-merge any new always-on sections (Firebase recipe, Playwright brief, etc.) from `assets/CLAUDE.md.tmpl` into the project's `CLAUDE.md` — see the `project-starter:new-project` skill's §1b for the recipe.

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
