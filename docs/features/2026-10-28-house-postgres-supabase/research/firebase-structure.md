# Firebase layer: present shape, as code

Research for the `postgres` and `supabase` layer design. Covers the code as it stands on `feat/house-postgres-supabase` (2026-11-04). Read from source; nothing was executed. Line counts are `wc -l`. Where a number is my judgment rather than a measurement, it says so.

Path shorthand: `S/` = `plugins/house/engine/nx-tools/src`, `G/` = `S/generators`, `FE/` = `G/firebase-emulators`.

## 1. Anatomy

### Re-measuring the handoff's "about 5,500 lines"

The handoff's number reproduces only for its stated scope, and that scope leaves out a lot:

| Scope | Lines |
|---|---|
| `FE/*` (generator, templates, helpers) | 5,183 |
| `G/firebase-client/*` | 82 |
| `S/layers/firebase.ts` | 184 |
| `S/adapters/angular/firebase-client.ts` | 108 |
| **Handoff scope: reproduces its claim** | **5,557** |
| `adapters/angular/angularfire.ts` + `angularfire-judge.ts` (the rest of the Angular port) | 658 |
| `G/ci/firebase-provider.ts` + `setup-gcp.sh.tpl` | 563 |
| `_utils/firebase-compat.ts` + `gcloud-archive.ts` (generated) | 244 |
| `tools/firebase-compat/project.mjs` | 416 |
| `G/devcontainer/post-create/firebase-banner.sh.tpl` | 17 |
| `skills/firebase-app-hosting/` (SKILL + reference) | 160 |
| `HOUSE.md.tpl` Firebase block, lines 186-430 | about 245 |
| **Everything Firebase ships** | **about 7,860** |
| Tests: `test-firebase-tools` 285, four `test-generators` cases 767, eight `test-scaffold` scripts 1,160 | 2,212 |
| Migrations: 26 of 53 registered rungs mention Firebase or emulators, in 10 of 25 version folders (0.24.0-3, 0.25.0, 0.27.0, 0.33.0-1, 0.35.0, 0.50.0) | 6,085 |

The migrations weigh more than the layer. A new layer owes none on day one, so that is the iteration cost the design is trying to avoid.

Two things are excluded because they are not Firebase's own, though Firebase depends on them or brings them:
- The dev engine `tools/dev` (`G/dev/files/*`), 2,494 lines. Firebase's stack identity lives here.
- The platform firewall `S/platform/*`, 1,500 lines. Only Firebase brings it (`FE/generator.ts:431-449`).

### The tree

```
S/layers/firebase.ts (184)               descriptor: requires, evidence, steps, docSections, ciDeploy, devFragment, gitignore, devcontainer
G/firebase-client/generator.ts (51)      per-app step: portOf(...,'firebase'), tag platform:web, client.attach()
G/firebase-client/schema.json (31)
S/adapters/angular/
  firebase-client.ts (108)               FirebaseClientPort for Angular: env files, glue, proxy, providers, SDK
  angularfire.ts (380)                   which @angular/fire and firebase; Tree I/O
  angularfire-judge.ts (278)             pure pairing judge, also loaded by engine/house-probe.mts
G/firebase-emulators/
  generator.ts (877)                     THE CORE: firebase.json, gitignore, writes every tool, 2 projects, firewall, deps
  schema.json (40), homes.ts (15), skill-pointers.ts (15)
  LAUNCH  (1,025)
    emulators.sh.tpl (644)               claim → prime → start; keeper; id; secrets; live env watch
    emulator-data.sh.tpl (67)            ensure/reset of .emulator-data from a seed
    emulator-ports.ts (102)              generator's reader of the port table
    emulator-ports.mjs.tpl (104)         runtime's reader: ports / shift / claim
    suite-ports.json (21)                the table: defaults, alwaysOn, nested
    dev-fragment.ts (87)                 the `emulators` process for dev.json
  GUARDS  (957)
    emulator-project.mjs.tpl (249)       offline demo- id; evaluates environment.ts; align-storage
    emulator-secrets.cjs.tpl (589)       port of Firebase dotenv; inert placeholders; sandbox; sink probe; push-entries
    push-secrets.sh.tpl (84)             .secret.local → Secret Manager, stdin only
    functions-esbuild.config.cjs.tpl (19), functions-secret.local.example.tpl (16)
  SEED  (309)
    seed-world.mjs.tpl (60)              C: the data
    seed-apply.mjs.tpl (112)             A: REST applier, refuses unless told where
    seed-build.mjs.tpl (23)              A: one world through the applier
    seed-build-seeds.sh.tpl (79)         A: own stack, emulators:exec, export to tools/emulator-seeds/
    emulator-seeds-README.md.tpl (35)    C
  DEPLOY  (569)
    firebase-deploy.mjs.tpl (187)        runner + "the road to a first deploy"
    firebase-deploy-rules.mjs.tpl (136)  rules/indexes from firebase.json; refuses unwatched; skips seeds
    firebase-welcome.sh.tpl (72)         self-extinguishing login-shell nudge
    apphosting-config.ts (83), apphosting.yaml.tpl (39), apphosting.staging.yaml.tpl (16)
    firestore.rules.tpl (19), storage.rules.tpl (17)
  FUNCTIONS APP  (61)                    main.ts, package.json, 2 tsconfigs
  CLIENT TEMPLATES  (1,315)              firebase*.config.ts (5), environment*.ts (4), emulator-overrides, proxy.conf,
                                         proxy.local, service-configs.ts, proxy-wiring.ts
G/ci/firebase-provider.ts (101), setup-gcp.sh.tpl (462)    CiDeployProvider: WIF keyless deploy
G/_utils/versions.ts (lines 36, 46, 49-50)                 FIREBASE_TOOLS_VERSION, GCLOUD_CLI_VERSION, ADMIN, FUNCTIONS
G/_utils/firebase-compat.ts (227), gcloud-archive.ts (17)  generated tables
G/devcontainer/post-create/firebase-banner.sh.tpl (17)     /etc/profile.d hook for the welcome banner
G/house-doc/HOUSE.md.tpl:186-430, HOUSE.rules.md.tpl:84-89,133-141   docs
plugins/house/skills/firebase-app-hosting/                 App Hosting only
plugins/workflow/skills/local-server-isolation/reference/firebase-emulators.md
tools/firebase-compat/, tools/test-firebase-tools/, .github/workflows/{firebase-tools-tripwire,upstream-tables}.yml
```

