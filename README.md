# claude-toolkit

BeSpunky's **one place** for Claude Code skills, subagents, and commands. Develop them here once,
install them into any project, and upgrade everywhere with a single update.

This is a **Claude Code plugin marketplace** (a git repo). It currently ships these plugins:

| Plugin | Provides | Purpose |
| --- | --- | --- |
| `bespunky` | skill `index` | **The toolkit's front door.** `/bespunky:index` is a **self-maintaining catalog**: it lists every installed toolkit skill — grouped by plugin, each with its `/plugin:skill` invocation and a one-line *"use when"* — by reading the **live** available-skills set in the session, so it can never go stale. Every plugin shares the `bespunky-` prefix, so typing `/bespunky` in the slash menu filters the autocomplete to the whole toolkit at once. |
| `browser-automation` | skills `playwright`, `shared-browser` | **Two ways to drive a real browser.** `playwright` — **headless** Chromium (pre-installed) for solo automated work: verify a change end-to-end, reproduce a bug, capture before/after screenshots, scrape the rendered DOM, watch console + network, codegen a test. `shared-browser` — **one live browser you and the human drive together**: they watch and click it in a normal host tab (over noVNC, `:6080`) while Claude attaches over loopback CDP to the *same* instance — for co-debugging, in-place CSS/DOM verification with **measured** proof (`getComputedStyle`, `getBoundingClientRect`), a real login (OAuth/captcha) completed by the human while Claude observes, and pairing on a flow. A decision tree keeps them distinct: no human watching → `playwright`. |
| `project-starter` | skill `new-project` | Scaffold a new BeSpunky-standard project: integrated Nx monorepo + Angular (clean `--minimal` app) + devcontainer (Claude CLI & VS Code extension) + tailored CLAUDE.md. |
| `product-ux` | skills `keep-users-oriented`, `astonishing-to-use`, `redesign-means-rethink`, `distill-the-brief`, `envision-the-experience`, `stage-the-vision`, `mock-to-choose`, `realize-the-vision`, `model-intent-not-data` | **Experience design.** `keep-users-oriented` — whenever you make someone wait or move them through a process, answer the three questions — *expected result? where am I? next step?* — and pick the right feedback (deterministic → steps/progress; nondeterministic → estimate + notify). A universal service-design principle, expressed primarily through software UI (loading/progress, async, multi-step flows, long-running jobs, notifications, optimistic UI). `astonishing-to-use` — **the UX co-equal force** the trio was missing: a design must be astonishing to *use*, not only to look at (effortless, understandable, no hoops, respectful of attention, a joy in the hand, built for how people *really* hold devices — thumbs, one-handed, distracted, bad signal). The use and the look are two forces that **ping-pong** until both are great — *never a one-way check* — with the **mission setting who leads** (utility → UX leads; brand/art → concept leads, then pressure-tested). Hard bar: **never below great UX**; `keep-users-oriented` is one facet. A **router** (friction & flow; clarity & cognitive load; embodied & contextual use; reconciling art & use; joy of use). `redesign-means-rethink` — the **entry gate**: when asked to *redesign* a UI, treat it as a complete creative reconception *from scratch*, never a reskin of the existing code; the existing implementation has **zero design authority** — read it only *after* the new design exists, to plan teardown/migration — and a redesign runs the trio below from scratch. (A targeted tweak is **not** a redesign.) **The experiential trio — `feeling → Staging → build`, one altitude ladder (sensory feeling → web-native art → engineering):** `envision-the-experience` (the **feeling**) — imagine the *world* an interface lives in before any layout, grounded in the real situation; interrogate every element (a "menu" might become a sunflower whose petals you pick), name no implementation, restraint over spectacle, produce a **Vision**. `stage-the-vision` (the **web-native art** — the visual architect) — the answer to *"grounding stops the bad, but what makes it ART?"* It invents the bold, web-native **moments** that turn the feeling into something you'd screenshot, staying at the **art level**: it speaks the web's language (parallax, cinematic scroll, a character that turns to camera, type-as-image) but says *what artful thing happens and how it feels*, never how to build it. Because a model isn't a native artist, it reaches art by inventing several **bold concepts** and choosing the striking-yet-true, **stealing from specific great work** and adapting its moves, **composing with craft** (focal point, scale, negative space, the cinematic moment), **decomposing each moment to physical truth** (light, shadow, material, depth, texture as they *really behave* — refusing the lone primitive that only symbolizes a phenomenon: warm light is never just a gradient), and sourcing genuine art — grounded so it's not generic, restrained so it's not garish (*bold ≠ loud*), judged by an **outside eye for beauty** (never self-certified). Produces the **Staging** (a bold concept + concrete described moments + a visual system). `mock-to-choose` (the **verdict** — the decision instrument between the art and the build) — a person cannot approve a *look* by reading a description of it, so this puts the concepts in front of their **eyes**: it builds the **cheapest throwaway thing that makes each concept judgeable**, mocks **every option on the table** (one mock asks *"is this OK?"* and gets a weak yes; three ask *"which one?"* and get a real verdict), and shows them **side by side**, phone and desktop. A mock is **shell and presentation only** — layout, composition, palette, type, atmosphere, dressed in plausible dummy records — with **zero functionality** (dead controls, no state, no routing, no data, no build step, no deps, no app integration). Heavy concepts (a scroll cinematic, a 3D scene, a living background, physically-decomposed light) are **suggested, never rendered** — one representative frame, a still, a flat approximation — vivid enough that the atmosphere is unmistakable, because the point is a fast verdict, not a faithful build. Every variant shares the **same dummy content**, so the only difference the eye sees is the *design*. Every review runs on a shared **harness** — a mini-app shipped with the skill (`assets/mock-harness/`: the gallery, the review layer, a random-port `serve.sh`) copied verbatim into the mocks folder, so Claude authors **only** `mocks.json` (the question, what's faked, the variants) and one file per concept: **every mock experience is identical and only the mocks change** — the user learns the review once. Because bare low fidelity reads as low *quality*, each mock carries an **intent layer** — floating notes and hover popovers that **narrate the empty house** the way an architect walks a site: *"the sofa goes here, sideways, facing the window"*, *"this dot is the light — it'll float and breathe; here it's a static glow, so judge where it sits and how much of the frame it owns"* — so the user judges the **intent**, never the shortcut. And the mocks are **commentable in place**: the harness serves a `/comments` endpoint, the user presses `c` and **clicks anything to pin a comment to it**, and the server writes each to `comments.json` **on disk** — so Claude reads them back from a *file* (exact words, exact element, exact variant, exact viewport), which means an **asynchronous** review works as well as a co-driven one in the **shared browser** (noVNC). The verdict is a real **gate, not a poll**: *"none of these"* and *"a hybrid of A and B"* are first-class outcomes (route upstream to re-conceive), and a mock **yes is provisional** — it picks a direction, it does not certify the finished art (`realize-the-vision` still owes the outside-eye pass on the real result). Comments are copied **verbatim** into `DECISION.md`. Mocks live in a standard **dated, feature-scoped package** (`docs/features/<YYYY-MM-DD>-<slug>/mocks/` — inside the effort's **feature package**, the slug shared with the git branch) that is **self-ignoring and completely throwable** (nothing outside may depend on it; one `rm` erases every trace; the user may choose to keep any of it) — while the **decision is recorded durably** (`DECISION.md`), so the conclusion outlives the evidence. Feedback travels **upstream** (re-conceive in `stage-the-vision`) and the mock is re-made cheaply — never polished into a prototype — and **its code never becomes the build**. `realize-the-vision` (the **build**) — the craftsman that turns a Vision *and a confirmed Staging* into a real interface by **researching the truest means before writing any code** — engineers each staged moment, surveys the field (GSAP, Motion, three.js/R3F/angular-three, Web Animations, scroll-driven CSS, View Transitions, Lottie/Rive, Canvas/SVG/WebGL, Web Audio, haptics) and its caveats, **build-vs-source** (figurative art is generated/licensed, never hand-coded into path-soup), requires a confirmed Staging (else invokes `stage-the-vision` first), never self-certifies aesthetics, fans out across subagents against the shared contract with a coherence pass, and verifies against the feeling and the Staging in the running app. Both `stage-the-vision` and `realize-the-vision` are **routers** over reference libraries. |
| `design-system` | skills `design-system-first`, `design-tokens-and-theming` | **Styling as a system.** `design-system-first` — the **discipline**: before you build any feature UI, **go to the design system**; **never hardcode a style value** (every colour, space, radius, type step, elevation, border, duration and easing is a **token** — a CSS custom property consumed through the DS's SASS API; components read **semantic** tokens only, never a raw primitive); feature components **compose** DS components and tokens, they never invent appearance; **the second occurrence of a UI pattern is a promotion, not a copy-paste** — lift it into the DS as a reusable component (`nx g @bespunky/nx-tools:ds-component <name>`, one secondary entry point each), migrate **both** sites, delete the copies; and when the DS **lacks the concept**, **model it** (add the token, the semantic alias, the scale step, the component) — never a local override, `!important`, a `::ng-deep` reach-in, a duplicated token, or a one-off `variant` boolean. The DS is the **single source of visual truth**, so a re-theme or rebrand is a change of **tokens**, not a thousand component files (the styling twin of `redesign-means-rethink`: *re-token, don't re-hardcode*; the styling flavour of `architecture-first`: *never a patch* — and worse there, because CSS has no compiler to catch the drift). Ships an always-on policy the scaffold bakes into every project's `HOUSE.md`. `design-tokens-and-theming` — the **techniques**, a **router**: **two layers, one truth** — CSS custom properties are the **runtime** layer (cascading, themeable; a mode is a **re-binding of tokens**, live, never a swapped stylesheet) and the SASS API is the **author-time** layer (zero-output functions/mixins/placeholders, summoned with `@use`, never a global side-effect). Clusters: token taxonomy & naming (primitive → semantic → component; a value not on a scale is a design bug, not a missing token); CSS custom properties as the runtime layer; the SASS API layer & how it's summoned (the public `@forward … show` barrel over `_`-prefixed private folders named for *what they are*; how it resolves in-repo vs published); theming & modes (light/dark/brand, where a mode **lives**, persisting it without a flash, contrast that holds in **every** mode); component styling & encapsulation (`:host`, `::part`, `ViewEncapsulation`, the **`::ng-deep` ban**, variants as data not booleans); the DS library's structure & entry points (one component = one entry point, generator-first). Encodes the **visual system** `stage-the-vision` produces — it doesn't invent the look, it makes the look live in **one place**. |
| `workflow` | skills `branch-and-release`, `feature-package`, `local-server-isolation`, `session-handoff` | **Ways of working** — the process, order, and methodology of how work moves from idea to production, independent of *what* is being built. `branch-and-release` — the house git methodology: a one-way promotion pipeline (`feature → development → staging → main`), unrelated work isolated in per-feature worktrees, small committed increments, rebase-and-re-verify at the single divergence point, three human-gated promotions. `feature-package` — **a feature is a package, not a scatter of files**: one effort, one **slug** (the same one that names the branch and worktree), one folder — `docs/features/<YYYY-MM-DD>-<slug>/` — holding everything durable the effort produces that isn't code: `BRIEF.md`, `VISION.md`, `STAGING.md`, `DECISION.md`, the throwaway self-ignoring `mocks/`, and the effort's `handoffs/` batons. Born **with** the worktree and filled *as the work happens* (a doc written at the end is a memory, and memories are where the reasons go missing); every artifact-producing skill writes **into** it instead of inventing a private home. Two rules: **the conclusion is durable, the evidence is disposable** (decisions and roads-not-taken are committed and permanent; mocks and scratch are self-ignoring, depended on by nothing, binned by default), and **the user's own words** are the most valuable line in the package — quote the sentence that settled it, never paraphrase. It answers *"six months on, why was it done this way, and what did we already rule out?"* `local-server-isolation` — bind a **random free port**, never the default/forwarded one the user's own server owns. `session-handoff` — carry a live effort across a context boundary into a fresh session: capture writes a distilled relay baton (into the effort's package), resume re-grounds against reality; the user's **corrections** are captured first-class, and durable ones promoted to persistent memory. |
| `engineering` | skills `architect-mentality`, `architecture-first`, `software-design`, `advanced-typescript`, `angular-architecture`, `angular-native-wrappers`, `nx-monorepo-and-dx`, `resumable-state`, `typed-reactive-navigation` (extensible over time) | **Mindset & discipline (agnostic):** `architect-mentality` — the stack-agnostic mindset of a great architect (mentality only, no techniques): everything is a black box with deliberate connections, place everything on purpose, model the missing concept instead of patching, automate every repeated process, go the extra mile, and more. `architecture-first` — the operational discipline that enforces it: solve every change through design, **never a patch**; fix bugs at the **root cause**; **design + confirm refactors before implementing**; **extract reusable tools** — spot code generic enough to serve other projects and lift it into the shared libraries (or, when sandboxed in a DevContainer, make it extraction-ready and stage it as a candidate) via the house extraction mechanism; ships an always-on policy the scaffold bakes into every project's CLAUDE.md. **Techniques (general / agnostic):** `software-design` — the cross-stack toolbox (decoupling & dependency inversion, replace conditionals with structure, duplication & abstraction, domain modeling, errors & boundaries, contracts & API design); the stack skills below specialize it. **Techniques (TypeScript):** `advanced-typescript` — type-system mastery (derive types from types, declaration merging, template-literal & branded types, type-level diagnostics, guards & assertions). **Techniques (Angular):** `angular-architecture` — modern-Angular patterns (DI/providers, lifecycle, SSR/zone, extensibility, projection, API ergonomics). `angular-native-wrappers` — wrap an imperative/third-party JS API in idiomatic Angular. **Techniques (Nx / workspace & DX):** `nx-monorepo-and-dx` — monorepo architecture & developer experience (boundaries & entry points, module-boundary enforcement, caching & task pipeline, generators & automation, testing setup, release/versioning/environments). **Cross-cutting (state & resumability):** `resumable-state` — make every screen resumable: the **URL as the single source of truth** for navigational/view state (module, opened entity, dialog, edit/create mode, tab, filters — so it's deep-linkable, refresh-safe, back-button-correct) and **working state deliberately persisted** to a chosen home (sessionStorage/localStorage/IndexedDB/server-DB by the state's properties); agnostic principle + decision framework, with the Angular realization (Router params/fragment as state, resolvers, guards, signal↔URL/storage sync) in a reference file. `typed-reactive-navigation` — **navigation is never a raw router call**: per-domain typed navigation services that take **entities, not routes** (the only Router caller — centralizing & strong-typing routes, stripping raw nav from components), **URL-derived route-state selectors** as the reactive read side (so back button / deep link / click all react identically), a **domain event bus** (interactions emit facts, not destinations), and a **pure event→command binding** (multiple events fold into one navigation); cross-domain goes through an app-shell binding. Partners `resumable-state`; scaffold a domain's set with the `domain-navigation` Nx generator. |

## Layout

```
claude-toolkit/
├── .claude-plugin/marketplace.json          # lists the plugins in this marketplace
├── plugins/bespunky/                        # the toolkit's front door
│   ├── .claude-plugin/plugin.json
│   └── skills/index/
│       └── SKILL.md                      # /bespunky:index — self-maintaining catalog of every installed toolkit skill (reads the LIVE skill set; never goes stale)
├── plugins/browser-automation/
│   ├── .claude-plugin/plugin.json
│   └── skills/
│       ├── playwright/                    # HEADLESS Chromium — solo verification, bug repro, before/after screenshots, DOM scraping, codegen
│       │   └── SKILL.md
│       └── shared-browser/                # ONE live browser the human watches (noVNC :6080) while Claude drives it over loopback CDP — co-debugging with measured proof
│           └── SKILL.md
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
│       ├── distill-the-brief/             # quartet stage 0 — turn a messy dossier into the correct envision-input (the design problem, solution stripped out) → a Brief Tree
│       │   └── SKILL.md
│       ├── model-intent-not-data/         # the SEMANTIC layer of I/O — model the user's intent in / decision out; never mirror the system's data shape onto the screen
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
│       ├── mock-to-choose/               # the VERDICT — DOMAIN skill (router) — mock every concept cheaply so the user approves/rejects BY EYE, in seconds, not by reading
│       │   ├── SKILL.md                  # cheapest throwaway shell-only mock of EVERY option, same dummy content, side by side; heavy concepts suggested not rendered; throwable dated package; decision recorded, mock code never becomes the build
│       │   └── reference/                 # one file per craft area, loaded on demand
│       │       ├── annotations-and-live-review.md      # the intent layer (data-note pins + hover popovers narrating what each low-fi shortcut stands for) + in-place comments the user pins in the shared browser, read back from the DOM over CDP
│       │       ├── cheap-stand-ins.md                  # the fidelity dial: faking a cinematic/3D/generative bg/physical light; dummy content that reads like life; what to cut first, what may never be cut
│       │       └── the-mock-package.md                 # mocks live in the effort's feature package (docs/features/<date>-<slug>/mocks/) — self-ignoring & throwable; the side-by-side gallery (phone + desktop); showing it; DECISION.md; keep-vs-throw
│       │   └── assets/mock-harness/                    # THE HARNESS (mini-app, copied into every mocks/ folder): gallery.html+js (renders whatever mocks.json declares), review.css+js (intent pins, in-place comments, window.mockComments()), serve.sh (random free port), variants/_template.html — Claude writes only mocks.json + one file per concept
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
├── plugins/design-system/
│   ├── .claude-plugin/plugin.json
│   └── skills/
│       ├── design-system-first/              # DISCIPLINE (+ always-on directive) — go to the DS first; never hardcode a value;
│       │   └── SKILL.md                      #   promote on the 2nd occurrence; model the missing concept instead of overriding
│       └── design-tokens-and-theming/        # DOMAIN skill (router) — the styling architecture
│           ├── SKILL.md                      # two layers, one truth: CSS custom properties (runtime) / SASS API (author-time)
│           └── reference/                    # one file per cluster, loaded on demand
│               ├── token-taxonomy-and-naming.md
│               ├── css-custom-properties-the-runtime-layer.md
│               ├── the-sass-api-layer.md
│               ├── theming-and-modes.md
│               ├── component-styling-and-encapsulation.md
│               └── ds-library-structure-and-entrypoints.md
├── plugins/workflow/
│   ├── .claude-plugin/plugin.json
│   └── skills/
│       ├── branch-and-release/            # the house git methodology — one-way promotion pipeline, per-feature worktrees, three human-gated promotions
│       │   └── SKILL.md
│       ├── feature-package/               # a feature is a PACKAGE — one effort, one slug, one folder (docs/features/<date>-<slug>/): brief, vision, staging, decision, throwaway mocks, handoff batons
│       │   └── SKILL.md                  # slug shared with the branch/worktree; born WITH the tree, filled as it happens; conclusion durable, evidence disposable
│       ├── local-server-isolation/        # bind a RANDOM free port — never the one the user's own server owns
│       │   └── SKILL.md
│       └── session-handoff/               # carry a live effort across a context boundary — capture writes the baton into the feature package; resume re-grounds
│           └── SKILL.md
└── plugins/project-starter/
    ├── .claude-plugin/plugin.json
    ├── hooks/                                # SessionStart: is this project's house tooling behind the installed plugin?
    │   ├── hooks.json                        # registers the hook (startup only — a resume is mid-task)
    │   └── check-house-version.sh            # orders HOUSE.md's stamp vs the installed nx-tools; DETECTS + relays, never runs the repair
    └── skills/new-project/
        ├── SKILL.md                          # the scaffolding skill (orchestrator)
        └── assets/
            ├── scaffold.sh                   # thin launcher: resolve Node, docker run, bootstrap + run house generators
            ├── CLAUDE.md.tmpl                # THIN base CLAUDE.md (intentions + conventions + the generated-HOUSE.md pointer), authored by the skill; the house guidance lives in the generated HOUSE.md
            └── nx-tools/                     # @bespunky/nx-tools — house Nx generators, run post-scaffold
                ├── generators.json
                └── src/generators/
                    ├── _utils/               # shared: wire-provider (app.config providers), design-system (tag-based detection)
                    ├── app/                  # the house Angular app (delegates + composes the per-app generators)
                    ├── serve-options/        # sets serve host 0.0.0.0
                    ├── design-system/        # the DS library: tokens (CSS custom properties) + SASS API; ZERO components
                    ├── design-system-styles/ # per-app: sass load path + implicit dependency (cache) + the @use/theme() blocks + provideDesignSystem()
                    ├── ds-component/         # promote a component into the DS as its own secondary entry point
                    ├── devcontainer/         # writes .devcontainer/devcontainer.json
                    ├── house-doc/            # writes the generated HOUSE.md (the always-on directives + the version stamp in its header) + the CLAUDE.md pointer
                    └── claude-settings/      # MERGES the house keys into .claude/settings.json (+ .gitignore) — the project's own hooks/permissions survive
```

To add a skill: `plugins/<plugin>/skills/<name>/SKILL.md`.
To add a subagent: `plugins/<plugin>/agents/<name>.md`.
To add a slash command: `plugins/<plugin>/commands/<name>.md`.
To add a hook: `plugins/<plugin>/hooks/hooks.json` (runs in the sessions of everyone who has the plugin *installed*).
Register new plugins in `.claude-plugin/marketplace.json`.

## Install

```
/plugin marketplace add BeSpunky/claude-toolkit
/plugin install bespunky@claude-toolkit
/plugin install bespunky-project-starter@claude-toolkit
/plugin install bespunky-workflow@claude-toolkit
/plugin install bespunky-engineering@claude-toolkit
/plugin install bespunky-design-system@claude-toolkit
/plugin install bespunky-browser-automation@claude-toolkit
/plugin install bespunky-product-ux@claude-toolkit
```

…or add to `~/.claude/settings.json` so every project sees it:

```json
{
  "extraKnownMarketplaces": {
    "claude-toolkit": { "source": { "source": "github", "repo": "BeSpunky/claude-toolkit" } }
  },
  "enabledPlugins": {
    "bespunky@claude-toolkit": true,
    "bespunky-project-starter@claude-toolkit": true,
    "bespunky-workflow@claude-toolkit": true,
    "bespunky-engineering@claude-toolkit": true,
    "bespunky-design-system@claude-toolkit": true,
    "bespunky-browser-automation@claude-toolkit": true,
    "bespunky-product-ux@claude-toolkit": true
  }
}
```

Skills are namespaced as `bespunky:index`, `bespunky-project-starter:new-project`, `bespunky-product-ux:keep-users-oriented`, `bespunky-product-ux:astonishing-to-use`, `bespunky-product-ux:redesign-means-rethink`, `bespunky-product-ux:distill-the-brief`, `bespunky-product-ux:envision-the-experience`, `bespunky-product-ux:stage-the-vision`, `bespunky-product-ux:mock-to-choose`, `bespunky-product-ux:realize-the-vision`, `bespunky-product-ux:model-intent-not-data`, `bespunky-workflow:branch-and-release`, `bespunky-workflow:feature-package`, `bespunky-workflow:session-handoff`, `bespunky-workflow:local-server-isolation`, `bespunky-browser-automation:playwright`, `bespunky-browser-automation:shared-browser`, `bespunky-engineering:architect-mentality`, `bespunky-engineering:architecture-first`, `bespunky-engineering:advanced-typescript`, `bespunky-engineering:software-design`, `bespunky-engineering:angular-architecture`, `bespunky-engineering:angular-native-wrappers`, `bespunky-engineering:nx-monorepo-and-dx`, `bespunky-engineering:resumable-state`, `bespunky-engineering:typed-reactive-navigation`, `bespunky-design-system:design-system-first`, and `bespunky-design-system:design-tokens-and-theming`. Scaffolded
projects already get a `.claude/settings.json` referencing this marketplace, so the toolkit's skills are
available inside every new project automatically.

## The always-on half

Installing the `engineering`, `design-system`, and `workflow` plugins makes the `architect-mentality`,
`architecture-first`, `design-system-first`, and `feature-package` skills available — but a skill only fires
when the model judges it relevant, which isn't enough for a mindset and rules that must hold on **every**
change. (`feature-package` is the sharpest case: *"where should this doc go?"* is precisely the question a
model never thinks to ask.) So the policy has two halves:

1. **Always-on directives in `CLAUDE.md`** — loaded into context every session, so the mindset and the rules are never out of mind.
2. **The skills** — the depth: `architect-mentality` (the full architect mindset), `architecture-first` (the loop, the patch smells to refuse, the redesign moves), `redesign-means-rethink` (the entry gate to the experience-design trio), `design-system-first` (the styling discipline — the promotion loop, the styling patches to refuse, modelling the missing token), and `feature-package` (one effort, one slug, one folder — where every durable artifact lives, and what may be thrown away).

**New projects** get half (1) automatically — the `new-project` scaffold bakes these directives into the
generated `HOUSE.md` (pointed at from `CLAUDE.md`) and enables the plugins. **Existing projects** that install
the plugins should paste the canonical directives below into their `CLAUDE.md`, so the mindset, the rule, the
redesign discipline, and the design-system discipline are always in context — each is an always-on directive
paired with the depth of its skill:

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

## Design-system-first (non-negotiable)

Every visual value in this workspace comes from the **design system** (`packages/design-system`) — never from the component you happen to be writing. Before you build any feature UI, **go to the design system first** and compose the screen from its components and its tokens. **Never hardcode a style value:** no raw hex/`rgb()`/`hsl()`, no magic `px`/`rem`, no ad-hoc font stack, weight, shadow, radius, duration or easing. Every colour, space, radius, type step, elevation, border, duration and easing is a **token** — a CSS custom property, consumed through the design system's SASS API (`@use 'design-system/styles' as ds;`) — and a component reads **semantic** tokens (`ds.color('on-surface')`), never a raw primitive. A feature component **composes**; it does not invent appearance (its own SCSS should be little more than layout). **The second occurrence of a UI pattern is a promotion, not a copy-paste** — the moment a card, button, panel, field, or layout shape appears twice, lift it into the design system as a reusable component (`nx g @bespunky/nx-tools:ds-component <name>` — one secondary entry point each), migrate **both** sites onto it, and delete the copies. **When the design system lacks the concept you need, model it** — add the token, add the semantic alias, extend the scale, add the component — and **never** work around the gap with a local override, an `!important`, a `::ng-deep` reaching into another component's internals, a duplicated token, or a one-off `variant` boolean. A gap in the design system is a *design gap*; patching it locally is a patch in CSS clothing, and CSS has no compiler to catch the drift — it compounds silently until "change the brand colour" is a four-hundred-file diff. The design system is the **single source of visual truth**: a re-theme, a rebrand, or a redesign must be a change to **tokens**, not to a thousand component files.

For the discipline in full — the loop, the promotion loop, the styling patches to refuse, and what to do when the design system lacks the concept — invoke the **`bespunky-design-system:design-system-first`** skill; for the technique layer (token taxonomy, CSS custom properties, the SASS API, theming and modes, encapsulation, and the design system's entry points) route through **`bespunky-design-system:design-tokens-and-theming`**.

## A feature is a package (non-negotiable)

**Every effort's durable, non-code output lives in ONE folder, named by the effort's slug — the same slug as its branch and worktree.** Invoke `bespunky-workflow:feature-package` for the method; these rules are always on:

- **The package is `docs/features/<YYYY-MM-DD>-<slug>/`** — created **with** the worktree (same slug, `date -u +%F`), not at the end. Skip it only for genuinely trivial work (a typo fix); a package for nothing is noise.
- **Everything durable goes in it** — `BRIEF.md`, `VISION.md`, `STAGING.md`, `DECISION.md` (the design quartet), the throwaway `mocks/`, the effort's `handoffs/` batons, research notes, plans. **Never invent another home**: no `NOTES.md` at the repo root, no folder made up on the spot.
- **Write it AS IT HAPPENS, never afterwards.** A doc written at the end is a memory — reconstructed, tidied, and confidently wrong about exactly the parts that matter (why a design was rejected, which constraint was fatal, what the user actually said).
- **The conclusion is durable; the evidence is disposable.** Decisions and roads-not-taken are committed and permanent. Mocks, spikes, and scratch are **self-ignoring** (a `.gitignore` containing `*`) and **nothing outside them may ever depend on them** — no route, no import, no asset, no config entry — so they can be deleted without breaking a thing. Bin them by default; keep only when the user says so.
- **Quote the user's own words.** The sentence in which they chose, rejected, or corrected something is the most valuable line in the package and settles a dozen later arguments. Never paraphrase it away.
- **Revisiting a feature opens a NEW dated package** with the same slug — read the old one first (it says what was already tried and why), never overwrite it.

The package answers the question the code never can: *six months from now, why was it done this way, and what did we already rule out?*
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

**`.claude/settings.json` is MERGED, not overwritten.** The house re-asserts the keys it owns (marketplaces, `enabledPlugins`, `permissions.defaultMode`) so drift heals; every key it doesn't own — the project's own `hooks`, extra `permissions.allow`, `env`, `statusLine` — survives a repair untouched.

### The repair announces itself (you don't have to remember it)

Claude Code has **no plugin-update hook event**, so `/plugin marketplace update` upgrades the toolkit silently and a project quietly drifts a version behind. `project-starter` closes that gap itself:

- `--repair` **stamps** the project — a marker line in **`HOUSE.md`'s header** (`nx-tools=<v> plugin=<v>`). It lives there because the stamp must reach every clone, and `HOUSE.md` is root-level and unambiguously committed; a stamp under `.claude/` (the conventional home for *local* Claude state) would be one reasonable `.gitignore` line away from vanishing.
- The plugin ships a **`SessionStart` hook** (`plugins/project-starter/hooks/`). Plugin hooks run in the sessions of everyone who has the plugin *installed* — i.e. in your scaffolded project. It orders the stamped `@bespunky/nx-tools` version against the installed one: **same → silent** (a few small file reads, the common case); **installed is newer → it tells Claude**, who relays it and offers the repair.
- **It compares `nx-tools`, not the plugin version** — that package is where the generators come from, so it's the only thing that changes what a repair *produces*. A plugin bump that only touches docs regenerates nothing, and demanding a multi-minute repair for it would train everyone to ignore the notice.
- **Direction matters.** The stamp travels with the repo; the plugin is installed per machine. So a teammate whose plugin is *behind* the project is a normal state, not an error — they're told to run `/plugin marketplace update`, and explicitly told **not** to repair (which would regenerate the project with older generators and stamp it backwards for everyone else).
- **It detects; it never runs.** A repair needs Docker, pulls a base image, runs the house generators and several installs — minutes, and it rewrites generated files. So the hook emits a statement of fact to relay, never an order to obey: **detection is automatic, execution stays consented.** Decline once and Claude records it in the gitignored `.claude/house-snooze.json`, so you're not asked again for that version. No `HOUSE.md` at the root → not a house project → the hook says nothing.

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
