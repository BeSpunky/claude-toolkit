# claude-toolkit

BeSpunky's **one place** for Claude Code skills, subagents, and commands. Develop them here once,
install them into any project, and upgrade everywhere with a single update.

This is a **Claude Code plugin marketplace** (a git repo). It currently ships these plugins:

| Plugin | Provides | Purpose |
| --- | --- | --- |
| `bespunky` | skill `index` | **The toolkit's front door.** `/bespunky:index` is a **self-maintaining catalog**: it lists every installed toolkit skill — grouped by plugin, each with its `/plugin:skill` invocation and a one-line *"use when"* — by reading the **live** available-skills set in the session, so it can never go stale. Every plugin shares the `bespunky-` prefix, so typing `/bespunky` in the slash menu filters the autocomplete to the whole toolkit at once. |
| `browser-automation` | skills `playwright`, `shared-browser` | **Two ways to drive a real browser.** `playwright` — **headless** Chromium (pre-installed) for solo automated work: verify a change end-to-end, reproduce a bug, capture before/after screenshots, scrape the rendered DOM, watch console + network, codegen a test. `shared-browser` — **one live browser you and the human drive together**: they watch and click it in a normal host tab (over noVNC, on a per-container allocated port so parallel devcontainers never collide) while Claude attaches over loopback CDP to the *same* instance — for co-debugging, in-place CSS/DOM verification with **measured** proof (`getComputedStyle`, `getBoundingClientRect`), a real login (OAuth/captcha) completed by the human while Claude observes, and pairing on a flow. A decision tree keeps them distinct: no human watching → `playwright`. |
| `project-starter` | command `sync`, skill `new-project` | Scaffold a new BeSpunky-standard project: integrated Nx monorepo + Angular (clean `--minimal` app) + devcontainer (Claude CLI & VS Code extension) + tailored CLAUDE.md. |
| `product-ux` | skills `keep-users-oriented`, `astonishing-to-use`, `redesign-means-rethink`, `distill-the-brief`, `envision-the-experience`, `stage-the-vision`, `mock-to-choose`, `realize-the-vision`, `model-intent-not-data` | **Experience design.** `keep-users-oriented` — whenever you make someone wait or move them through a process, answer the three questions — *expected result? where am I? next step?* — and pick the right feedback (deterministic → steps/progress; nondeterministic → estimate + notify). A universal service-design principle, expressed primarily through software UI (loading/progress, async, multi-step flows, long-running jobs, notifications, optimistic UI). `astonishing-to-use` — **the UX co-equal force** the trio was missing: a design must be astonishing to *use*, not only to look at (effortless, understandable, no hoops, respectful of attention, a joy in the hand, built for how people *really* hold devices — thumbs, one-handed, distracted, bad signal). The use and the look are two forces that **ping-pong** until both are great — *never a one-way check* — with the **mission setting who leads** (utility → UX leads; brand/art → concept leads, then pressure-tested). Hard bar: **never below great UX**; `keep-users-oriented` is one facet. A **router** (friction & flow; clarity & cognitive load; embodied & contextual use; reconciling art & use; joy of use). `redesign-means-rethink` — the **entry gate**: when asked to *redesign* a UI, treat it as a complete creative reconception *from scratch*, never a reskin of the existing code; the existing implementation has **zero design authority** — read it only *after* the new design exists, to plan teardown/migration — and a redesign runs the trio below from scratch. (A targeted tweak is **not** a redesign.) **The experiential trio — `feeling → Staging → build`, one altitude ladder (sensory feeling → web-native art → engineering):** `envision-the-experience` (the **feeling**) — imagine the *world* an interface lives in before any layout, grounded in the real situation; interrogate every element (a "menu" might become a sunflower whose petals you pick), name no implementation, restraint over spectacle, produce a **Vision**. `stage-the-vision` (the **web-native art** — the visual architect) — the answer to *"grounding stops the bad, but what makes it ART?"* It invents the bold, web-native **moments** that turn the feeling into something you'd screenshot, staying at the **art level**: it speaks the web's language (parallax, cinematic scroll, a character that turns to camera, type-as-image) but says *what artful thing happens and how it feels*, never how to build it. Because a model isn't a native artist, it reaches art by inventing several **bold concepts** and choosing the striking-yet-true, **stealing from specific great work** and adapting its moves, **composing with craft** (focal point, scale, negative space, the cinematic moment), **decomposing each moment to physical truth** (light, shadow, material, depth, texture as they *really behave* — refusing the lone primitive that only symbolizes a phenomenon: warm light is never just a gradient), and sourcing genuine art — grounded so it's not generic, restrained so it's not garish (*bold ≠ loud*), judged by an **outside eye for beauty** (never self-certified). Produces the **Staging** (a bold concept + concrete described moments + a visual system). `mock-to-choose` (the **verdict** — the decision instrument between the art and the build) — a person cannot approve a *look* by reading a description of it, so this puts the concepts in front of their **eyes**: it builds the **cheapest throwaway thing that makes each concept judgeable**, mocks **every option on the table** (one mock asks *"is this OK?"* and gets a weak yes; three ask *"which one?"* and get a real verdict), and shows them **side by side** in a **Compare** wall — with a phone/desktop toggle and a true-size **Focus** view for judging and commenting up close. A mock is **shell and presentation only** — layout, composition, palette, type, atmosphere, dressed in plausible dummy records — with **zero functionality** (dead controls, no state, no routing, no data, no build step, no deps, no app integration). Heavy concepts (a scroll cinematic, a 3D scene, a living background, physically-decomposed light) are **suggested, never rendered** — one representative frame, a still, a flat approximation — vivid enough that the atmosphere is unmistakable, because the point is a fast verdict, not a faithful build. Every variant shares the **same dummy content**, so the only difference the eye sees is the *design*. Every review runs on a shared **harness** — a mini-app shipped with the skill (`assets/mock-harness/`: a **Compare** wall + a true-size **Focus** view + a random-port `serve.sh` that **hot-reloads** on edit) copied verbatim into the mocks folder, so Claude authors **only** `mocks.json` (the question, what's faked, the variants) and one file per concept: **every mock experience is identical and only the mocks change** — the user learns the review once. Because bare low fidelity reads as low *quality*, each mock carries an **intent layer** — floating notes and hover popovers that **narrate the empty house** the way an architect walks a site: *"the sofa goes here, sideways, facing the window"*, *"this dot is the light — it'll float and breathe; here it's a static glow, so judge where it sits and how much of the frame it owns"* — so the user judges the **intent**, never the shortcut. And the mocks are **commentable in place**: the user presses `c` and **clicks the exact spot** to pin a comment right where they point, written to `comments.json` **on disk** with full **DOM context** (tag, text, rect, styles, ancestor path) — so Claude reads them from a *file* (exact words, exact element, exact point, exact variant, exact viewport). Comments run **draft → submitted → handled**: the user **sends** them to Claude (a *Submit review* batch, or an *auto-send* toggle firing each on save), Claude acts on the submitted inbox and **checks each off** — a handled pin **vanishes from the live mock** (which only ever shows the current round's *open* pins) and shows resolved (a green ✓ + reply) in the Focus **side-list**, so the user watches their notes get checked off while the mock stays uncluttered — which means an **asynchronous** review works as well as a co-driven one in the **shared browser** (noVNC, over its own allocated port). The mock iterates in internal **rounds** (v1 → v2 → …): every comment is version-bound to the round it was made against, Claude **commits a round** (snapshotting the mock's HTML) right before re-mocking, and past rounds stay viewable read-only and comparable side by side on a **History** timeline — a built-in, self-ignoring record of what changed and why. The side-list also manages each comment in place (inline **edit**, per-row **send**, **remove** with Undo, row↔pin linking). The verdict is a real **gate, not a poll**: *"none of these"* and *"a hybrid of A and B"* are first-class outcomes (route upstream to re-conceive), and a mock **yes is provisional** — it picks a direction, it does not certify the finished art (`realize-the-vision` still owes the outside-eye pass on the real result). Comments are copied **verbatim** into `DECISION.md`. Mocks live in a standard **dated, feature-scoped package** (`docs/features/<YYYY-MM-DD>-<slug>/mocks/` — inside the effort's **feature package**, the slug shared with the git branch) that is **self-ignoring and completely throwable** (nothing outside may depend on it; one `rm` erases every trace; the user may choose to keep any of it) — while the **decision is recorded durably** (`DECISION.md`), so the conclusion outlives the evidence. Feedback travels **upstream** (re-conceive in `stage-the-vision`) and the mock is re-made cheaply — never polished into a prototype — and **its code never becomes the build**. `realize-the-vision` (the **build**) — the craftsman that turns a Vision *and a confirmed Staging* into a real interface by **researching the truest means before writing any code** — engineers each staged moment, surveys the field (GSAP, Motion, three.js/R3F/angular-three, Web Animations, scroll-driven CSS, View Transitions, Lottie/Rive, Canvas/SVG/WebGL, Web Audio, haptics) and its caveats, **build-vs-source** (figurative art is generated/licensed, never hand-coded into path-soup), requires a confirmed Staging (else invokes `stage-the-vision` first), never self-certifies aesthetics, fans out across subagents against the shared contract with a coherence pass, and verifies against the feeling and the Staging in the running app. Both `stage-the-vision` and `realize-the-vision` are **routers** over reference libraries. |
| `design-system` | skills `design-system-first`, `design-tokens-and-theming` | **Styling as a system.** `design-system-first` — the **discipline**: before you build any feature UI, **go to the design system**; **never hardcode a style value** (every colour, space, radius, type step, elevation, border, duration and easing is a **token** — a CSS custom property consumed through the DS's SASS API; components read **semantic** tokens only, never a raw primitive); feature components **compose** DS components and tokens, they never invent appearance; **the second occurrence of a UI pattern is a promotion, not a copy-paste** — lift it into the DS as a reusable component (`nx g @bespunky/nx-tools:ds-component <name>`, one secondary entry point each), migrate **both** sites, delete the copies; and when the DS **lacks the concept**, **model it** (add the token, the semantic alias, the scale step, the component) — never a local override, `!important`, a `::ng-deep` reach-in, a duplicated token, or a one-off `variant` boolean. The DS is the **single source of visual truth**, so a re-theme or rebrand is a change of **tokens**, not a thousand component files (the styling twin of `redesign-means-rethink`: *re-token, don't re-hardcode*; the styling flavour of `architecture-first`: *never a patch* — and worse there, because CSS has no compiler to catch the drift). Ships an always-on policy the scaffold bakes into every project's imported `HOUSE.rules.md`. `design-tokens-and-theming` — the **techniques**, a **router**: **two layers, one truth** — CSS custom properties are the **runtime** layer (cascading, themeable; a mode is a **re-binding of tokens**, live, never a swapped stylesheet) and the SASS API is the **author-time** layer (zero-output functions/mixins/placeholders, summoned with `@use`, never a global side-effect). Clusters: token taxonomy & naming (primitive → semantic → component; a value not on a scale is a design bug, not a missing token); CSS custom properties as the runtime layer; the SASS API layer & how it's summoned (the public `@forward … show` barrel over `_`-prefixed private folders named for *what they are*; how it resolves in-repo vs published); theming & modes (light/dark/brand, where a mode **lives**, persisting it without a flash, contrast that holds in **every** mode); component styling & encapsulation (`:host`, `::part`, `ViewEncapsulation`, the **`::ng-deep` ban**, variants as data not booleans); the DS library's structure & entry points (one component = one entry point, generator-first). Encodes the **visual system** `stage-the-vision` produces — it doesn't invent the look, it makes the look live in **one place**. |
| `workflow` | skills `branch-and-release`, `feature-package`, `local-server-isolation`, `session-handoff`, `project-standing` · hooks `SessionStart`, `PreCompact` | **Ways of working** — the process, order, and methodology of how work moves from idea to production, independent of *what* is being built. `branch-and-release` — the house git methodology: a one-way promotion pipeline (`feature → development → staging → main`), unrelated work isolated in per-feature worktrees, small committed increments, rebase-and-re-verify at the single divergence point, three human-gated promotions. `feature-package` — **a feature is a package, not a scatter of files**: one effort, one **slug** (the same one that names the branch and worktree), one folder — `docs/features/<YYYY-MM-DD>-<slug>/` — holding everything durable the effort produces that isn't code: `BRIEF.md`, `VISION.md`, `STAGING.md`, `DECISION.md`, the throwaway self-ignoring `mocks/`, and the effort's `handoffs/` batons. Born **with** the worktree and filled *as the work happens* (a doc written at the end is a memory, and memories are where the reasons go missing); every artifact-producing skill writes **into** it instead of inventing a private home. Two rules: **the conclusion is durable, the evidence is disposable** (decisions and roads-not-taken are committed and permanent; mocks and scratch are self-ignoring, depended on by nothing, binned by default), and **the user's own words** are the most valuable line in the package — quote the sentence that settled it, never paraphrase. It answers *"six months on, why was it done this way, and what did we already rule out?"* `local-server-isolation` — bind a **random free port**, never the default/forwarded one the user's own server owns. `session-handoff` — carry a live effort across a context boundary into a fresh session: capture writes a distilled relay baton (into the effort's package), resume re-grounds against reality; the user's **corrections** are captured first-class, and durable ones promoted to persistent memory. `project-standing` — **the cold pick-up**: orient in a project you've been away from, **derived** from git + the feature packages (never a hand-maintained status doc — that's the first thing to rot) — which efforts are live, stalled, or concluded, which baton to read first, live efforts in full and concluded ones collapsed to a one-line conclusion so orienting costs the same at effort #300 as at #3; scopes for on-demand history search and additive archive-sweep. Two **hooks** make continuity reliable rather than hoped-for: a `SessionStart` hook that stays silent unless in-flight work has gone dormant, then relays a fact (detect-don't-execute), and a `PreCompact` hook that writes a mechanical checkpoint into the live effort's package before context is lost — even headless — then asks the model to distill it. |
| `engineering` | skills `architect-mentality`, `architecture-first`, `software-design`, `advanced-typescript`, `angular-architecture`, `angular-native-wrappers`, `nx-monorepo-and-dx`, `resumable-state`, `typed-reactive-navigation` (extensible over time) | **Mindset & discipline (agnostic):** `architect-mentality` — the stack-agnostic mindset of a great architect (mentality only, no techniques): everything is a black box with deliberate connections, place everything on purpose, model the missing concept instead of patching, automate every repeated process, go the extra mile, and more. `architecture-first` — the operational discipline that enforces it: solve every change through design, **never a patch**; fix bugs at the **root cause**; **design + confirm refactors before implementing**; **extract reusable tools** — spot code generic enough to serve other projects and lift it into the shared libraries (or, when sandboxed in a DevContainer, make it extraction-ready and stage it as a candidate) via the house extraction mechanism; ships an always-on policy the scaffold bakes into every project's CLAUDE.md. **Techniques (general / agnostic):** `software-design` — the cross-stack toolbox (decoupling & dependency inversion, replace conditionals with structure, duplication & abstraction, domain modeling, errors & boundaries, contracts & API design); the stack skills below specialize it. **Techniques (TypeScript):** `advanced-typescript` — type-system mastery (derive types from types, declaration merging, template-literal & branded types, type-level diagnostics, guards & assertions). **Techniques (Angular):** `angular-architecture` — modern-Angular patterns (DI/providers, lifecycle, SSR/zone, extensibility, projection, API ergonomics). `angular-native-wrappers` — wrap an imperative/third-party JS API in idiomatic Angular. **Techniques (Nx / workspace & DX):** `nx-monorepo-and-dx` — monorepo architecture & developer experience (boundaries & entry points, module-boundary enforcement, caching & task pipeline, generators & automation, testing setup, release/versioning/environments). **Cross-cutting (state & resumability):** `resumable-state` — make every screen resumable: the **URL as the single source of truth** for navigational/view state (module, opened entity, dialog, edit/create mode, tab, filters — so it's deep-linkable, refresh-safe, back-button-correct) and **working state deliberately persisted** to a chosen home (sessionStorage/localStorage/IndexedDB/server-DB by the state's properties); agnostic principle + decision framework, with the Angular realization (Router params/fragment as state, resolvers, guards, signal↔URL/storage sync) in a reference file. `typed-reactive-navigation` — **navigation is never a raw router call**: per-domain typed navigation services that take **entities, not routes** (the only Router caller — centralizing & strong-typing routes, stripping raw nav from components), **URL-derived route-state selectors** as the reactive read side (so back button / deep link / click all react identically), a **domain event bus** (interactions emit facts, not destinations), and a **pure event→command binding** (multiple events fold into one navigation); cross-domain goes through an app-shell binding. Partners `resumable-state`; scaffold a domain's set with the `domain-navigation` Nx generator. |
| `voice` | command `voice`, skill `voice-conversation`, MCP tool `ask_by_voice`, `SessionStart` + `PreToolUse` + `Stop` hooks | **Hear Claude's questions and answer by voice.** **Speak:** get a **listenable, audio-dedicated summary** of Claude's question — no markup or structure read aloud, just the gist and the options — on demand (`/voice say`; plus `/voice test`, `/voice status`) or **automatically** (`/voice auto on`, **default off**): a `PreToolUse` hook speaks **multiple-choice questions** (`AskUserQuestion`) and **plan approvals** (`ExitPlanMode`), and a `Stop` hook speaks plain **free-text** questions. **Answer:** `/voice answer` records your spoken reply, transcribes it locally, and hands it back — no typing. **Hands-free:** the `ask_by_voice` **MCP tool** + the **`voice-conversation`** skill let Claude ask aloud and **block for your spoken answer** with no command — say *"let's talk by voice"* and it routes questions through the tool, matching your spoken choice (by label, ordinal, or yes/no). TTS is a **swappable boundary** (free `espeak-ng` on Linux / `say` on macOS → local **Piper** neural voice via `scripts/install-piper.sh` → cloud-ready); STT is **local whisper.cpp**, opt-in via `scripts/install-whisper.sh` (`base.en` → `small.en`), and `listen.sh` boosts the mic itself to beat WSLg's low input gain. **Runtime:** a synthesis engine, a player (`paplay`/`aplay`/`afplay`), `node`, a reachable audio sink (the ambient `PULSE_SERVER` — WSLg in the devcontainer), and — to answer — a mic + whisper. After installing, **restart Claude Code once** so the `SessionStart` hook and MCP server load. |
| `communication` | output style `Pitch to the listener` | **How Claude speaks.** Not *what* it decides — *how it says it*. Before composing any response it answers four questions: **what type of conversation are we having**, **what is actually being asked**, **at what depth am I being spoken to**, and **what does this person really need to know**. Those set the pitch — what to lead with, how much detail, which words — and the pitch is a property of *this turn*, so a conversation that zooms (an overview met with a depth question; fine detail met with *"so what's the actual situation?"*) is followed **within** the turn, not after it. **The same questions choose the *shape*:** prose where ideas connect (bullets sever the links a paragraph carries), a table only when 2+ things are compared across 2+ shared dimensions (one column is a list; two rows is usually a sentence), numbered steps only when order is real, headers only when the answer is long enough to navigate, code blocks for anything run or read literally — so a reader can **skim to the part they need** *and* **read it straight through**. Structure must **earn its place**, must **never inflate length**, and must match the **conversation** rather than the content type: a formatted report answering a one-line question is its own failure of pitch. **Asking is governed too:** exactly **one** question per **message** — not one per conversation, so several questions are fine as several *messages*, asked one at a time, each waiting for its answer; never two stacked into one message, where the second gets answered vaguely or missed (and an unknown you can settle yourself isn't a question at all — decide it, state the assumption, move on) — placed **last** with nothing after it — no caveat, no afterthought, no second question — and set off plainly on its own line, because a question folded into a paragraph is one the reader skims past while you block on an answer they never saw you ask for. Two rules hold at every pitch: **never use jargon or an abbreviation assuming it's understood** unless the user reached for it first, and **never assume the user watched you work** — they didn't follow your tool calls, so a bare digested conclusion is a verdict with nothing to attach it to; bridge it with the short path from what you looked at to what it means (scaled to the gap — a long autonomous stretch needs a real bridge, a direct answer needs none). Register is read off **the message**, never off a role or a profile: roles illustrate pitch, they aren't inputs to it. Guards keep it honest — never *name* the register, adapt **altitude never accuracy**, and remember adapting often means saying **less** (over-explaining to an expert is the same failure as jargon at a newcomer). **Presentation only**, and `keep-coding-instructions` keeps Claude Code's built-in engineering behaviour intact, so it can't pull against a project's own always-on rules. Installing makes it **available, not active** — an output style is exclusive (one at a time), so taking that slot stays the consumer's call: `/output-style` or `"outputStyle"` in settings. |

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
│       └── shared-browser/                # ONE live browser the human watches (noVNC, allocated port) while Claude drives it over loopback CDP — co-debugging with measured proof
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
│   ├── hooks/                             # continuity, made reliable rather than hoped-for
│   │   ├── hooks.json                    # SessionStart + PreCompact registrations
│   │   ├── detect-standing.sh            # SessionStart — silent unless in-flight work has gone dormant; then relays a fact pointing at project-standing (detect, don't execute)
│   │   └── checkpoint-on-compact.sh      # PreCompact — writes a mechanical checkpoint (branch, HEAD, uncommitted files) into the live effort's package before context is lost, even headless; asks the model to distill it
│   └── skills/
│       ├── branch-and-release/            # the house git methodology — one-way promotion pipeline, per-feature worktrees, three human-gated promotions
│       │   └── SKILL.md
│       ├── feature-package/               # a feature is a PACKAGE — one effort, one slug, one folder (docs/features/<date>-<slug>/): brief, vision, staging, decision, throwaway mocks, handoff batons
│       │   └── SKILL.md                  # slug shared with the branch/worktree; born WITH the tree, filled as it happens; conclusion durable, evidence disposable
│       ├── local-server-isolation/        # bind a RANDOM free port — never the one the user's own server owns
│       │   └── SKILL.md
│       ├── session-handoff/               # carry a live effort across a context boundary — capture writes the baton into the feature package; resume re-grounds
│       │   └── SKILL.md
│       └── project-standing/              # the COLD pick-up — orient after a gap; DERIVES standing from git + feature packages (never a stored status doc); live/stalled/concluded, which baton to read first; archive tier for scale
│           └── SKILL.md
├── plugins/communication/
│   ├── .claude-plugin/plugin.json
│   └── output-styles/                        # NOT a skill — an output style, loaded from the plugin root automatically
│       └── pitch-to-the-listener.md          # four questions before every response; enters/exits modes and follows the zoom WITHIN the turn; no-jargon + they-didn't-watch-you-work; keep-coding-instructions: true
├── plugins/bespunky-vscode-identity/
│   ├── .claude-plugin/plugin.json
│   ├── hooks/                                # SessionStart: is the window colour still the name-hash placeholder while a design system now exists?
│   │   ├── hooks.json
│   │   └── check-window-identity.sh          # DETECTS + offers the name-hash → design-system re-derive; never runs it
│   └── skills/window-identity/
│       └── SKILL.md                          # the INTELLIGENCE: finds the DS primary + a project emoji, then calls the window-identity generator (the writer lives in nx-tools)
└── plugins/project-starter/
    ├── .claude-plugin/plugin.json
    ├── commands/sync.md                      # /sync — update the toolkit, then run the layered sync on this repo
    ├── hooks/                                # SessionStart: is this project's house tooling behind the installed plugin?
    │   ├── hooks.json                        # registers the hook (startup only — a resume is mid-task)
    │   └── check-house-version.sh            # orders HOUSE.md's stamp vs the installed nx-tools; DETECTS + relays, never runs the sync
    └── skills/new-project/
        ├── SKILL.md                          # the scaffolding skill (orchestrator)
        └── assets/
            ├── scaffold.sh                   # thin launcher: run house generators on the local Node (Docker fallback for old Node), bootstrap + scaffold/sync
            ├── CLAUDE.md.tmpl                # the PROJECT-SPECIFIC half only (intentions + conventions), authored by the skill into the CLAUDE.md house-doc seeded; carries no pointer block
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
                    ├── house-doc/            # writes HOUSE.rules.md (always-on directives, @-imported by CLAUDE.md) + HOUSE.md (how-to + version stamp) + the CLAUDE.md pointer
                    ├── claude-settings/      # MERGES the house keys into .claude/settings.json (+ .gitignore) — the project's own hooks/permissions survive
                    └── window-identity/      # MERGES a per-window VSCode identity (emoji + design-system/name-hash band) into .vscode/settings.json; provenance ratchet in .vscode/.window-identity.json (writer for bespunky-vscode-identity)
```

To add a skill: `plugins/<plugin>/skills/<name>/SKILL.md`.
To add a subagent: `plugins/<plugin>/agents/<name>.md`.
To add a slash command: `plugins/<plugin>/commands/<name>.md`.
To add a hook: `plugins/<plugin>/hooks/hooks.json` (runs in the sessions of everyone who has the plugin *installed*).
To add an output style: `plugins/<plugin>/output-styles/<name>.md` (auto-loaded from the plugin root; *available* on install, active only once selected).
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
/plugin install bespunky-voice@claude-toolkit
/plugin install bespunky-vscode-identity@claude-toolkit
/plugin install bespunky-communication@claude-toolkit
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
    "bespunky-product-ux@claude-toolkit": true,
    "bespunky-voice@claude-toolkit": true,
    "bespunky-vscode-identity@claude-toolkit": true,
    "bespunky-communication@claude-toolkit": true
  }
}
```

**`bespunky-communication` ships an output style, not a skill**, so *enabling the plugin* and
*activating the style* are two different things. **Scaffolded projects get both automatically** — the
`claude-settings` generator enables the plugin and **seeds** `"outputStyle": "Pitch to the listener"`
into `.claude/settings.json`. Installing it by hand anywhere else makes the style *available*; turn
it on with `/output-style` → *Pitch to the listener*, or set the key yourself.

**Seeded, not owned — and the difference matters.** Only **one** output style can be active at a
time, so the house writes `outputStyle` **only when the project has none**. Pick a different style,
or write your own, and `--sync` leaves your choice alone forever after. Every other house key in
that file is re-asserted on every sync; this one is deliberately not, because re-asserting a
behavioural preference isn't maintaining a standard, it's overruling someone who already answered
the question.

Skills are namespaced as `bespunky:index`, `bespunky-project-starter:new-project`, `bespunky-product-ux:keep-users-oriented`, `bespunky-product-ux:astonishing-to-use`, `bespunky-product-ux:redesign-means-rethink`, `bespunky-product-ux:distill-the-brief`, `bespunky-product-ux:envision-the-experience`, `bespunky-product-ux:stage-the-vision`, `bespunky-product-ux:mock-to-choose`, `bespunky-product-ux:realize-the-vision`, `bespunky-product-ux:model-intent-not-data`, `bespunky-workflow:branch-and-release`, `bespunky-workflow:feature-package`, `bespunky-workflow:session-handoff`, `bespunky-workflow:project-standing`, `bespunky-workflow:local-server-isolation`, `bespunky-browser-automation:playwright`, `bespunky-browser-automation:shared-browser`, `bespunky-engineering:architect-mentality`, `bespunky-engineering:architecture-first`, `bespunky-engineering:advanced-typescript`, `bespunky-engineering:software-design`, `bespunky-engineering:angular-architecture`, `bespunky-engineering:angular-native-wrappers`, `bespunky-engineering:nx-monorepo-and-dx`, `bespunky-engineering:resumable-state`, `bespunky-engineering:typed-reactive-navigation`, `bespunky-design-system:design-system-first`, `bespunky-design-system:design-tokens-and-theming`, `bespunky-voice:voice-conversation`, and `bespunky-vscode-identity:window-identity`. Scaffolded
projects already get a `.claude/settings.json` referencing this marketplace, so the toolkit's skills are
available inside every new project automatically.

## Releasing (for maintainers)

Plugin versions are written by **`nx release`**, never by hand:

```bash
nx release version --projects=<plugin-name> --specifier=patch   # then commit
```

Each plugin is an Nx project tagged `type:claude-plugin`; a custom `versionActions` implementation
(`tools/nx-release/`) writes `plugins/<p>/.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json` is
then **derived** from those manifests — so the registry and the manifests cannot disagree. Only `version` is
derived; each entry's description is preserved. `node tools/check-release-invariants/check.mjs` guards the rest
(a plugin whose shipped content changed without a release, a migration registered above the payload version)
and runs in CI and as a pre-push hook.

## The always-on half

Installing the `engineering`, `design-system`, and `workflow` plugins makes the `architect-mentality`,
`architecture-first`, `design-system-first`, and `feature-package` skills available — but a skill only fires
when the model judges it relevant, which isn't enough for a mindset and rules that must hold on **every**
change. (`feature-package` is the sharpest case: *"where should this doc go?"* is precisely the question a
model never thinks to ask.) So the policy has two halves:

1. **Always-on directives, loaded into context every session** — so the mindset and the rules are never out of mind.
2. **The skills** — the depth: `architect-mentality` (the full architect mindset), `architecture-first` (the loop, the patch smells to refuse, the redesign moves), `redesign-means-rethink` (the entry gate to the experience-design trio), `design-system-first` (the styling discipline — the promotion loop, the styling patches to refuse, modelling the missing token), and `feature-package` (one effort, one slug, one folder — where every durable artifact lives, and what may be thrown away).

**New projects** get half (1) automatically. The `new-project` scaffold writes the directives into a generated
**`HOUSE.rules.md`** and has `CLAUDE.md` **`@`-import** it — `@HOUSE.rules.md`, on its own line inside the
generated pointer block — so they are loaded every session. The import is the whole mechanism, and it is worth
being precise about why: **Claude Code loads `CLAUDE.md` and follows its `@` imports; it does not load a file
merely because `CLAUDE.md` links to one.** From 0.5.0 to 0.25.0 these directives lived in `HOUSE.md` behind an
ordinary markdown link, which made them documentation the model had to *choose* to read rather than context it
always had — the always-on half was, in practice, off. The mechanical how-to stays in **`HOUSE.md`** behind
that link, deliberately: it is large, it is needed only once you are already doing the thing, and importing it
would spend context on emulator recipes in every session. `HOUSE.rules.md` is also **layer-gated** — a
non-Angular repo is not handed the redesign directive, and a non-web repo is not told which port not to bind.

**Existing projects** that install the plugins should paste the canonical directives below into their
`CLAUDE.md` (or run `/sync` and let the scaffolder generate both files), so the mindset, the rule, the
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
- **The package has a lifecycle: append while live · distil at the merge boundary · archive, never erase.** State and next-steps are perishable — **append** a new timestamped baton in `handoffs/`, newest wins; decisions are durable — **supersede**, never delete. At the merge/abandon gate, `DECISION.md` gets `status:` frontmatter (`concluded | abandoned | superseded`, `concluded:` date, one-line `summary:`, `tags:`) so a finished effort **collapses to one line** for future readers; once concluded and aged it moves to `docs/features/archive/<year>/` by an additive `git mv` — kept, never deleted. **Never rewrite a past record to look tidy.**
- **Coming back is a skill, not archaeology.** Returning after a gap → **`bespunky-workflow:project-standing`** (the cold front door — derives the standing from git + these packages; there is no hand-maintained status doc). Carrying one live effort into a fresh session → **`bespunky-workflow:session-handoff`** (the hot relay). A `*-auto.md` in a `handoffs/` folder is the PreCompact hook's mechanical checkpoint — distil it into a real baton, then delete it.

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

## The layer model — one tool, any repo shape

**A project is a stack of layers, not one shape.** Each layer has its own detector, its own generators and its own reason to exist, so the same script scaffolds a greenfield Angular+Firebase monorepo *and* adds house DX to an existing plain-TypeScript repo without imposing a framework on it.

| Layer | Detected by | Owns |
| --- | --- | --- |
| `nx` | `nx.json` | The mechanism floor — every house generator runs through `nx g` |
| `agent` | `HOUSE.md` | **Stack-agnostic DX**: devcontainer, Claude settings, window identity, `HOUSE.rules.md` + `HOUSE.md` |
| `js` | `@nx/js`, or any library | `publishable-lib --nonAngular`, tool extraction, `nx release` |
| `web` | any project with a `dev-server`/`serve` target | `serve` composer, worktree domains, shared browser, Playwright |
| `angular` | `@angular/core`, or an Angular build executor | `app`, the Angular dev-server leaf, `angular-ai` |
| `design-system` | the `type:design-system` tag | `design-system`, `ds-component`, `ds-theme`, `secondary-entrypoint` |
| `navigation` | a `navigation-core` project | `navigation-core`, `domain-navigation` |
| `firebase` | `firebase.json` | Emulators, `apps/functions`, apphosting, env files |

**Detect** (what the workspace *has*, read from the workspace — never declared) and **ensure** (`--ensure=<csv>`, what this run should *bring into being* — always explicit) are kept strictly apart. A sync ensures nothing by default: refreshing house tooling and turning someone's library into an Angular app are different requests. **The scaffold is a sync with a full ensure set against an empty directory** — one rendered command sequence serves both, so they can't drift.

Every house generator states its layer as a precondition, so running one where it doesn't apply gives a sentence you can act on instead of a module-resolution stack trace from inside a delegated Nx generator:

```text
[design-system] needs the `angular` layer (Angular application), which this workspace does not have.
  present: nx, agent
  add it with: `nx add @nx/angular`, then `nx g @bespunky/nx-tools:app apps/<name>`
```

**Retrofit any repo with just the DX layer:**

```bash
bash <path-to>/scaffold.sh --sync --ensure=agent [--yes] <project-path>
```

`nx init` creates the Nx workspace in place if there isn't one (plus `@nx/devkit`, which an `nx init` workspace doesn't ship), then the agent layer lands: devcontainer, `.claude/settings.json`, window identity, `HOUSE.rules.md` + `HOUSE.md` (and a seeded `CLAUDE.md` if the repo has none, so the pointer has a home). No Angular, no design system, no dev-loop tooling — none of those layers is present or requested, and the generated `HOUSE.md` renders only the sections that apply.

**It uses YOUR package manager.** A scaffold sets the house standard (yarn); a sync does not get that choice — the package manager is a decision the project already made, encoded in a lockfile its team and its CI depend on. `packageManager` (corepack) wins, else the lockfile decides, and every install/exec/add in the run goes through it. Running `yarn install` in an npm repo doesn't switch it, it produces a **second lockfile** — after which `npm ci` starts failing for everyone, caused by a tool someone ran once to get a devcontainer. When a repo genuinely declares nothing, the house default is chosen *and written down before `nx init` runs*, because `nx init` picks its own (npm) and takes no flag to say otherwise — so without that, the no-signal case produced two lockfiles from the other direction. Verified end-to-end on npm, pnpm-workspace, and no-signal repos: one lockfile each, scripts/deps/versions untouched.

**It does not overwrite what the repo already owns.** An existing `devcontainer.json` is **merged additively** — its image, name, `postCreateCommand`, features and comments survive. An existing `post-create.sh` is **never touched**; the house script lands beside it as `post-create.bespunky.sh` with the one line needed to chain them. `CLAUDE.md` gets only its marker-delimited pointer. And `.devcontainer/post-create.local.sh` is created once, never regenerated, and runs last: the seam for project-specific setup that survives every future sync.

**Ownership is explicit, and the divergence is recorded.** `.devcontainer/.bespunky-devcontainer.json` carries an `owned` flag — a devcontainer this generator wrote is regenerated on every sync; one it adopted is merged into, for good. (Ownership is *not* inferred from the marker merely existing: that made the run after an adoption believe it owned the file and overwrite the merge, so the guarantee held for exactly one run.) When adopting, the marker also carries an **adoption report** — the keys where the project's value genuinely differs from the house value, so the permanent divergence an additive merge creates has a surface instead of a log line that scrolled past:

```jsonc
{
  "generator": "@bespunky/nx-tools:devcontainer",
  "owned": false,
  "adopted": {
    "note": "…house settings are only ADDED, never changed…",
    "skipped": ["name"]
  }
}
```

It lists *divergences*, not merely keys that exist — so it converges (a key the last sync added is not re-reported as skipped) and stays short enough to act on.

## How the scaffolder works

`scaffold.sh <project> [app]` is a thin launcher. **Docker was never the requirement — a modern Node is.** When the local Node is new enough (22.18+, e.g. inside a devcontainer) it runs the generators **natively** — no daemon, no image, no mounts — so it works with no Docker at all; otherwise it falls back to running everything **inside the base image via `docker run`** (as your uid, mounting `~/projects`) so an old host Node is no obstacle. `--docker` forces the image; either way there's no nvm. This mirrors `tools/publish-nx-tools`.

1. On the Docker fallback, resolves the newest `mcr.microsoft.com/devcontainers/typescript-node:<major>` tag (the Node source); the native path uses the running Node.
2. Bootstraps the workspace:
   - `yarn create nx-workspace <project> --preset=apps --packageManager=yarn --nxCloud=skip --no-interactive`
   - `yarn nx add @nx/angular`
   - `yarn nx g @bespunky/nx-tools:app apps/<app>` — the **house** app generator, not raw `@nx/angular:application`: it delegates to it with the house defaults (`--minimal --style=scss --routing --e2eTestRunner=none`) *and* applies the per-app config (`serve`, `serve-options`, and the Firebase wiring under `--firebase`). It is the same one command used to add any later app, so the first app and the Nth can't drift.
3. Installs `@bespunky/nx-tools` from **npm** as an exactly-pinned devDependency (a real install, not a copy into `node_modules` — see *Migrations* below for why that distinction is load-bearing) and runs the **house generators** — every config change is Nx-native (devkit `Tree`), no hand-rolled file edits. The **per-app** generators (`serve`, `serve-options`, `firebase-emulators`) are not in this list: the `app` generator above already applied them. The workspace-level ones are each gated on the layer they belong to:
   - `nx g @bespunky/nx-tools:devcontainer --name=<project> --nodeMajor=<major>` `[--firebase=true]` → `.devcontainer/devcontainer.json` (Claude CLI/extension, `.claude` persistence, **`CHOKIDAR_USEPOLLING`/`CHOKIDAR_INTERVAL`** for WSL/Docker file-watching, postCreateCommand pre-installing the toolkit plugins; with `--firebase=true`, adds the Firebase CLI + Google Cloud CLI features, the `toba.vsfire` extension, and labeled `portsAttributes` for the emulator suite — but **no explicit `forwardPorts`**: VS Code auto-detects every container binding and forwards each to a free host port, so multiple devcontainers can run in parallel without colliding on the same host port; and with `--voice=true`, bridges WSL2's **WSLg PulseAudio** into the container — `remoteEnv.PULSE_SERVER = unix:/mnt/wslg/PulseServer` + a `/mnt/wslg` bind mount — which `post-create.sh` then detects to install the `espeak-ng` TTS floor + `pulseaudio-utils` and pre-install the `bespunky-voice` plugin, so `/voice` speaks the moment the container opens)
   - `nx g @bespunky/nx-tools:claude-settings` → `.claude/settings.json` (marketplaces + enabled plugins incl. `bespunky-browser-automation@claude-toolkit`)
   - `nx g @bespunky/nx-tools:window-identity --name=<project>` → a per-window VSCode identity in `.vscode/settings.json` (emoji in `window.title` + a quiet status-bar band), so this project's window is distinguishable from every other open one. Runs **before** the design system, so the colour is a stable hash of the project **name** (distinct per project from moment zero); it upgrades to the real design-system primary later via the `bespunky-vscode-identity:window-identity` skill (offered by that plugin's `SessionStart` hook). Merges — the project's own VSCode settings survive — and a provenance marker (`.vscode/.window-identity.json`) keeps a `--sync` from ever downgrading a design-system or hand-picked colour back to the placeholder.
   - `nx g @bespunky/nx-tools:playwright` → adds `@playwright/test` as a devDependency so the devcontainer's `post-create.sh` runs `playwright install --with-deps chromium` (Chromium + apt deps) on container build. Browser binary cached in a per-workspace Docker volume so rebuilds don't re-download. Always-on for BeSpunky projects; pairs with the `bespunky-browser-automation:playwright` skill (loaded via the plugin) which covers when to choose Playwright vs. the preview / Chrome MCPs and how to write headless scripts.
   - **Where the `firebase` layer is active:** `nx g @bespunky/nx-tools:firebase-emulators --project=<app> --workspaceName=<project>` → `firebase.json` (emulator suite + `singleProjectMode`); **no `.firebaserc`** is fabricated — cloud-project linkage is the Firebase CLI's job (`firebase use --add` after `firebase login`); each emulator Nx target passes `--project=demo-<name>` so emulators work without login or a real project. Generates the env files `apps/<app>/src/environments/{environment.interface.ts, environment.ts, environment.prod.ts}` (Angular's canonical environment-files pattern — emulator config in the dev file, real Firebase web config placeholders in the prod file, shared `Environment` type in the interface; user-customizable values live here, the generator preserves `environment.ts` / `environment.prod.ts` across re-runs), writes `apps/<app>/src/app/firebase.config.ts` to the canonical shape that reads from `environment` and gates **each service independently** on `committed-default ⊕ runtime-override`, the whole thing behind **`ngDevMode`** — Angular's dev-mode flag, which the optimizer folds to `false` so every `connect*Emulator(…)` call tree-shakes out of the production artifact. Deliberately **not** `!environment.production`: that is a const-object property, the esbuild builder does not reliably inline it, and emulator code survived into prod bundles as a result (verified by grepping one). The file is written when absent and rewritten when the generator detects an outdated shape — the ancient two-consts shape, the pre-per-service whole-block shape, or a per-service file predating the `ngDevMode` gate — so `--sync --firebase` self-heals old projects; once it is on the current shape, `--sync` leaves it alone to preserve any app-specific customizations you've added — custom `messagingSenderId`, `initializeFirestore` options, etc., registers the `environment.ts` → `environment.prod.ts` `fileReplacements` on the production build configuration (idempotently), best-effort AST wiring into `app.config.ts`, and the **workspace-level** emulator project `firebase/project.json` (`emulators`, `emulators:<svc>` for auth/firestore/storage/functions, `seed:build`, `reset`), which the app's unified `serve` target composes in as its optional layer — `nx serve <app>` brings up the suite + the app under one Ctrl+C, `--no-emulators` serves the app real. Rescuing an older project's shape onto that one is a **migration**, not generator healing — the rungs that touch this area are `0.24.0/unify-serve-targets`, `0.24.1/relocate-emulator-targets`, `0.24.2/carry-legacy-firebase-prod-config` and `0.24.3/upgrade-emulator-environment-shape` (the full ladder is `migrations.json`, which is the registry *and* the documentation — don't read it off a list in prose). The one to know about is `0.24.3`, because its absence fails **silently**: `firebase.config.ts` gates each service on `environment.emulators?.<svc>?.default ?? false`, and a pre-toggle environment file (bare endpoints, no `default` key) makes every one of those reads fall through to `false`, so the dev app quietly talks to the **real** Firebase backend holding `demo-*` credentials — no compile error, just `auth/api-key-not-valid` and no clue why. The migration rewrites the values *and* `environment.interface.ts` in place, preserving each service's own host/port, and is all-or-nothing per `src/environments` directory because the values and the interface type each other (see *Migrations* below). It also **adds `firebase` + `@angular/fire`** (plus the Functions runtime deps) to `package.json`, installed post-commit via Nx's `installPackagesTask`. (No shell-side `yarn add` — the generator owns deps.)

**Firebase support is opt-in.** Pass `--firebase` to `scaffold.sh` to enable the full setup (devcontainer features + emulator config + Angular environment files + Nx targets). Never enabled by default — only when the user explicitly asks for Firebase or the scaffolding agent asks and they say yes.

**Voice support is opt-in (WSL-only).** Pass `--voice` to `scaffold.sh` to make hands-free voice work in the new project's devcontainer. One flag wires all three halves: the `devcontainer` generator bridges WSL2's **WSLg PulseAudio** server (`remoteEnv.PULSE_SERVER` + a `/mnt/wslg` bind mount), and the devcontainer's `post-create.sh` **self-adapts on that mount's presence** to install the free **espeak-ng** TTS engine + `pulseaudio-utils` and pre-install the **`bespunky-voice`** plugin at project scope — so `/voice` speaks on first open. The natural neural voice (**Piper**) stays a manual, machine-local upgrade via the plugin's `install-piper.sh`. It's opt-in rather than always-on (unlike Playwright/shared-browser) because the `/mnt/wslg` mount source is **WSL-specific** — binding it on a non-WSL host (macOS, Codespaces) has no source socket. Because post-create keys off the mount rather than a second flag, `--sync --voice` retrofits voice onto an existing project too. Never enabled by default.

**Sync an existing project** — bring it up to the current house standard: **probe** where the project actually is (before anything is written), install the pinned `@bespunky/nx-tools`, run the versioned **migrations** from the probed version, detect the layers, and re-apply the generators (useful if a previous scaffold was incomplete, after upgrading the toolkit, or to retrofit `--firebase` onto an existing project):

```
bash <path-to>/scaffold.sh --sync [--ensure=<layers>] [--firebase] [--voice] [--local] [--yes] <project-path-or-name> [<app-name>]
```

For the project you're sitting in, the ordinary way to run it is the **`/sync` command** (it updates the toolkit plugins first, then syncs `.`).

**Sync runs wherever you are — including inside the project's own devcontainer** (it uses the local Node natively there, no Docker), so a Claude session *at the project* is the right place to run it; it only falls back to `docker run` when the local Node is too old. **Sync refuses to run unattended.** It rewrites generated files and takes minutes — so on a TTY it prompts you, with no TTY (an agent's shell) it aborts unless `--yes` is passed, and in CI it refuses outright. `--yes` *asserts that a human explicitly agreed*; an agent may pass it only after you actually said so. That gate is what makes the hook's "detect, never execute" boundary structural instead of a promise.