### Inherent versus reusable (judgment, by reading each file against the 5,557)

| Share | Lines (approx.) | What |
|---|---|---|
| Inherent to Firebase: leave behind | 3,900 (70%) | Client glue 1,505. The keeper, hub TMPDIR, `--only` derivation and real-service logic in `emulators.sh`, about 430. Demo id 249. Firebase dotenv and sink, about 500. Port table and readers 227. Firestore REST applier 112. Functions app, App Hosting and rules 235. Firebase parts of `generator.ts`, about 560. Descriptor, about 120. |
| Pattern: same shape, new code | 1,300 (23%) | Launch funnel, data lifecycle, seed split, push-secrets, deploy runner and road, welcome, descriptor skeleton, dev fragment. |
| Extractable as is | 300 (5%) | Gitignore-block loop, deploy-contract constants, `watchedFiles`/`unwatchedBy`, firewall insertion, `nx()`. |

The large reusable mass is **already outside this count**, and Firebase consumes it through seams: `tools/dev` (2,494), `ensureHouseProject` and three-way target merge (`_utils/project-files.ts`, `house-targets.ts`, 605), devcontainer composition, the planner, the `ci` layer, `declareDependencies`, plugin pointers. So "copy the layer" is the wrong frame: reuse the seams and rewrite about 1,300 lines of pattern. The handoff's instinct that a backend-held connection removes most of it holds up in the numbers.

## 2. What a consumer gets from `add-layer firebase`

A = owned, rewritten every upgrade. B = project state, moved only by a migration. C = seeded once, never rewritten. Anchors are `FE/generator.ts` unless stated.

| Path | Class | Notes |
|---|---|---|
| `firebase.json` | mixed, per key | `emulators`, `functions` A (:342-343, edited in place :347). Every other key B. `firestore`/`storage` only by `--seedRules`, then B. |
| `.firebaserc` | never written | Human only (`firebase use --add`). Deliberate (:11-18). |
| `apphosting.yaml`, `apphosting.staging.yaml` | C | Client app only; `--staging` for the second (:357-363). |
| `.gitignore` | appended by marker | Four blocks (:371-380), plus `dist` via the descriptor (`layers/firebase.ts:104`). |
| `firebase/project.json` | A, merged | The suite project. Targets go through a three-way merge against `.bespunky/house-targets.json`, not overwrite (`_utils/house-targets.ts:1-35`). |
| `firebase/firestore.rules`, `storage.rules` | C | Only when the run creates the layer. Deny-all and marked; the deploy skips marked files (:851-877, `firebase-deploy-rules.mjs:83-87`). |
| `<appsDir>/functions/project.json` | A, merged | Same merge. |
| `<appsDir>/functions/{package.json,tsconfig.json,tsconfig.app.json,src/main.ts,.secret.local.example}` | C | :600-615, :681-691. |
| `tools/emulators.sh`, `emulator-data.sh`, `emulator-ports.mjs`, `emulator-project.mjs`, `emulator-secrets.cjs`, `functions-esbuild.config.cjs`, `push-secrets.sh`, `firebase-welcome.sh`, `firebase-deploy.mjs`, `firebase-deploy-rules.mjs`, `seed/build-seeds.sh`, `seed/build.mjs`, `seed/apply.mjs` | A | :389-412. |
| `tools/seed/world.mjs`, `tools/emulator-seeds/README.md` | C | :413-416. |
| `tools/emulator-seeds/<world>/` | built, committed | Output of `seed:build`, not of a generator. |
| `tools/dev/*` | A | The `dev` generator, listed as a step by this layer (`layers/firebase.ts:93`). |
| `.bespunky/dev.json` | B, seeded per process id | `seedApp` adds only ids not declared yet (`G/dev/declaration.ts:72-100`). Only for served apps. |
| `.bespunky/house-targets.json` | A | The provenance record. |
| `package.json` | B | `firebase-admin`, `firebase-functions`, `firebase-tools` (exact), `@nx/esbuild`, toolchain when nothing provides it (:469-478). Existing entries are never overwritten. |
| `eslint.config.mjs` firewall, `platform:` tags, nx.json sync | B after insertion | Best-effort, once (:431-449). |
| `.devcontainer/{devcontainer.json,post-create.sh,house.Dockerfile,house.packages.sh}` | A (composed) | JDK, gcloud archive, ports, env, banner piece (`layers/firebase.ts:107-142`). Plus `/etc/profile.d/zz-firebase-welcome.sh` in the container. |
| `HOUSE.md`, `HOUSE.rules.md` sections | A | |

