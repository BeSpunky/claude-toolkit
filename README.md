# claude-toolkit

BeSpunky's **one place** for Claude Code skills, subagents, and commands. Develop them here once,
install them into any project, and upgrade everywhere with a single update.

This is a **Claude Code plugin marketplace** (a git repo). It currently ships these plugins:

| Plugin | Provides | Purpose |
| --- | --- | --- |
| `project-starter` | skill `new-project` | Scaffold a new BeSpunky-standard project: integrated Nx monorepo + Angular (clean `--minimal` app) + devcontainer (Claude CLI & VS Code extension) + tailored CLAUDE.md. |
| `product-ux` | skills `keep-users-oriented`, `astonishing-to-use`, `redesign-means-rethink`, `envision-the-experience`, `stage-the-vision`, `realize-the-vision` | **Experience design.** `keep-users-oriented` — whenever you make someone wait or move them through a process, answer the three questions — *expected result? where am I? next step?* — and pick the right feedback (deterministic → steps/progress; nondeterministic → estimate + notify). A universal service-design principle, expressed primarily through software UI (loading/progress, async, multi-step flows, long-running jobs, notifications, optimistic UI). `astonishing-to-use` — **the UX co-equal force** the trio was missing: a design must be astonishing to *use*, not only to look at (effortless, understandable, no hoops, respectful of attention, a joy in the hand, built for how people *really* hold devices — thumbs, one-handed, distracted, bad signal). The use and the look are two forces that **ping-pong** until both are great — *never a one-way check* — with the **mission setting who leads** (utility → UX leads; brand/art → concept leads, then pressure-tested). Hard bar: **never below great UX**; `keep-users-oriented` is one facet. A **router** (friction & flow; clarity & cognitive load; embodied & contextual use; reconciling art & use; joy of use). `redesign-means-rethink` — the **entry gate**: when asked to *redesign* a UI, treat it as a complete creative reconception *from scratch*, never a reskin of the existing code; the existing implementation has **zero design authority** — read it only *after* the new design exists, to plan teardown/migration — and a redesign runs the trio below from scratch. (A targeted tweak is **not** a redesign.) **The experiential trio — `feeling → Staging → build`, one altitude ladder (sensory feeling → web-native art → engineering):** `envision-the-experience` (the **feeling**) — imagine the *world* an interface lives in before any layout, grounded in the real situation; interrogate every element (a "menu" might become a sunflower whose petals you pick), name no implementation, restraint over spectacle, produce a **Vision**. `stage-the-vision` (the **web-native art** — the visual architect) — the answer to *"grounding stops the bad, but what makes it ART?"* It invents the bold, web-native **moments** that turn the feeling into something you'd screenshot, staying at the **art level**: it speaks the web's language (parallax, cinematic scroll, a character that turns to camera, type-as-image) but says *what artful thing happens and how it feels*, never how to build it. Because a model isn't a native artist, it reaches art by inventing several **bold concepts** and choosing the striking-yet-true, **stealing from specific great work** and adapting its moves, **composing with craft** (focal point, scale, negative space, the cinematic moment), **decomposing each moment to physical truth** (light, shadow, material, depth, texture as they *really behave* — refusing the lone primitive that only symbolizes a phenomenon: warm light is never just a gradient), and sourcing genuine art — grounded so it's not generic, restrained so it's not garish (*bold ≠ loud*), judged by an **outside eye for beauty** (never self-certified). Produces the **Staging** (a bold concept + concrete described moments + a visual system). `realize-the-vision` (the **build**) — the craftsman that turns a Vision *and a confirmed Staging* into a real interface by **researching the truest means before writing any code** — engineers each staged moment, surveys the field (GSAP, Motion, three.js/R3F/angular-three, Web Animations, scroll-driven CSS, View Transitions, Lottie/Rive, Canvas/SVG/WebGL, Web Audio, haptics) and its caveats, **build-vs-source** (figurative art is generated/licensed, never hand-coded into path-soup), requires a confirmed Staging (else invokes `stage-the-vision` first), never self-certifies aesthetics, fans out across subagents against the shared contract with a coherence pass, and verifies against the feeling and the Staging in the running app. Both `stage-the-vision` and `realize-the-vision` are **routers** over reference libraries. |
| `engineering` | skills `architect-mentality`, `architecture-first`, `software-design`, `advanced-typescript`, `angular-architecture`, `angular-native-wrappers`, `nx-monorepo-and-dx`, `resumable-state`, `typed-reactive-navigation` (extensible over time) | **Mindset & discipline (agnostic):** `architect-mentality` — the stack-agnostic mindset of a great architect (mentality only, no techniques): everything is a black box with deliberate connections, place everything on purpose, model the missing concept instead of patching, automate every repeated process, go the extra mile, and more. `architecture-first` — the operational discipline that enforces it: solve every change through design, **never a patch**; fix bugs at the **root cause**; **design + confirm refactors before implementing**; **extract reusable tools** — spot code generic enough to serve other projects and lift it into the shared libraries (or, when sandboxed in a DevContainer, make it extraction-ready and stage it as a candidate) via the house extraction mechanism; ships an always-on policy the scaffold bakes into every project's CLAUDE.md. **Techniques (general / agnostic):** `software-design` — the cross-stack toolbox (decoupling & dependency inversion, replace conditionals with structure, duplication & abstraction, domain modeling, errors & boundaries, contracts & API design); the stack skills below specialize it. **Techniques (TypeScript):** `advanced-typescript` — type-system mastery (derive types from types, declaration merging, template-literal & branded types, type-level diagnostics, guards & assertions). **Techniques (Angular):** `angular-architecture` — modern-Angular patterns (DI/providers, lifecycle, SSR/zone, extensibility, projection, API ergonomics). `angular-native-wrappers` — wrap an imperative/third-party JS API in idiomatic Angular. **Techniques (Nx / workspace & DX):** `nx-monorepo-and-dx` — monorepo architecture & developer experience (boundaries & entry points, module-boundary enforcement, caching & task pipeline, generators & automation, testing setup, release/versioning/environments). **Cross-cutting (state & resumability):** `resumable-state` — make every screen resumable: the **URL as the single source of truth** for navigational/view state (module, opened entity, dialog, edit/create mode, tab, filters — so it's deep-linkable, refresh-safe, back-button-correct) and **working state deliberately persisted** to a chosen home (sessionStorage/localStorage/IndexedDB/server-DB by the state's properties); agnostic principle + decision framework, with the Angular realization (Router params/fragment as state, resolvers, guards, signal↔URL/storage sync) in a reference file. `typed-reactive-navigation` — **navigation is never a raw router call**: per-domain typed navigation services that take **entities, not routes** (the only Router caller — centralizing & strong-typing routes, stripping raw nav from components), **URL-derived route-state selectors** as the reactive read side (so back button / deep link / click all react identically), a **domain event bus** (interactions emit facts, not destinations), and a **pure event→command binding** (multiple events fold into one navigation); cross-domain goes through an app-shell binding. Partners `resumable-state`; scaffold a domain's set with the `domain-navigation` Nx generator. |

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
│       ├── resumable-state/                  # DOMAIN skill (router) — every screen resumable: URL as source of truth + deliberate persistence
│       │   ├── SKILL.md                      # agnostic principle + state-home decision framework
│       │   └── reference/
│       │       └── angular-techniques.md     # Router params/fragment as state, resolvers, guards, signal↔URL/storage sync
│       ├── typed-reactive-navigation/        # DOMAIN skill (router) — no raw router calls: typed per-domain nav (entities not routes) + URL-derived selectors + event bus + pure binding
│       │   ├── SKILL.md                      # agnostic architecture + the five parts + the reactive loop
│       │   └── reference/
│       │       └── angular-techniques.md     # route registry, Router-wrapping commands, toSignal selectors, DI-scoped bus, the binding
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
│       ├── astonishing-to-use/            # DOMAIN skill (router) — the UX co-equal force: astonishing to USE, not only to look at; ping-pongs with the concept (mission sets who leads); never below great UX
│       │   ├── SKILL.md
│       │   └── reference/
│       │       ├── friction-and-flow.md
│       │       ├── facilitating-input.md                    # think about entering each data type; interrogate the default control's friction; invent a novel control when the data deserves it (then validate it's usable)
│       │       ├── clarity-and-cognitive-load.md
│       │       ├── errors-and-recovery.md                   # validation fails → be informative (what/why/how-to-fix) and carry the user to the problem (scroll into view / take-me-there, focus the control); no dead ends
│       │       ├── responsiveness-and-perceived-speed.md   # instant & like real life; never hang (async/bg); load instantly (no/live splash, lazy+skeletons)
│       │       ├── continuity-and-transitions.md            # smooth transitions everywhere; no abrupt layout shifts (CLS); animate in/out; mobile keyboard
│       │       ├── embodied-and-contextual-use.md
│       │       ├── reconciling-art-and-use.md
│       │       └── joy-of-use.md
│       ├── redesign-means-rethink/        # entry gate — "redesign" = reconceive from scratch, NOT reskin existing code; read old code only to plan teardown
│       │   └── SKILL.md
│       ├── envision-the-experience/       # trio member 1 — the FEELING (the Vision)
│       │   └── SKILL.md                  # imagine the world before the widgets, grounded in the real situation; name no implementation, restraint over spectacle → a Vision
│       ├── stage-the-vision/              # trio member 2 — DOMAIN skill (router) — the visual architect: turn the feeling into bold, web-native ART (the Staging)
│       │   ├── SKILL.md                  # invent striking web-native moments at the ART level (web-aware, not engineering); bold concept + steal from great work + compose + restrain + outside-eye taste gate → the Staging
│       │   └── reference/                 # one file per craft area, loaded on demand
│       │       ├── the-web-as-art-medium.md
│       │       ├── inventing-the-concept.md
│       │       ├── decompose-to-physical-truth.md      # the painter's physics: light/shadow/material/colour/depth/form/texture as they really behave; refuse the lone primitive (warm light ≠ a gradient)
│       │       ├── composition-and-cinematic-staging.md
│       │       ├── stealing-from-great-work.md
│       │       └── grounding-restraint-and-the-taste-gate.md
│       └── realize-the-vision/            # trio member 3 — DOMAIN skill (router) — the BUILD: engineer each staged moment; research the truest means BEFORE coding, verify against feeling + Staging
│           ├── SKILL.md                  # craftsman mentality + research-first method; routes to the reference clusters below
│           └── reference/                 # one file per technique family, loaded on demand
│               ├── motion-and-timelines.md
│               ├── 3d-spatial-and-webgl.md
│               ├── scroll-and-cinematic.md
│               ├── svg-canvas-and-generative.md
│               ├── sourcing-and-generating-assets.md   # build vs. source: when to generate/license/download an asset vs. hand-code it; licensing, review, art-direction
│               ├── performance-and-budgets.md
│               ├── responsive-and-adaptive-layout.md   # engineer each moment's per-form-factor staging: fluid/container queries, responsive images & art-direction, touch vs pointer, mobile viewport; re-compose, never shrink
│               ├── accessibility-reduced-motion-and-fallbacks.md
│               └── sound-and-haptics.md
└── plugins/project-starter/
    ├── .claude-plugin/plugin.json
    └── skills/new-project/
        ├── SKILL.md                          # the scaffolding skill (orchestrator)
        └── assets/
            ├── scaffold.sh                   # thin launcher: resolve Node, docker run, bootstrap + run house generators
            ├── CLAUDE.md.tmpl                # THIN base CLAUDE.md (intentions + conventions + the generated-HOUSE.md pointer), authored by the skill; the house guidance lives in the generated HOUSE.md
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
/plugin install bespunky-project-starter@claude-toolkit
/plugin install bespunky-engineering@claude-toolkit
/plugin install bespunky-product-ux@claude-toolkit
```

…or add to `~/.claude/settings.json` so every project sees it:

```json
{
  "extraKnownMarketplaces": {
    "claude-toolkit": { "source": { "source": "github", "repo": "BeSpunky/claude-toolkit" } }
  },
  "enabledPlugins": {
    "bespunky-project-starter@claude-toolkit": true,
    "bespunky-engineering@claude-toolkit": true,
    "bespunky-product-ux@claude-toolkit": true
  }
}
```

Skills are namespaced as `bespunky-project-starter:new-project`, `bespunky-product-ux:keep-users-oriented`, `bespunky-product-ux:astonishing-to-use`, `bespunky-product-ux:redesign-means-rethink`, `bespunky-product-ux:envision-the-experience`, `bespunky-product-ux:stage-the-vision`, `bespunky-product-ux:realize-the-vision`, `bespunky-engineering:architect-mentality`, `bespunky-engineering:architecture-first`, `bespunky-engineering:advanced-typescript`, `bespunky-engineering:software-design`, `bespunky-engineering:angular-architecture`, `bespunky-engineering:angular-native-wrappers`, `bespunky-engineering:nx-monorepo-and-dx`, `bespunky-engineering:resumable-state`, and `bespunky-engineering:typed-reactive-navigation`. Scaffolded
projects already get a `.claude/settings.json` referencing this marketplace, so the toolkit's skills are
available inside every new project automatically.

## The always-on half

Installing the `engineering` plugin makes the `architect-mentality` and `architecture-first` skills
available — but a skill only fires when the model judges it relevant, which isn't enough for a mindset and
a rule that must hold on **every** change. So the policy has two halves:

1. **Always-on directives in `CLAUDE.md`** — loaded into context every session, so the mindset and the rule are never out of mind.
2. **The `engineering` skills** — the depth: `architect-mentality` (the full architect mindset) and `architecture-first` (the loop, the patch smells to refuse, the redesign moves).

**New projects** get half (1) automatically — the `new-project` scaffold bakes these directives into the
generated `CLAUDE.md` and enables the plugins. **Existing projects** that install the plugins should paste
the canonical directives below into their `CLAUDE.md` so the mindset, the rule, and the redesign discipline
are always in context (the last pairs with `bespunky-product-ux:redesign-means-rethink` the same way the first two
pair with the `engineering` skills — an always-on directive plus the skill's depth):

```markdown
## Architect mentality

Approach every decision — at any scale, from a single function to the whole workspace — as a software architect. Treat **everything as a black box**: a clear boundary, a small deliberate public contract, hidden internals, dependencies received from the outside, and connections to other black boxes only through well-defined, intentionally-directed connection types (dependency injection, parent–child, layered/domain-driven dependency rules). Never reach across a boundary into another box's internals. **Place every element on purpose** — every line, `if`, constant, config, abstraction, and dependency is there deliberately; put each concern where it *belongs* (the place dedicated to it), never merely where it "fits" or happens to work. Model the missing **concept** instead of working around gaps; concentrate complexity so the edges stay simple; refuse false tradeoffs; keep abstractions empowering and honest; design for the next consumer; lead with *why* and one consistent mental model; and **go the extra mile — always** (find or invent the elegant solution; never settle for the easy-but-complex; *easy ≠ simple*). Be lazy about repetition — **automate every repeated process** (never do the same thing by hand twice; derive from a single source of truth and make it runnable in one step) — and relentless about design quality.

For the full mindset, think with the **`bespunky-engineering:architect-mentality`** skill. It is the *why*; the rule below is the *operational discipline* that enforces it.

## Architecture-first (non-negotiable)

Every change — feature, bug, edge case, or "quick fix" — is solved through **design and infrastructure, never a patch.** No special-case `if`s keyed on one input/customer/env, no magic values, no copy-paste, no boolean flags to make one unit do two things, no casts to silence a type mismatch, no bumped timeouts to mask a structural problem. **For bugs, find and fix the root cause — never mask the symptom** (no swallowed errors, defaulted bad data, or guards bolted on at the symptom site). When the current design does not account for a requirement, **redesign and refactor** the relevant seam (model the missing concept, extract, decouple, build the missing abstraction, reuse) so the new behavior is a natural case of the design — don't bolt it on. Coupling, duplication, and special-casing must never grow. **If a refactor is needed to lay infrastructure for a feature or to fix a bug, design it first, get confirmation, and only then implement** — never refactor ad hoc mid-edit; if a correct redesign is genuinely large, surface it and its cost rather than patching silently.

For any non-trivial change, invoke the **`bespunky-engineering:architecture-first`** skill before writing code — it carries the full loop, the bug root-cause and refactor gates, the patch smells to refuse, and the redesign moves.

## Redesign means rethink

When asked to **redesign** any UI — a layout, screen, page, component, or flow — treat it as a **complete creative reconception from scratch**, never a modification or reskin of what exists. The existing implementation has **zero design authority**: do **not** read it to inform the new design, and don't even look at it before conceiving the new one. Reconceive the **form** from the intent, the requirements, and the feeling; honor the **purpose** (what the thing is for, its data and functionality), which comes from the spec and the user — never reverse-engineered from the old layout. Read the existing code **only after** the new design exists — to plan what to clean up, overwrite, or migrate, and to confirm what functionality must survive — then build the new design cleanly and **remove the old**. (A *targeted tweak* — "move this button", "change this colour" — is **not** a redesign; don't inflate it into one.)