**Important: the house guidance is two generated, syncable files.** `--sync` regenerates **`HOUSE.rules.md`** (the always-on directives, `@`-imported by `CLAUDE.md` so they are in context every session) and **`HOUSE.md`** (the mechanical how-to — serving, Firebase, Nx, browser tooling — read on demand) in full every run, and upserts a bounded pointer to it in `CLAUDE.md` — the only part of `CLAUDE.md` it touches. The user's own `CLAUDE.md` content (intentions + conventions) is preserved verbatim. Everything else (devcontainer files, `.claude/settings.json`, `project.json`, `package.json` devDeps, Firebase config files) is brought up to current spec by the generators. So a toolkit upgrade reaches an existing project entirely through `--sync` — **no hand-merge** (see the `bespunky-project-starter:new-project` skill's §1b).

**A sync that changes the devcontainer needs a REBUILD to take effect.** `--sync` rewrites `.devcontainer/devcontainer.json` and `post-create.sh`, but mounts, `runArgs`, `containerEnv` and container-scoped editor settings are applied at container *creation* — so after a sync that touches them, run **Dev Containers: Rebuild Container**. Skipping it isn't fatal (the tooling degrades rather than fails), but the new capability isn't there yet: the shared browser's `bespunky-shared-ports` registry volume, for instance, only exists after a rebuild, so until then parallel containers can't see each other's noVNC port claims and `shared-browser up` says so on stdout.