Per app with a client (Angular), `adapters/angular/firebase-client.ts`:

| Path | Class |
|---|---|
| `src/environments/environment{,.prod,.staging}.ts` and the shape file | C (:52-59) |
| `src/app/firebase.config.ts`, `firebase-{auth,firestore,storage,functions}.config.ts`, `emulator-overrides.ts`, `proxy.conf.mjs` | A (`service-configs.ts`, `writeFirebaseClientGlue`) |
| `proxy.local.mjs` | C |
| `app.config.ts` `provideAppFirebase()` | B; inserted only on a baseline run (`--wireProviders`, :89-94) |
| `project.json` fileReplacements, `platform:web` tag, `dev-server` proxyConfig | B, reported when it cannot be wired (:75, :78-85) |
| `firebase`, `@angular/fire` in `package.json` | B (`declareBrowserSdk`) |

With the `ci` layer: `.github/workflows/deploy.yml` and `tools/setup-gcp.sh` (A), `.bespunky/ci.json`, a `ci-<environment>` configuration on both deploy targets, and `.bespunky/gcp/<env>.tsv` written by the human's run.

Runtime and human files, all gitignored: `.emulator-data`, `.emulator-data-<offset>`, `.firebase.offset-*.json`, `firebase-export-*`, `<functions>/.secret.local`, `.secret.sandbox.local`, `.bespunky/run/`.

**Nx targets**

| Target | Purpose | Anchor |
|---|---|---|
| `firebase:emulators` | Full suite; `dependsOn functions:build`; explicitly not `continuous` | :795, :765-772 |
| `firebase:emulators:{auth,firestore,storage}` | Focused; imports, never exports | :796-798 |
| `firebase:emulators:functions` | Focused, builds functions first | :799 |
| `firebase:seed:build` | Rebuild seeds from `world.mjs` | :801-804 |
| `firebase:reset` | Reprime `.emulator-data` from a seed | :807-810 |
| `firebase:deploy` | Rules and indexes declared in `firebase.json`; `cache:false`, `parallelism:false` | :814-820 |
| `functions:build` | esbuild to `dist/<root>`, with the inert-secrets plugin | :634-655 |
| `functions:lint` | Only where the workspace lints and inference is off | :658 |
| `functions:deploy` | `dependsOn build,lint`; runner | :660-669 |
| `functions:push-secrets` | Secrets to Secret Manager | :672-675 |
| `<app>:serve`, `dev-stack`, `dev-server` | From the `web` layer, not this one | `layers/web.ts:87-88` |

## 3. Each concern: how it is solved, and where

**Starting and stopping.** Every entry funnels through `FE/emulators.sh.tpl`: claim → prime → start (:6-13). The suite runs under a detached keeper, in its own process group and reparented out of every supervisor's tree (:262-281, `keep` :451-524, launched :534). The keeper is the only thing that ever signals firebase-tools, exactly once. Why: Nx kills leaves first and SIGKILLs after about 5 s, a terminal Ctrl+C reaches the JVMs, and a JVM killed first means a fatal exit with no export. The keeper has a deadline (`EMULATORS_STOP_TIMEOUT`, default 120 s, :288, :475) and `SIGUSR1` abandons at once (:461). It registers in the engine's detached-work protocol (`detached/emulators.json`, :283, `stacks.mjs.tpl:412`), so `dev stop` waits for it and `dev ps` shows it as FINISHING.

**Readiness.** There is almost none, and that is load-bearing for Postgres.
- The engine's only concept is `ready: {http}` on the primary process (`declaration.mjs.tpl:17,117,258`), used to log "Up:" (`dev.mjs.tpl:371-383`) and for `dev with` to wait (`dev.mjs.tpl:850-862`).
- `runStack` spawns every process at once with no ordering (`stack.mjs.tpl:167-182`), and any child exiting takes the whole stack down (`stack.mjs.tpl:62-64`).
- Firebase gets away with this because the app tolerates a late emulator. `emulators:exec` handles readiness inside seed builds (`seed-build-seeds.sh.tpl:9`). The browser asks the hub once at startup (`proxy.conf.mjs.tpl`, `firebase.config.ts.tpl`).

**Port allocation and offset.** Generic, in the engine. `claimStack` (`stacks.mjs.tpl:527+`) picks the offset and writes the record under one lock. The block is sized from declared ports (`ports.mjs.tpl`, `portBlock`), and a stack has one offset for all its processes. An AI agent never lands on base ports; `auto` skips them and an explicit 0 is refused. A script joins via `tools/dev/dev claim <name> --pid --lock --ports` and `release` (`emulators.sh.tpl:91-105`, `seed-build-seeds.sh.tpl:29-53`), or via `DEV_STACK_DIR/TMP/LOCK` under a serve (:82-89). Firebase-only on top: firebase-tools reads ports from a file, so a stack gets a generated `.firebase.offset-<N>.json` (:110-115, `emulator-ports.mjs.tpl:58-74`), and the port table exists so that undeclared nested ports (websocket 9150, hub, logging) are shifted too (`suite-ports.json`).