For any redesign, invoke the **`bespunky-product-ux:redesign-means-rethink`** skill — the entry gate to the experience-design trio (`envision-the-experience` → `stage-the-vision` → `realize-the-vision`, run from scratch).
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
   - `nx g @bespunky/nx-tools:claude-settings` → `.claude/settings.json` (marketplaces + enabled plugins incl. `bespunky-browser-automation@claude-toolkit`)
   - `nx g @bespunky/nx-tools:playwright` → adds `@playwright/test` as a devDependency so the devcontainer's `post-create.sh` runs `playwright install --with-deps chromium` (Chromium + apt deps) on container build. Browser binary cached in a per-workspace Docker volume so rebuilds don't re-download. Always-on for BeSpunky projects; pairs with the `bespunky-browser-automation:playwright` skill (loaded via the plugin) which covers when to choose Playwright vs. the preview / Chrome MCPs and how to write headless scripts.
   - **Only with `--firebase`:** `nx g @bespunky/nx-tools:firebase-emulators --project=<app> --workspaceName=<project>` → `firebase.json` (emulator suite + `singleProjectMode`); **no `.firebaserc`** is fabricated — cloud-project linkage is the Firebase CLI's job (`firebase use --add` after `firebase login`); each emulator Nx target passes `--project=demo-<name>` so emulators work without login or a real project. Generates the env files `apps/<app>/src/environments/{environment.interface.ts, environment.ts, environment.prod.ts}` (Angular's canonical environment-files pattern — emulator config in the dev file, real Firebase web config placeholders in the prod file, shared `Environment` type in the interface; user-customizable values live here, the generator preserves `environment.ts` / `environment.prod.ts` across re-runs), writes `apps/<app>/src/app/firebase.config.ts` to the canonical shape that reads from `environment` and gates emulator wiring behind `!environment.production` (the file is written when absent and rewritten when it detects the legacy `ngDevMode`-and-two-consts shape, so `--repair --firebase` self-heals old projects; once the file is on the env-files shape, `--repair` leaves it alone to preserve any app-specific customizations you've added — custom `messagingSenderId`, `initializeFirestore` options, etc.), registers the `environment.ts` → `environment.prod.ts` `fileReplacements` on the production build configuration (idempotently), self-heals legacy `ngDevMode`-and-two-consts projects on `--repair --firebase` (any populated `productionFirebaseConfig` values are migrated into `environment.prod.ts` before the legacy file is overwritten), best-effort AST wiring into `app.config.ts`, Nx targets on the app: `emulators` (flagged `continuous: true`) + `emulators:<svc>` (auth/firestore/storage/functions) for standalone use, and `serve` — the Angular dev-server itself — given **`dependsOn: ["emulators"]`** so Nx's native continuous-task orchestration (Nx 21+) boots the emulator suite alongside the dev-server as one task graph and tears both down together. `serve` is **not** wrapped in `firebase emulators:exec` or renamed: Nx's task runner owns both lifecycles, so no detached process tree orphans emulator JVMs that hold ports + the Nx task lock between restarts (`--repair` un-wraps the legacy `nx:run-commands` wrapper / `serve-app` shape back to this). `nx serve <app>` brings up the suite + the app in one command; Ctrl-C cleans both up — and **adds `firebase` + `@angular/fire`** to `package.json`, installed post-commit via Nx's `installPackagesTask`. (No shell-side `yarn add` — the generator owns deps.)

**Firebase support is opt-in.** Pass `--firebase` to `scaffold.sh` to enable the full setup (devcontainer features + emulator config + Angular environment files + Nx targets). Never enabled by default — only when the user explicitly asks for Firebase or the scaffolding agent asks and they say yes.

**Repair an existing project** (re-apply the house generators idempotently — useful if a previous scaffold was incomplete, or after upgrading the toolkit, or to retrofit `--firebase` onto an existing project):

```
bash <path-to>/scaffold.sh --repair [--firebase] <project-path-or-name> [<app-name>]
```

**Important: the house guidance is a generated, repairable `HOUSE.md`.** `--repair` regenerates `HOUSE.md` (architecture directives, branch/release workflow, serving, Firebase, Nx, browser tooling) in full every run and upserts a bounded pointer to it in `CLAUDE.md` — the only part of `CLAUDE.md` it touches. The user's own `CLAUDE.md` content (intentions + conventions) is preserved verbatim. Everything else (devcontainer files, `.claude/settings.json`, `project.json`, `package.json` devDeps, Firebase config files) is brought up to current spec by the generators. So a toolkit upgrade reaches an existing project entirely through `--repair` — **no hand-merge** (see the `bespunky-project-starter:new-project` skill's §1b).

The `new-project` skill then authors a tailored `CLAUDE.md` (the one piece that stays contextual, not a template).

The generated `.devcontainer/devcontainer.json` **pre-installs this marketplace on build** via its
`postCreateCommand` (`claude plugin marketplace add BeSpunky/claude-toolkit && claude plugin install
bespunky-project-starter@claude-toolkit --scope project && claude plugin install bespunky-engineering@claude-toolkit
--scope project`), so the toolkit's skills/agents are live the moment the container comes up. Declaring `enabledPlugins` in settings alone does **not** auto-install — the CLI step
is what makes it immediate inside the container; on the host, the settings declaration offers a one-click
install on first run.

> **Generator-first, manual last.** A literal `angular-*` preset always forces a demo app (verified
> against Nx source), so we use `apps` + `nx add @nx/angular` + a `--minimal` app — the only one-shot
> path to an Angular workspace with no demo content.