**`.claude/settings.json` is MERGED, not overwritten.** The house re-asserts the keys it owns (marketplaces, `enabledPlugins`, `permissions.defaultMode`) so drift heals; every key it doesn't own — the project's own `hooks`, extra `permissions.allow`, `env`, `statusLine` — survives a sync untouched.

### Migrations — how a one-way change reaches an existing project

A sync used to be pure **convergence**: every generator re-ran and re-asserted the desired state. That works for a file the toolkit owns outright, and not at all for a *change of shape* — a renamed target, a project moved from the app to the workspace, a retired build configuration. Convergence handled those by making every generator recognise every shape the toolkit had ever produced, forever; each one became a museum, and each new shape added an exhibit to all of them.

So one-way changes now ship as **versioned migrations**, collected and ordered by **native `nx migrate`**:

- They live in the payload at `assets/nx-tools/src/migrations/<version>/<name>.ts`, are declared in `migrations.json`, and are exposed to Nx through the package's `nx-migrations` key. A project three versions behind walks the ladder in order, once — and the generators shed their legacy-healing code in exchange.
- **`@bespunky/nx-tools` is a real npm devDependency of the project, pinned exactly** — no longer copied into `node_modules`. The copy is what made migrations impossible: `nx migrate` decides what a project needs by reading the version *resolved out of `node_modules`*, which a copy always answered with the newest one, so the ladder was always empty. The pin is exact for the same reason a caret would break it — an ordinary install could float the version with no migration behind it, after which the migrator believes the project is already there.
- **The sync PROBES first, then installs, then migrates.** Full order: **probe** → ensure the Nx workspace → install → **migrate** → detect layers → run the generators → `house-doc` last (it writes the stamp, so it must see the final layer set). The probe runs before anything is written, while `node_modules` still holds what the project *had*, and works out where the project actually is from two sources: the version resolved in `node_modules` and the `nx-tools=` version stamped in `HOUSE.md`. It takes the **older** of the two as the floor to migrate from — because every project scaffolded before this release declares the old **caret** range, so a plain install has already floated `node_modules` to the newest published version with **no migration behind it**. Believe that number and the sync collects nothing, reports success, and lets `house-doc` stamp the project as current — closing the gap over permanently, since the stamp is what every later sync then trusts. The same pair answers the opposite question with the **newer** of the two: if either source says the project has been above the version this toolkit installs, the sync **refuses outright, before the install** — that is a downgrade, and migrations do not walk backwards. The ladder then runs with an **explicit `--from`** taken from the probe, and that is what freed the ordering: the range no longer depends on whatever `node_modules` happens to resolve, so the install goes first.
- **`--local`** packs the working tree (`npm pack`) and installs *that* instead of the published package — the same real install, different origin — so a toolkit change can be exercised against a real project before it reaches npm.
- **A migration CLEANS UP after itself.** Writing the new state is half the job; the migration is done only when the old state is *gone* — the retired target/config/file deleted, every reference to a moved path retargeted (a path move is a rename, so this includes all the references the toolkit never wrote: a jest `moduleNameMapper`, an eslint glob, a `.vscode` `scss.includePaths`, a `workspaces` glob, a README), and data that was *carried* somewhere new cleared from where it used to live, so the migration doesn't mint a second source of truth. Where a deletion would be a **guess** — a filename a project may legitimately be using for its own purposes, a declaration something else may still read — it is left in place and **reported by name with its reason**, never silently: an unexplained leftover is indistinguishable from an oversight. A migration that only adds is how a workspace accumulates clutter nobody dares remove.
- **Every payload release ships the migrations it owes.** Before a version goes out, each change in it is asked one question: *does this alter a shape existing projects already have?* "Nothing to migrate" is a common and legitimate answer — a new generator, a new layer, a fix to an owned template artifact that every sync regenerates anyway — but it is a *stated finding*, not a default, because the failure is silent and permanent: a project installs the new tooling, the ladder collects nothing, and `house-doc` stamps it current on the way out, sealing the gap behind a stamp every later sync believes.