**Per-stack data isolation (D1).** D1 was firebase-tools locating a running suite through `tmpdir/hub-<projectId>.json`, keyed by project id alone, so one suite exported into another's folder (`docs/features/2026-10-07-house-firebase-handoff/PLAN.md:18,61`). The fix has two parts. Each stack gets its own short TMPDIR (`stacks.mjs.tpl:178`, `emulators.sh.tpl:74-80,107`; short because Functions worker sockets live there and a Unix socket path is cut at 107 bytes). Each non-base stack gets its own data dir, `.emulator-data-<offset>` (:115). Data lives **inside the tree**, gitignored, so deleting a worktree deletes its data.

**Export, import, persistence.** `--import` when the dir carries `firebase-export-metadata.json`, `--export-on-exit` on full runs only (:400-404). An explicit `--only` turns persistence off, because a partial export would overwrite the whole world (:29-33, :151-158); a derived `--only` keeps it (:187-190). Data survives a rebuild because it sits in the bind-mounted workspace, not because of a volume.

**Seeding.** Declarative data in `tools/seed/world.mjs` (C). The applier split (`tools/seed/apply.mjs`, A) lets fixes reach every project without rewriting user data, and `build.mjs` lets a world export its own `applyWorld` (`seed-build.mjs.tpl:4-11`). `build-seeds.sh` claims its own shifted stack (`--shifted --port-offset=auto`), runs `emulators:exec --only auth,firestore`, so no Functions and no triggers fire, and exports into `tools/emulator-seeds/<name>/`. The applier refuses unless told hosts and project explicitly (`seed-apply.mjs.tpl:10-15,24-45`). A fresh isolated stack primes once by copy, from this tree's seed, else the main worktree's (`emulators.sh.tpl:252-260,319-332`).

**Reset.** `firebase:reset` → `emulator-data.sh reset [seed]`: `rm -rf .emulator-data`, then copy the seed (:30-41, :58-62). It takes effect on the next serve. See section 7: it does not know about offsets or a running suite.

**Secrets.** Three files, three roles. `.secret.local.example` is committed and declares the keys. `.secret.local` holds production values with exactly one consumer, `push-secrets.sh`. `.secret.sandbox.local` is an opt-in real local credential.
- The build writes inert `EMULATOR_INERT_<KEY>` placeholders into the bundle (`emulator-secrets.cjs.tpl:9-14,274`).
- The launch rewrites them with production key **names** only (:15-18, `place` :356).
- A sandbox value equal to any production value, in this tree or main's, is refused (:17-18, :394-403).
- Never borrowed across trees (`emulators.sh.tpl:358-360`).
- `push-secrets.sh` parses first, refuses anything Firebase would reinterpret, and pipes each value on stdin (:8-16, :64, :75).

**Production-safety guards**

| Guard | Refuses or prevents | Mechanism |
|---|---|---|
| Offline `demo-` id | Any Google call reaching a real project | **Structural: Google refuses to create a `demo-` project** (`emulator-project.mjs.tpl:5-12`). Real id only when `environment.ts` commits a service; the file is evaluated, not read as text (:20-34); unevaluable means exit 2 |
| Live env watch | Browser and suite disagreeing after an edit | Polls `environment.ts`, prints RESTART NEEDED (`emulators.sh.tpl:565-608`) |
| Inert placeholders | Emulator fetching real secrets | Build output plus launch overlay |
| Sink | Missed secret reaching Secret Manager | `CLOUD_SECRET_MANAGER_URL` to `.invalid` (`emulators.sh.tpl:364`), and `sinkHonoured` checks at launch that the installed CLI obeys it (`emulator-secrets.cjs.tpl:317`) |
| Round-trip | Silently losing placeholders | Placed file re-read with the installed CLI's strict parser; mismatch is exit 2 (`:419-429`) |
| `configDir` floor | Functions running without params | `CONFIG_DIR_SINCE`, warned on upgrade (`generator.ts:703-723`), refused at launch |
| Agent stack | Agent on the developer's ports | `isAgent` in `claimStack` |
| Applier targets | Guessed host or project | Env vars or `SeedTargetError` |
| Rules seed marker | Placeholder reaching production | Deploy skips the file (`firebase-deploy-rules.mjs.tpl:83-87`) |
| Unwatched rules | CI never redeploying a file | Deploy refuses when no input watches it (`:72-81,102-135`) |
| No indexes seed | `--force` deleting live indexes | Never written (`generator.ts:42-45`) |
| Platform firewall | `firebase-admin` in a browser bundle | ESLint `bannedExternalImports` (`S/platform/firewall.ts`) |
| CI/IAM | Agent granting IAM | Directive (`HOUSE.rules.md.tpl:84-89`); human-run script |
| No `.firebaserc` | Fabricated cloud state | Never written (`generator.ts:11-14`) |

**Deploy targets, `inputs`, `nx affected`.** The contract is stated at `generator.ts:61-73`: target named exactly `deploy`, non-interactive, arguments forwarded through a shell, `cache:false`, `parallelism:false`, `dependsOn: build`. Constants are at :200-201, re-asserted through `contract:` (:629, :791). Inputs are `default`, `^default`, plus `{workspaceRoot}/firebase.json` and `.firebaserc` (:204), plus declared rules files outside the suite (:835-841). Deliberately **not** the runner scripts, so a toolkit release does not mark deploys affected (:68-70). The `ci` seam is `CiDeployProvider` (`G/ci/firebase-provider.ts:43-93`).

**Project aliases.** Firebase's own `.firebaserc`, never written by the house. `readiness()` mirrors the CLI's resolution order (`firebase-deploy.mjs.tpl:54-89`). `-P <alias>` under `nx run`, `--project=<alias>` under run-many, and `ci-<env>` configurations in CI.

**Human-run steps.** Three surfaces with one message, and never a gate.
- `tools/firebase-welcome.sh`: a self-extinguishing login-shell banner, silent once `.firebaserc` and a client `projectId` exist.
- `firebase-deploy.mjs --check` and any failed deploy print "the road": steps ticked from local facts, each with how to tell it worked (:101-144). The CLI always runs (:16-17).
- `HOUSE.md` (lines 281-285, 322-325).

CI identity is a human's: `CiDeployProvider.humanStep`, surfaced in the upgrade report.

**Login persistence.** No code in this layer; it is a finding, recorded as a comment and a test. firebase-tools uses `~/.config/configstore`, gcloud uses `~/.config/gcloud`, emulator jars live in `~/.cache/firebase`, all inside the agent layer's XDG volumes (`layers/agent.ts:93-109`, `layers/firebase.ts:108-112`, `tools/test-layers/run.mjs:1333-1335`). One wrinkle is handled: an ADC login under `CLOUDSDK_CONFIG` is invisible to Firebase and is named (`firebase-deploy.mjs.tpl:76-78`).

**Devcontainer.** All in `layers/firebase.ts:107-142`.
- JDK: `default-jdk-headless` through `osPackages` (:115-122).
- gcloud: a pinned `archives` entry with sha256 (:123-133). **Deliberately not apt, because Google's apt index drops a release after about a year** (:129-131). The archive is guarded against pin drift (:23-30).
- Env: `CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK` (:134-140).
- Ports: derived from `firebase.json`, for the Emulator UI only (:177-184, `emulator-ports.ts:84`); the app needs only its dev-server (:151-174).
- The vsfire extension, and the banner `postCreate` piece.
- No firebase-cli feature: the CLI is the project's exact devDependency (`generator.ts:469-478`).

## 4. The generic / pattern / Firebase-only cut