Three classes of generator output live side by side, and which one a file is decides what a sync does to it:

| Class | Examples | What a sync does |
| --- | --- | --- |
| **Owned template artifacts** | `tools/shared-browser/*`, `tools/worktree-domains/*`, `HOUSE.rules.md`, `HOUSE.md`, `post-create.sh`, a devcontainer the generator owns | **Regenerated every sync** |
| **Project state** | `project.json` targets, deps, `firebase.json`, env files | **Created at baseline, then evolved only by migrations** |
| **Seeded, never owned** | design tokens, `environment.ts`, `ds-theme`, `post-create.local.sh` | **Written once** — these are what the project is expected to replace |

### The sync announces itself (you don't have to remember it)

Claude Code has **no plugin-update hook event**, so `/plugin marketplace update` upgrades the toolkit silently and a project quietly drifts a version behind. `project-starter` closes that gap itself:

- `--sync` **stamps** the project — a marker line in **`HOUSE.md`'s header** (`nx-tools=<v> plugin=<v> layers=<csv>`). The layer list is a *record* of what was applied, never an input to a later decision (a sync always re-detects): its value is **drift** — a workspace that now has `firebase.json` but whose stamp doesn't list `firebase` grew a layer whose house tooling was never applied, and the hook says so. It lives there because the stamp must reach every clone, and `HOUSE.md` is root-level and unambiguously committed; a stamp under `.claude/` (the conventional home for *local* Claude state) would be one reasonable `.gitignore` line away from vanishing.
- The plugin ships a **`SessionStart` hook** (`plugins/project-starter/hooks/`). Plugin hooks run in the sessions of everyone who has the plugin *installed* — i.e. in your scaffolded project. It's silent in the overwhelmingly common case (a few small file reads) and otherwise emits exactly one of **four** notices:
  - **the toolkit moved on** — the installed `@bespunky/nx-tools` is newer than the project's stamp (or the project predates stamping, or carries a stamp that can't be ordered — a prerelease). Relay and offer the sync.
  - **this machine is behind** — the *stamp* is newer than the installed plugin. An ordinary state (a teammate, a second machine, a CI checkout), and the notice says plainly **do not sync**; update the plugin instead.
  - **a layer drifted** — the workspace has grown a layer (`nx add @nx/angular`, a new `firebase.json`) that the stamp's `layers=` list doesn't record, so that layer's house files were never applied.
  - **the declared dependency is ahead of the stamp** — and this one is the sharpest, now that migrations exist. A project whose `package.json` still carries the old **caret** range can float `@bespunky/nx-tools` to a newer published version on any plain install, with no generator run and no migration behind it: the project then *runs* new tooling against files still shaped for the old. The stamp records what was actually applied, so ordering the two is the only way to see it — and a sync is what reconciles them, by running the migrations from the stamped version forward.