| Concern | Verdict | What a Postgres layer does | Anchor |
|---|---|---|---|
| Stack claim, offset, block sizing, agent refusal | **Generic: reuse** | Declare a process with `ports`; get it all for free | `stacks.mjs.tpl:527+`, `ports.mjs.tpl` |
| `${PORT:x}`, `PORT_<NAME>`, `exports`, `dev with` | **Generic: reuse** | `exports: {DATABASE_URL: ...}` is the exact seam for e2e and tools | `declaration.mjs.tpl:15,39-41`, `dev-fragment.ts:56-58` |
| `devFragment` on the descriptor | **Generic: reuse** | One function, no engine edit | `dev/fragments/index.ts:30-33`, `layers/firebase.ts:100` |
| Engine `ready` | **Generic: extend first** | Extract `ready: {tcp}\|{cmd}` per process | `declaration.mjs.tpl:117`, `dev.mjs.tpl:371` |
| Process order and one-shots | **Missing: new engine concept** | `runStack` needs `after:` and a one-shot kind, or `migrate` as a sibling kills the stack | `stack.mjs.tpl:62-64,167-182` |
| Env for sibling processes | **Missing: new engine concept** | `exports` reach only `dev with`; a capability cannot give the app's primary process a variable. Only `PORT_<NAME>` reaches it | `declaration.mjs.tpl:39-41,257,279` |
| Script-side claim | **Generic: extract** | Move the bash at `emulators.sh.tpl:91-105` and `seed-build-seeds.sh.tpl:29-53` into `tools/dev/dev run <name> --ports=… -- <cmd>` (`G/dev/files/dev.mjs.tpl`), which holds the lock itself | |
| Dev-engine gate | **Generic: fix** | `dev/generator.ts:68` names `firebase`. Replace with a descriptor field or `LAYERS.some(l => l.generators.workspace has dev)` | `G/dev/generator.ts:68` |
| House projects, 3-way target merge | **Generic: reuse** | `houseProjectHome` + `ensureHouseProject` | `_utils/project-files.ts:172,196`, `house-targets.ts` |
| Deploy contract constants | **Generic: extract** | `DEPLOY_CONTRACT`, `BUILDS_WHAT_IT_SHIPS` to `_utils/deploy-contract.ts` | `generator.ts:200-201` |
| "Refuse what `affected` cannot see" | **Generic: extract** | `watchedFiles` + `unwatchedBy` to an owned runtime module (`tools/dev/lib/` or a new `tools/house-deploy/`) | `firebase-deploy-rules.mjs.tpl:102-135` |
| `CiDeployProvider` | **Generic: reuse** | New provider; `deployOptions` args are provider-defined | `layers/descriptor.ts:180`, `ci/firebase-provider.ts:43` |
| Gitignore | **Generic: reuse the descriptor field** | Use `gitignore:`, not Firebase's own marker loop | `layers/firebase.ts:104`; not `generator.ts:371-380` |
| Version pins, no floating | **Generic: reuse** | `versions.ts`, `declareDependencies` | `_utils/dependencies.ts` |
| Upstream-derived tables | **Pattern** | New `tools/postgres-compat` only if a real table exists | `tools/firebase-compat/project.mjs` |
| Compose image: `osPackages`, `archives`, `containerEnv` | **Generic: reuse** | See the apt warning in section 3 | `layers/firebase.ts:115-140` |
| XDG persistence audit | **Generic rule** | Run the tool and look; extend `test-layers` | `agent.ts:93-109`, `test-layers/run.mjs:1333` |
| Plugin pointers | **Generic: reuse** | Own table beside the generator | `FE/skill-pointers.ts` |
| Doc gating by layer | **Generic: reuse** | `docSections`, `{{#postgres}}`. Don't copy house-doc's extra `firebase` flag | `house-doc/generator.ts:53,98,123` |
| Platform firewall | **Generic: extract** | Firebase's core owns insertion. Move :431-449 to `S/platform` as `ensurePlatformFirewall(tree, who)`; add `pg` and friends to `SERVER_ONLY` (`externals.ts:29+`); un-literal `firewall.ts:91-92`, `platform/index.ts:37` | `generator.ts:431-449` |
| One launch script as a funnel | **Pattern** | One entry for all targets, in Node, not 644 lines of bash | `emulators.sh.tpl:2-4` |
| Seed split: world C, applier A, build by name | **Pattern** | Exactly this split; applier speaks SQL | `seed-*.tpl` |
| Seeds as built artifacts from a throwaway stack | **Pattern, perhaps dropped** | A SQL seed re-applies, no export. Template DB could fill the role | `seed-build-seeds.sh.tpl` |
| Applier refuses unless told where | **Pattern** | Same refusal, plus a local-host check | `seed-apply.mjs.tpl:24-45` |
| Offline-by-construction | **Pattern of the goal only** | No equivalent exists: see below | `emulator-project.mjs.tpl:5-12` |
| Secrets triad, parse-then-pipe-on-stdin | **Pattern** | `push-secrets` shape for `supabase secrets set` | `push-secrets.sh.tpl:62-77` |
| Deploy runner with "the road" | **Pattern** | Failure prints the road; never a gate. Extract `nx()` | `firebase-deploy.mjs.tpl:36-42,101-144` |
| Self-extinguishing banner | **Pattern** | Only if a human step exists | `firebase-welcome.sh.tpl` |
| Never fabricate cloud linkage | **Pattern** | `supabase link`, same stance | `generator.ts:11-14` |
| Seed-marker deny-all | **Pattern, rarely** | RLS policies, if ever seeded | `firebase-deploy-rules.mjs.tpl:83` |
| Tripwire on undocumented behaviour | **Pattern** | Section 6 | `tools/test-firebase-tools` |
| Keeper, detached stop, export deadline | **Firebase-only** | Postgres persists to disk and handles SIGTERM itself, so plain process. **Check before dropping: Nx's 5 s SIGKILL against a shutdown under load** | `emulators.sh.tpl:262-524` |
| Detached-work protocol | **Generic but unused** | Available if a clean stop ever needs it | `stacks.mjs.tpl:412` |
| Stack TMPDIR | **Generic, free** | Handed over anyway. Useful for the Unix socket dir (107-byte limit applies) | `stacks.mjs.tpl:178` |
| Port table, shifted config copy | **Firebase-only** | One port, passed on the command line | `suite-ports.json`, `emulator-ports.*` |
| Demo id, env evaluation, EMULATE map, align-storage | **Firebase-only** | | `emulator-project.mjs.tpl` |
| Dotenv port, inert placeholders, sink | **Firebase-only** | | `emulator-secrets.cjs.tpl` |
| `--only` derivation, App Hosting inference | **Firebase-only** | | `emulators.sh.tpl:168-215` |
| Proxy relay, overrides, per-service provider split, bundle numbers | **Firebase-only** | A client-dials-backend artefact | `proxy.conf.mjs.tpl`, `firebase.config.ts.tpl` |
| Functions app, runtime matching | **Firebase-only** | | `generator.ts:505-516,571-693` |
| App Hosting, rules, indexes, `@angular/fire` pairing | **Firebase-only** | | |

## 5. The client side

`FirebaseClientPort` (`adapters/stack-adapter.ts:220-237`) is four members: `serverBannedImports`, `isWired`, optional `chooseFrameworkVersion`, and `attach(tree, project, opts)` returning an install callback. It hangs off `StackAdapter.firebase` (:67), and the port name is in the `Port` union (`registry.ts:21`).

What the shape shows:
- **The generator is thin.** `firebase-client/generator.ts` is 21 lines of logic: `portOf`, tag, attach. A stack with no port is reported and left alone (`registry.ts:80-99`).
- **The descriptor decides partial or legitimate** (`layers/firebase.ts:134-146`): `app` exists but has no port is not partial; a named app is missing while others could take it is partial; no such apps anywhere is the backend-only shape.
- **The app step runs before the core**, so scripts follow the client app (`layers/firebase.ts:75`).
- **`attach` composes other ports** (`env`, `devServer.useProxy`, `providers.wire`), all reusable by a supabase port.
- **`wireProviders` is baseline only** (`layers/firebase.ts:56`): an upgrade never re-inserts a provider a developer removed.
- **`chooseFrameworkVersion`** runs before the first app (`G/app/generator.ts:81-82`). A supabase-js port should not need it.
- **`isWired` is used to pick "the client app"** whose env files the scripts read (`generator.ts:522-532`). That coupling exists only because the demo id derives from an app's file. A backend-held connection has no such coupling.

For supabase-js: add `supabase?: SupabaseClientPort` and one `Port` member, and copy the 21-line generator. Don't introduce a generic `ClientSdkPort` yet. After removing `chooseFrameworkVersion` the two ports share two members, and `serverBannedImports` is really a firewall concern read through `workspaceStacksWith(tree, 'firebase')` (`platform/index.ts:37`), so it should move to the adapter when the firewall is extracted. `app/generator.ts:41,81,97-98` carries a legacy `firebase` tri-state that should not be copied; the generic path is `active` plus `attach.ts`.

**A backend-only project gets:** the core, the two projects, tools, deploys, the dev engine, and the firewall. It does not get `apphosting.yaml` (:357), a client, a dev-server port forward (`layers/firebase.ts:151-158`), or **any `.bespunky/dev.json` entry**: `seedServedApps` only walks projects with the `serve` target, and capabilities "never declare an app on their own" (`dev/fragments/index.ts:7-10`). It runs `nx run firebase:emulators`, which self-claims. `test-layers/run.mjs:462-469` pins this as not partial.

## 6. Tests

| Harness | What it exercises for Firebase | Postgres analogue |
|---|---|---|
| `tools/test-layers/run.mjs` | Plans and ordering (:375-398), `--seedRules` only on creation (:385-396), unmet layer on a wrapper repo (:409-420), backend-only (:462-469), wrong app is partial (:471), ci provider (:353), persistence comment (:1333), `layers.sh` drift | Yes, same checks |
| `tools/test-generators/cases/` | `firebase-emulators` (layout, gitignore idempotence, foreign functions home), `firebase-deploy` (contract, seed rules, upgrade from 0.49, **and runs the deploy script**), `emulator-relay` (client only), `stack-identity` (exports, non-continuous, port table), plus `versions.mjs`, `house-targets.mjs` | Yes, except relay |
| `tools/test-scaffold/*.test.sh` (1,160 lines) | **Runs the rendered scripts against fakes**: `emulators-stop` (each way a stop arrives saves), `emulators-only`, `emulator-seeds` (main-worktree cascade), `emulator-secrets`, `emulator-project`, `push-secrets`, `seed-build-stop`, `firebase-banner`, `machine-output`. Renderer: `emulator-tools.mjs` | Yes: launch, isolation, refusal of non-local hosts, reset |
| `tools/test-firebase-tools/run.mjs` | Real pinned CLI: parser port, sink, Functions emulator end to end with a recording proxy, sink under a real id. CI weekly plus path triggers | Yes: real Postgres binary |
| `tools/firebase-compat/project.mjs` | npm-derived tables and gcloud archive hashes served; weekly and before publish | If a table exists |
| `tools/dogfood-consumer/run.mjs` | Released Firebase + Angular consumer, seeded shapes, upgrade twice, build/lint/test; `new-angular-firebase` preset (:160). **Builds; does not boot the suite** (from its step list) | A `new` entry, plus an actual boot |

**Tripwires on undocumented upstream behaviour:**
- Guarded for real: `CLOUD_SECRET_MANAGER_URL` (at launch too, `sinkHonoured`), `lib/functions/env.js` dotenv, `--only` and `configDir`, `NX_IGNORE_UNSUPPORTED_TS_SETUP` (`test-angular-ts-solution`).
- Guarded **only by fakes**: the `hub-<projectId>.json` locator, the `firebase-export-*` staging layout (`generator.ts:265-270`), `firebase-export-metadata.json` as the primed signal, keeper signal semantics, Storage bucket keying. These rest on observed firebase-tools internals, and a bump could move them unnoticed.