- **It compares `nx-tools`, not the plugin version** — that package is where the generators come from, so it's the only thing that changes what a sync *produces*. A plugin bump that only touches docs regenerates nothing, and demanding a multi-minute sync for it would train everyone to ignore the notice.
- **Direction matters.** The stamp travels with the repo; the plugin is installed per machine. So a teammate whose plugin is *behind* the project is a normal state, not an error — they're told to run `/plugin marketplace update`, and explicitly told **not** to sync (which would regenerate the project with older generators and stamp it backwards for everyone else).
- **It detects; it never runs.** A sync re-runs the house generators and several installs — minutes, and it rewrites generated files. So the hook emits a statement of fact to relay, never an order to obey: **detection is automatic, execution stays consented.** Decline once and Claude records it in the gitignored `.claude/house-snooze.json`, so you're not asked again for that version. No `HOUSE.md` at the root → not a house project → the hook says nothing.

The `new-project` skill then fills in the project-specific half of the seeded `CLAUDE.md` (the one piece that stays contextual, not a template).

The generated `.devcontainer/devcontainer.json` **pre-installs this marketplace on build** via its
`postCreateCommand` (`claude plugin marketplace add BeSpunky/claude-toolkit`, then `claude plugin install
… --scope project` for each of the eight house plugins — `bespunky`, `bespunky-project-starter`,
`bespunky-engineering`, `bespunky-workflow`, `bespunky-browser-automation`, `bespunky-product-ux`,
`bespunky-design-system`, `bespunky-vscode-identity`; `bespunky-voice` is installed separately, only when the
WSLg audio bridge is present), so the toolkit's skills/agents are live the moment the container comes up. Declaring `enabledPlugins` in settings alone does **not** auto-install — the CLI step
is what makes it immediate inside the container; on the host, the settings declaration offers a one-click
install on first run.

> **Generator-first, manual last.** A literal `angular-*` preset always forces a demo app (verified
> against Nx source), so we use `apps` + `nx add @nx/angular` + a `--minimal` app — the only one-shot
> path to an Angular workspace with no demo content.