**What Postgres needs:** a real-binary tripwire pinned to the Postgres major (start under a stack, `wal_level=logical`, pgvector `CREATE EXTENSION`, template clone, refusal of a non-local URL, clean stop under Nx's kill), plus a Supabase CLI tripwire if `supabase` runs a local stack. Add an image-level check that the pinned apt package still resolves (the `archives` comment names exactly that failure).

## 7. Current rough edges: don't repeat these

1. **`reset` ignores the stack.** `emulator-data.sh.tpl:20` hardcodes `.emulator-data`. An isolated stack uses `.emulator-data-<offset>` (`emulators.sh.tpl:115`), so reset in a worktree resets a dir its stack does not read. It also resolves seeds from this tree only (:21,:28), unlike the main-worktree fallback in `emulators.sh.tpl:252-260`. Nothing checks for a running suite either, whose exit export would overwrite the reset. (From reading; not reproduced.)
2. **Two priming paths.** `emulator-data.sh prime_from_seed` and the inline block at `emulators.sh.tpl:319-332`.
3. **Comments disagree on whether seeds are committed.** "Committed" in `emulator-data.sh.tpl:4`, `generator.ts:231`, `HOUSE.md.tpl:300`. "Gitignored" in `emulators.sh.tpl:24,238`, `emulator-seeds.test.sh:4`. No gitignore block ignores them, so committed is what happens, and the "borrow from main" premise is partly stale.
4. **`emulators.sh` is 644 lines of bash** with five inline `node -e` programs (:196, :223, :297, :311, :578) and a reimplementation of the engine's process identity (:48-49, :411-424). Logic that belongs in Node.
5. **`generator.ts` is one 877-line file**: a 91-line header, a 180-line default export, and deploy, firewall, runtime and rules logic side by side.
6. **The port logic is duplicated.** The table is projected, but `emulatorPorts` (`emulator-ports.ts:67`) and `suitePorts` (`emulator-ports.mjs.tpl:39`) are parallel implementations, and the template's header claims they "cannot disagree". Only the table cannot.
7. **Firebase is named in generic code:** `dev/generator.ts:68`, `house-doc/generator.ts:53,98,123`, `app/generator.ts:41,81,97-98`, `platform/index.ts:37`, `firewall.ts:91-92`, the `Port` union, and `house.sh` (`FIREBASE` :218, :726-727, :1099, :1122; `--staging` requires it). Most of it predates the registry.
8. **Angular inside the neutral core.** `firebase-welcome.sh.tpl:26,37` hardcodes `src/environments/environment.prod.ts`, although the adapter has `env.files`. Client templates live under `firebase-emulators/` because shipped migrations resolve them by path (`adapters/angular/firebase-client.ts:17-18`), so those migrations depend on live templates.
9. **Versions outside the one place.** `generator.ts:549-551` holds literal fallbacks (`^0.27.0`, `~6.0.3`) with a comment saying "Nx 23.2's own pins", against the `versions.ts` rule. `FIREBASE_ADMIN_VERSION` and `_FUNCTIONS_` are carets (`versions.ts:49-50`).
10. **Hardcoded `yarn nx`** in owned and seeded text whatever the package manager: `emulator-data.sh.tpl:35,55`, `seed-build-seeds.sh.tpl:7`, `seed-world.mjs.tpl:29`, `emulator-seeds-README.md.tpl:7`, `functions-secret.local.example.tpl:5`, `push-secrets.sh.tpl:22`. Meanwhile `firebase-deploy.mjs.tpl:36-42` works it out properly.
11. **Two project-id derivations.** `seed-build-seeds.sh.tpl:16` is always `demo-{{workspaceName}}`; `emulators.sh` derives from the app's env. Also `push-secrets.sh.tpl:47-52` greps `environment.prod.ts` as text, the exact habit `emulator-project.mjs.tpl:27-33` calls two bugs.
12. **Version compare written twice:** `generator.ts:714-715` and `emulator-secrets.cjs.tpl:43-47`.
13. **`.gitignore` has two mechanisms:** the descriptor field and the core's own marker loop.
14. **Admitted leftover:** the suite's `platform:server` tag "predates that and stays" (`generator.ts:788-789`), beside `tooling`.
15. **Stale project doc:** `CLAUDE.md` says the firebase layer's `google-cloud-cli` is an `osPackages` repository pin; the code moved it to `archives` because of the apt index problem.
16. **dev.json port drift.** Ports are seeded once per process id (`declaration.ts:85-90`), while the runtime reads `firebase.json`. A project changing suite ports keeps the old block size in `dev.json`.

## 8. What would surprise someone copying this layer for Postgres

1. **The core safety guarantee does not transfer.** `demo-` works because Google refuses that id. A connection string has no such property, so "nothing local reaches production" needs a new mechanism (host allowlist, stack marker in the database, or similar), and none of the 957 guard lines help.
2. **The dev engine has no readiness gate, no ordering and no one-shots,** and any exiting process kills the stack. "Start DB, migrate, then backend" cannot be expressed. This is an engine change, not a layer detail.
3. **A capability cannot hand `DATABASE_URL` to the backend.** `exports` go to `dev with` only. Firebase never needed this because firebase-tools injects hosts into Functions, and the browser uses the proxy.
4. **`nx serve <backend>` does not exist.** `serve` comes from `web`, `web` is ensurable only via `angular`, and the `js` adapter has no `apps` or `devServer` port. The handoff's "brought up beside the backend" has no path until the server-app adapter exists, so `nx run postgres:start` self-claiming (like `firebase:emulators`) must work alone.
5. **Writing `.bespunky/dev.json` makes a project wear `web`.** It is `web`'s evidence (`layers/web.ts:79`). Firebase avoids this only by not seeding a backend-only project.
6. **A shared server fights the stack model.** Stacks are processes that die with Ctrl+C, and data lives inside the tree, so removing a worktree removes its data. The handoff's named volume plus one database per stack means a server outliving stacks and orphaned databases when a worktree goes, with no owner to drop them. Per-stack server with `PGDATA` in the tree inherits everything; per-stack database needs a new lifecycle.
7. **The apt pin trap.** The layer moved gcloud off apt because the index dropped pinned releases and the image build then failed (`layers/firebase.ts:129-131`). Check whether PGDG's pinned `postgresql-NN` and pgvector versions have the same fate before choosing `osPackages`. (PGDG's retention not verified here.)
8. **`requires` needs thought.** Firebase requires `node` for its SDKs, not its tooling. On the wrapper host `node` is unmet and `upgrade` cannot ensure it (`ensurable.upgrade` is `nx,agent,firebase,ci`). `requires: ['nx']` is viable because engine scripts are Node built-ins only, but then no driver can be a devDependency.
9. **`deploy` ordering.** The contract has `parallelism:false`, which serialises deploys but does not order them. A schema must go before the code that needs it, which requires an explicit project-level `dependsOn` from the backend's deploy. Firebase has no such edge.
10. **The firewall arrives only with Firebase.** A Postgres-only project has no rule stopping `pg` reaching a browser bundle, which is the one rule the backend-held architecture rests on.
11. **The bar's largest test asset is fakes plus one real tripwire,** and dogfood does not boot the suite. Copying that coverage would leave "Postgres actually starts in the container" unobserved.

## Budget

No agents spawned of the 1 allowed.
