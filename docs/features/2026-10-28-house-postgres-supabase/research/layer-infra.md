# Layer infrastructure: the contract a new `postgres` / `supabase` layer must satisfy

> Research for `feat/house-postgres-supabase`, against `1a2489a5`, 2026-11-04. Code reading only: nothing was run. Facts about upstream tools (Debian, PGDG, Supabase, the Docker feature) are marked **unverified** where they appear.
>
> Path shorthand: `layers/…`, `adapters/…`, `generators/…`, `executors/…` and `platform/…` are under `plugins/house/engine/nx-tools/src/`. `engine/…` is `plugins/house/engine/`. `dev.mjs`, `declaration.mjs`, `stacks.mjs`, `stack.mjs` and `ports.mjs` are `generators/dev/files/…*.tpl` (`dev.mjs.tpl`, `lib/*.mjs.tpl`).

## 0. Summary

1. **The descriptor contract is real and cheap.** A layer is one file plus one registry line, and most surfaces derive from that (§1, §9).
2. **The dev engine has no notion of a shared service.** Every declared process belongs to exactly one stack. A per-stack Postgres *server* can be expressed today with workarounds; a shared server with per-stack databases cannot (§4.5).
3. **Three more dev-engine holes hit either design:** readiness is HTTP and primary-only, a one-shot process stops the stack, and a capability cannot put env on the app's process (§4.4).
4. **`CLAUDE.md` describes an apt-repository and `name=version` capability that does not exist in the code** (§5.2, §11). The installer refuses `=`.
5. **`dev/generator.ts:68` and `cli.ts:142` are the two blocking neutral-code assumptions** for a backend-only capability (§10).

---

## 1. The layer contract

### 1.1 `LayerDescriptor` (`layers/descriptor.ts:115-181`)

| Field | Req? | Meaning | Read by | Real example |
|---|---|---|---|---|
| `id` | yes | `[a-z][a-z0-9-]*`, unique (`registry.ts:135-136`) | everything | `'ci'` |
| `title` | yes | One line for errors and progress | `requireLayer` (`registry.ts:95`), `house_layer_title` | `'Firebase'` (`firebase.ts:38`) |
| `requires` | yes | Partial order; each must be registered earlier | planner (`plan.ts:55-63`), `house.sh` closure (`house.sh:785`), presets, `attach.ts:48` | `['nx','node']` (`firebase.ts:42`) |
| `evidence` | yes (may be `{}`) | Declarative, grep-able detection | `evidence.ts`, shell projection, hook | `{ files: ['firebase.json'] }` |
| `detect` | no | Pure refinement over evidence. Not visible to shell or hook | `safeDetect` (`registry.ts:108`) | `findDesignSystem` (`design-system.ts:22`) |
| `ensurable` | yes | `{new, upgrade}`, each `true`, `false`, or `{via}` | `house.sh:773,955`, `presets.ts:67` | `web`: `{new:{via:'angular'},upgrade:false}` |
| `ensureHint` | yes | Quoted when a precondition fails | `requireLayer`, `plan.ts:147`, `house.sh:980`, `app/generator` | `ci.ts:23` |
| `nxPlugin` | no | `nx add`ed by a scaffold before any generator | `house.sh:2247` | `'@nx/angular'` |
| `brings` | yes | Shown in hook drift notice | `check-house-version.sh:266` | `ci.ts:24` |
| `generators.workspace` | no | Once per workspace, registry order; identical step in two layers runs once (`plan.ts:89-96`) | planner | `web.ts:93` |
| `generators.app` | no | Against `ctx.app`; upgrade via planner, new apps via `app/attach.ts:53` | planner, attach | `web.ts:86-89` |
| `devcontainer` | no | Fragment, or `(tree) => fragment` | composer through `layer-contributions.ts:27` | `firebase.ts:107` (function), `node.ts:29` (data) |
| `docSections` | no; defaults to `[id]` (`layer-contributions.ts:43`) | `{{#flag}}` switches | house-doc | `web`: `['web','ui']` |
| `claudePlugins` | no | `plugin@marketplace`; marketplace must be known (`layer-contributions.ts:59-87`) | settings + pre-install | `web.ts:188` |
| `gitignore` | no | Blocks; the floor's step composes them (`nx.ts:31`) | gitignore generator | `node.ts:66` |
| `devFragment` | no | `(tree, project) => DevFragment`; seeded beside a *served* app when `isPresent` (`dev/fragments/index.ts:30-31`) | `seedFromAdapters` | `firebase.ts:100` |
| `ciDeploy` | no | `CiDeployProvider` (§8) | `ci/generator.ts:71` | `firebase.ts:98` |

`GeneratorStep` (`descriptor.ts:108-113`): `generator`, `args(ctx)` returning one argv word per item, and `skip(ctx)` returning `{reason, partial}`. `partial:true` turns into `UPGRADE_PARTIAL`. `plan.ts:120-131` refuses control characters and a flag passed twice.

`PlanContext` (`descriptor.ts:71-98`) carries `tree, mode, active, ensured, detected, project, app, voice, staging, branchProjection`. "Creating run" is expressed as `ensured.has(id) && !detected.has(id)` (`firebase.ts:90`). Use the same test for seeding class-C files.

### 1.2 Evidence and detection

- Kinds: `files, dependencies, targets, tags, projects, executors` (`descriptor.ts:45-52`). A layer is present on ANY match, or when `detect` returns true (`registry.ts:108`). There is no implied presence from dependants (`registry.ts:69-71`).
- Exact evaluation is `evidence.ts:9-30`; the approximate grep mapping is `cli.ts:201-212`. **In bash, `files` is `[ -f ]`** (`cli.ts:362`), while on a Tree it is `tree.exists`. Evidence must be a *file*, so name a file, not a directory.
- `dependencies` reads only the root `package.json`. A wrapper-host project has none, so a CLI-pin evidence would miss there.
- A failed detector degrades to absent, logged once (`registry.ts:106-121`).
- Pitfall: **`.bespunky/dev.json` is `web`'s evidence** (`web.ts:79`). Anything that writes a declaration makes the project wear `web` on the next upgrade (browser stack, `:80`, `requires: ['agent']`). A postgres-only workspace must not write it without meaning that.

### 1.3 Ensurability

`true` means this mode has a creating step; `false` means detect-only; `{via}` means only with that layer. An upgrade refuses a non-ensurable layer unless already evident (`house.sh:768-781`). Requirements are closed over the ensure set and each must itself pass (`house.sh:785`, comment at `:752-758`). The presets check is stricter (`presets.ts:58-79`).

For `postgres` and `supabase` the honest shape is `firebase`'s: `{ new: true, upgrade: true }`.

### 1.4 Planner order (`layers/plan.ts`)

1. **Applied set** (`plan.ts:55-63`): one pass in registry order. A layer with unapplied `requires` emits `warn` + `partial` and is out of the devcontainer, settings and stamp. Steps see only this set (`:65-70`).
2. **Per-app steps**, upgrade mode only (`:83-85`). In `new`, `app/attach.ts` runs them, treating every active layer as ensured (`attach.ts:37`).
3. **Workspace steps**, registry order, de-duplicated by generator+args (`:89-96`).
4. **Stamp**: `house-doc`, ungated and last (`:101-112`).

Output is TAB-separated `gen|warn|partial` (`cli.ts:66-70`).

Ordering trap, and part of the contract: `dev` runs as `web`'s workspace step **before** a later layer's generator. So a capability whose `devFragment` depends on a file it writes must call `seedServedApps` itself after writing it (`firebase-emulators/generator.ts:423`, explained at `dev/generator.ts:55-59`). On `new`, the app's `serve` step also runs before the capability's workspace step.

### 1.5 `registry.ts` validation (`:132-153`)

Checks id shape, uniqueness, `requires` registered earlier, and `via` registered. Not enforced: "`ci` last" is only a comment (`:44-45`). It matters because `ci` writes configurations onto the deploy targets earlier layers' generators create (`ci/generator.ts:254-303`), so a provider's project must exist by then. Insert `postgres`, `supabase` before `ci`.

### 1.6 Presets (`layers/presets.ts`)

Data only: `{id,title,layers}`. Validated closed under `requires`, every layer `new`-ensurable, every `via` partner present, floor present (`:58-79`). Adding one is one entry plus `--write`. The `angular` preset's title hard-codes Firebase advice (`:37`). `tools/dogfood-consumer/run.mjs:156-161` keeps a **separate hand list** ("EVERY preset") with no check that it matches.

### 1.7 `engine/layers.sh`

Generated by `cli.ts shell` (`cli.ts:219-286`), written by `node tools/test-layers/run.mjs --write`, drift fails CI (`tools/test-layers/run.mjs:75-78`). Contains `HOUSE_LAYERS`, ensurable lists, presets, layouts, linkings, and per-id `title/requires/hint/brings/ensurable_*/nx_plugin/app_stack/evidence`, plus the evaluator. `detect` is not projected. `house_layer_app_stack` comes from `ADAPTERS` (`cli.ts:262-266`).

Hook limit: the stamped layer list is dropped silently above **96 characters**, and its alphabet is `[a-z,-]` with no digits (`plugins/house/hooks/check-house-version.sh`, `:205-210`), although ids may contain digits (`registry.ts:135`). All layers plus `postgres,supabase` is 83 characters; a `tauri` and a sync layer would go past it and layer-drift notices would stop with no message.

---

## 2. The small descriptors

| Layer | Shape | What it shows |
|---|---|---|
| `navigation` (`navigation.ts`) | Id, tag evidence, `ensurable:false/false`, hint, `brings`, `docSections`. No generators | **The minimal honest layer.** Exists so docs and stamp know |
| `ci` (`ci.ts`) | Marker-file evidence, one workspace step, `docSections`. No container share | Marker written on every run so the layer stays on when there is nothing to write yet (`ci.ts:12-13`) |
| `node` (`node.ts`) | Fragment only, no generators; `new:true, upgrade:false` | A hosting fact as a layer |
| `web` (`web.ts`) | Everything: evidence refinement, per-app steps with `skip`, fragment | The `skip` idiom separates "wrong app named" (partial) from "nothing owed" (quiet) (`:62-73`) |

**Closest analogue for a backend-only capability: `firebase`'s core half, not any small layer.** `firebase` is the only layer that combines a workspace generator, an owned Nx project, `devFragment`, `ciDeploy` and a fragment, and it explicitly supports "no app to attach to" (`firebase.ts:1-7`, `:70-71`). Copy its *shape*, with `ci.ts` as the model for marker evidence if evidence is not a tool file. Do not copy its client half.

---

## 3. Stack adapters

### 3.1 Ports (`adapters/stack-adapter.ts:24-68`)

Core: `id, layer, ownsProject, ownsApp?, executors, platform`. Ports, all optional: `apps, libs, env, providers, styles, shell, devServer, designSystem, firebase`. The header's rule: "a port with no caller is a guess" (`:18-19`). The `Port` union (`registry.ts:21`) omits `shell`.

`ADAPTERS = [angular, js]` (`registry.ts:18`). `js` has only `libs` (`adapters/js.ts:47`), platform `shared`.

**The handoff is right: only Angular has `apps`, and no server-app adapter exists.** `nx g …:app` throws "No stack in this workspace can create apps" without one (`app/generator.ts`, the `!stack?.apps` branch).

### 3.2 How a capability reaches an app

- `portOf()` reports a missing port and returns null (`registry.ts:80-98`). `applicationsWith()` lists apps with a port, silently (`:105-117`).
- `firebase.ts:33-34,60-74` is the full idiom for a per-app step with graceful absence.

### 3.3 Is there a port-less way to attach? **Yes, two.**

1. **`generators.app`** runs any generator against `ctx.app`. The `serve` step reaches an adapter-less project; `worktree-tab-label` gates by itself.
2. **`devFragment`** adds processes to any *served* app by data, with no adapter involved (`dev/fragments/index.ts:30-31`).

`CLAUDE.md`'s "reaches an app only through that app's adapter's ports" is true of framework code, not of the dev loop.

### 3.4 What a `postgres` per-app step could attach to

There is nothing to attach to in a strictly backend-only workspace today:

- `cli.ts apps` **excludes any `platform:server` project** (`cli.ts:142`, tag at `:151`) because "the per-app steps … are all for something a browser loads" (`:128-129`). A tagged backend never receives `ctx.app`, so the planner cannot point a step at it.
- An upgrade resolves **one** app (`house.sh` `_resolve_upgrade_app`, `:616-640`); with several it declines and falls back to the project name.
- `servedProjects` only sees the `SERVE_EXECUTOR` (`dev/generator.ts:47-52`). A plain `@nx/js:node` backend is not served. `web.ts:24-30` is explicit that a `serve` target alone does not count.
- A backend given a `dev-server` target would be served (`web.ts:35`), and `fragments/nx.ts` would seed it, if the target names a `port` (`nx.ts:34-42`).

So the core must be a **workspace step**, and any app wiring is deferred with the server-app adapter (handoff §6), reported as `partial:false`.

### 3.5 No-app workspaces

Legitimate. The `firebase` skip returns `partial:false` when no candidate exists (`firebase.ts:71`). A workspace step does not need `ctx.app`, but `--app` is still required by `cli.ts plan` (`cli.ts:55`); `house.sh` falls back to the project name.

### 3.6 `requireLayer()`

A generator-entry guard throwing an actionable sentence (`registry.ts:89-99`). Ten callers, mostly `angular`/`js`. It reads the **Tree, not `--layers`**, so it cannot be used for a layer whose evidence the same generator is about to create. A `postgres` core generator should not guard on itself; its follow-ups (`db:new-migration` style generators, `supabase` on `postgres`) may. `generators/dev/generator.ts:68` is the exception worth fixing (§10.1).

---

## 4. The dev loop

Engine template: `generators/dev/files/`, written by `writeEngine` (`dev/generator.ts:39-44`), owned class A. Node built-ins only, because it must run with no `node_modules` (`dev.mjs:29-30`).

### 4.1 `.bespunky/dev.json`

Authority is `declaration.mjs:5-24, 81-133`; a type copy lives in `generators/dev/declaration.ts:17-38`. Root: `install?`, `apps`. App: non-empty `processes` and **at least one port across them** (`:130`). Process: `id, cmd, ports?, env?, exports?, primary?, ready?{http}, url?[], advice?[]`. Unknown keys are ignored rather than refused, so new fields are forward-compatible within the owned engine.

Substitutions (`declaration.mjs:196-207`): `${PORT:<name>}`, `${OFFSET}`, `${TREE}`, `${APP}`, `${STACK_DIR}`. Nothing else; an unknown one throws.

Every process gets (`:223-242`): `PORT_<NAME>` for every port of the app, `PORT_OFFSET`, `DEV_STACK_DIR`, `DEV_STACK_TMP`, `DEV_STACK_LOCK`, `DEV_URL_QUERY`. Outer-stack values are removed, not inherited (`:225-226`).

### 4.2 How a layer contributes a process

`devFragment` → `seedApp` (`generators/dev/declaration.ts:72-111`). Seeding only adds new process ids, and **never edits an existing process**. A port-name clash means the process is not added, and that is reported (`:89-98`). Once seeded, a process is project state; changing its shape takes a migration.

### 4.3 Stack identity, ports, teardown, orphans

- **Stack** = one claim of `<app>@<offset>`, per tree (`stacks.mjs:44`). Record at `<tree>/.bespunky/run/<key>.json` (`:12-16`). Claim lock in the main tree, covering all worktrees (`:136-165`).
- **Offset**: one offset shifts every declared port (`declaration.mjs:194, 254`). Block sized from the span, rounded to 1000 (`ports.mjs:26-33`). Main tree prefers 0; a worktree has a stable hashed block (`ports.mjs:83-107`). An agent never gets base ports: `auto` skips, explicit 0 is refused (`stacks.mjs:272, 567-573`).
- **Liveness** is a kernel `flock`. Every spawned child has the lock as **fd 3** (`stack.mjs:168`, `stacks.mjs:18-25`).
- **Stop**: any process exit stops the siblings (`stack.mjs:153-158`). `dev stop` signals the claimer once, then verifies ports (`dev.mjs:652-723`). Owner rules refuse other owners' stacks unless `--any-owner` (`dev.mjs:725-768`).
- **Orphans**: lock held, claimer gone. `dev stop` signals `lockHolders` plus detached groups (`stacks.mjs:444-451`, `dev.mjs:667-672`).
- **Detached work** is a generic seam (`stacks.mjs:399-430`): a process registers `<state dir>/detached/<id>.json` and the engine waits for it. Firebase's export uses it. Fits a slow Postgres shutdown if ever needed.
- **`dropStack` deletes the state dir and TMPDIR** when a stack ends (`stacks.mjs:377-382`). **`${STACK_DIR}` cannot hold data that must persist.**
- **Script claim**: `dev claim <app> --pid --lock --ports [--port-offset] [--shifted]` / `dev release` (`dev.mjs:780-821`). This is how `tools/emulators.sh` runs on its own (`emulators.sh.tpl:82-109`). It is the template for `nx run postgres:db:start`.

### 4.4 Gaps that hit any database design

| # | Gap and evidence | Consequence |
|---|---|---|
| D1 | **Readiness is HTTP and primary-only.** `ready` is `{http}` only (`declaration.mjs:117`); it is computed for every process (`:258`) but only `primary.ready` is used (`:291`); `announceReady` and `with` probe HTTP (`dev.mjs:371-382, 874-884`) | A TCP or `pg_isready` check has no slot |
| D2 | **No start order.** All children spawn in one loop (`stack.mjs:167-186`, `children.forEach`) | Backend races the database, so it must retry or wrap |
| D3 | **A one-shot process kills the stack.** Any exit while others run, *including code 0*, stops the rest (`stack.mjs:153-158`) | `createdb`, migrate and seed cannot be declared processes. They must live inside a long-running launcher |
| D4 | **A capability cannot put env on another process.** `seedApp` skips existing ids (`declaration.ts:90`); there is no app- or stack-level `env`; `exports` reach only `dev with` (`declaration.mjs:273-280`, `dev.mjs:862`), not siblings | No path to give the backend `DATABASE_URL`. Only `PORT_<NAME>` reaches it, so the app composes the URL itself |
| D5 | **A database-only app is awkward.** Capabilities "never declare an app on their own" (`fragments/index.ts:7-9`); `seedFromAdapters` bails if the app has no entry (`:29`); non-served project → no seed | Postgres-only workspaces get no `dev.json` entry from seeding |
| D6 | **`dev` generator gate is Firebase-specific** (§10.1) | A postgres-only workspace cannot get `tools/dev` |

### 4.5 THE KEY QUESTION: a long-lived shared server with a per-stack database

**Answer: not expressible today. Every declared process is per-stack, by construction.** Precisely, these are the missing pieces:

| # | Missing | Evidence |
|---|---|---|
| S1 | **No process lifetime other than the stack's.** Children live under `runStack` and die with it | `stack.mjs:102-114` (`stopRemaining`), `:153-158`, `dev.mjs:513-537` |
| S2 | **No unshifted port.** Every declared port moves with the offset; there is no "this port is fixed" | `declaration.mjs:194, 254`; the only escape is to not declare the port, which forfeits `${PORT:db}`, `PORT_DB`, conflict checks and `ps` |
| S3 | **No identity across stacks.** A record is per tree and per offset; nothing means "the one Postgres of this repo". `dev with` searches only the current tree (`dev.mjs:838-844`) | `stacks.mjs:44-46` |
| S4 | **No single address under the agent rule.** `dev claim` defaults to base for a human and `auto` for an agent (`dev.mjs:791`), so who started it decides its port | `stacks.mjs:567-573` |
| S5 | **No ensure-running verb and no dedupe.** A launcher can hand-roll `flock` + `pg_isready`, but the engine offers no help | absent |
| S6 | **The lock fd leaks into a daemon.** A launcher that daemonises (`pg_ctl start`) passes fd 3 on, unless it closes it. The stack then never dies, reads as `orphaned`, and `dev stop` signals the shared server as a lock holder | `stack.mjs:168`, `stacks.mjs:101-134, 444-451`. The opposite of Firebase's keeper, which holds the lock on purpose so the stack outlives it (`emulators.sh.tpl:63-66`) |
| S7 | **No per-stack identity substitution for a database name.** `${OFFSET}` is not the tree (0 means different things, `auto` can move it, two apps can share an offset); `${TREE}` is a path, not an identifier; `worktreeKey`/`servedSlug` exist in the engine but are not exposed | `declaration.mjs:196-207`, `dev.mjs:403, 419` |
| S8 | **No lifecycle hook for per-stack resources.** Nothing runs on stack claim beyond the process list, and nothing when a stack is pruned or a worktree removed. Per-stack databases would leak | `stacks.mjs:377-382`, `:506-525` |
| S9 | **No visibility or ownership model.** `ps` lists stacks only; `dev stop` has owner rules for a stack someone started, but a shared service needs "who may stop it" and possibly refcounting | `dev.mjs:605-643, 725-768` |

**What is expressible today, for the decision:**

- **(A) A server per stack, on the offset port. Fits the engine.** `{ id:'db', cmd:[launcher], ports:{db:5432}, exports:{DATABASE_URL:'postgres://…:${PORT:db}/…'} }`. Offset, `ps`, stop and conflict checks all work. Costs: the launcher must own initdb/create/migrate/seed internally (D3), readiness is the backend's problem (D1, D2), `DATABASE_URL` reaches `dev with` but not the backend (D4), `${STACK_DIR}` cannot hold data so the data dir is a tree-keyed path elsewhere (§5.4), and a server per worktree. Two apps in one tree mean two servers, since fragments seed per app.
- **(B) The server as its own declared "app".** `apps.postgres` with a primary process and `tools/dev/dev serve postgres --no-shared-browser`. Long-lived and visible, but started by hand, with no HTTP readiness so no `Up:` line and `dev with` never answers, shifted under an agent (S4), and `dev serve` without a name then refuses because there are two apps (`declaration.mjs:142-143`). A workaround, not a design.

**(C) Shared server, per-stack database: what it would take.** A new concept, not a flag. Something like a top-level `services` block (cmd, fixed port, non-HTTP `ready`, per-stack provision command), processes naming the services they use, a `${STACK_ID}`-like substitution, stack-level env, engine verbs for ensure/ps/stop, and a prune hook. Because the engine is class A and unknown keys are ignored, this needs no migration of existing declarations.

This is the largest single decision in the design. Note the architecture-first rule: it needs design and confirmation before implementation.

---

## 5. The devcontainer composer

### 5.1 Fragment fields (`descriptor.ts:338-409`; merge rules `compose.ts:11-19`)

| Field | Rule | Example |
|---|---|---|
| `image` | Last contributor wins, with its own features | `node.ts:32` |
| `features` | Concatenated, first id wins, `options` | `agent.ts:72-74` |
| `extensions`, `settings` | Deduped | `web.ts:97-110` |
| `mounts` | Deduped by target; `ownership`, `onHouseImageOnly` | `agent.ts:87-115` |
| `path` | One composed `PATH`; declaring `remoteEnv.PATH` throws (`compose.ts:167-173`) | `agent.ts:64-71` |
| `remoteEnv` / `containerEnv` | Deduped | `firebase.ts:134-140` |
| `runArgs` | Concatenated; image/Dockerfile only, not Compose | `web.ts:111-121` |
| `ports` | Merged by number | `web.ts:122-150` |
| `initializeCommand` | Host side | — |
| `osPackages` | `packages`, `onHouseImageOnly`; built as one cached image layer | `web.ts:170-184` |
| `archives` | `ArchiveTool`: `.tar.gz` plus sha256 per arch | `firebase.ts:123-132` |
| `postCreate` | Pieces at `generators/devcontainer/post-create/<piece>.sh.tpl`, phases `prepare → install → plugins → provision`, best-effort | `agent.ts:141-146` |

Tokens: `{{home}}`, `{{remoteUser}}`, `{{nodeMajor}}` only (`compose.ts:116-117`). A pin goes in by building the fragment in TS (`firebase.ts:22-29`).

### 5.2 `CLAUDE.md` disagrees with the code on apt

`CLAUDE.md` says an `osPackages` group "may name the third-party apt `repository` it installs from (key dearmored … `signed-by=`) and pin `name=version` (the firebase layer's `google-cloud-cli`)". **None of this exists:**

- The type has only `packages` and `onHouseImageOnly` (`descriptor.ts:391-400`).
- The installer **refuses `=`**: `*[!a-z0-9.+-]*` prints "not a Debian package name" and drops it (`house.packages.sh.tpl:46`).
- `google-cloud-cli` is an `archives` entry (`firebase.ts:123-132`), and `tools/test-layers/run.mjs:1343,1351` *forbids* `signed-by`, `apt-key` and `google-cloud-cli=` in the script.
- The rationale for not using apt is stated at `descriptor.ts:252-258`: a rolling index expires a pin, and a moved pin needs a downgrade.

**Consequences for Postgres and pgvector:**

- PGDG is not expressible. It would need a new fragment capability, and `descriptor.ts:252-258` is an argument against the mechanism that must be answered first (**unverified:** whether PGDG drops old versions from its main index, and whether `apt-archive.postgresql.org` is usable).
- `archives` does not fit apt-packaged software: it takes a `.tar.gz` with an executable directory, not a `.deb`.
- **What fits now:** a major is pinned by the package *name* (`postgresql-17`, `postgresql-17-pgvector`), with minor versions following the cached image layer. **Unverified:** the versions Debian 13 ships. `PG` binaries live in `/usr/lib/postgresql/<major>/bin`, needing a `path` entry; Debian's postinst may create a default cluster.
- **Supabase CLI** may fit `archives` if its GitHub releases are tarballs (**unverified**), which would avoid `requires: ['node']`. The alternative, the npm devDependency, needs `node`.

### 5.3 Features and the "version-less feature" ban

`CLAUDE.md`: "never a version-less devcontainer feature". The code has `ghcr.io/devcontainers/features/github-cli` with no tag (`agent.ts:73`), and `compose.ts:370` mentions version-less ids only for the install order. No test enforces the ban generally; `tools/test-layers/run.mjs:1336-1341` checks only Firebase features.

### 5.4 Persistence and where data lives

Persisted (`agent.ts:87-115`): `~/.claude` (bind), `~/.config`, `~/.local` (`onHouseImageOnly`), `~/.cache` (volumes per project, `${localWorkspaceFolderBasename}-*`). Rule in `CLAUDE.md` Conventions; test at `tools/test-layers/run.mjs:1298-1330`, firebase's at `:1333-1356`. **Extend it in the same change.**

**A Postgres data directory, three candidates:**

| Where | Mount needed | Notes |
|---|---|---|
| `~/.local/share/<…>/<tree key>` | **None** | Fits "fewest entrypoints". `~/.local` holds "XDG data, state and bin" (`agent.ts:103`). **Not mounted on a foreign image** (`onHouseImageOnly`, `compose.ts:193`), so data would not survive a rebuild there; must be reported |
| New `type=volume` under `{{home}}` or the workspace | One entry | Ownership derived (`compose.ts:270-287`); `reclaim_volume` is `chown -R`, fine for a server running as the remote user |
| In the tree (`<tree>/.bespunky/…`) | None | On the bind mount: 0700 and fsync behaviour on Docker Desktop are a risk (**unverified**) |

Handoff §5's "a named volume, like the Playwright cache" is out of date: Playwright has no volume of its own, it lives in `~/.cache` (`agent.ts:109-113`).

### 5.5 Docker-in-Docker

Expressible as data: `features: [{ id:'ghcr.io/devcontainers/features/docker-in-docker:<major>', options:{…} }]`, with `runArgs` for `--privileged` if the feature's own metadata does not carry it (**unverified:** I recall it does, plus its own `/var/lib/docker` volume). Nothing in the repo uses DinD or DooD today (`git grep` empty). Holes:

- **`VolumeOwnership` has no "leave it root's" policy** (`descriptor.ts:336`). `/var/lib/docker` lies outside home and workspace, so a fragment *must* declare a policy (`compose.ts:280-285`), and both available ones are wrong for it: `user` chowns, `shared` sets 1777.
- `.bespunky-devcontainer.json`'s adoption path merges features and mounts additively, recording `houseAdded` (`devcontainer/generator.ts:180-185`), so a removal later goes through `houseWrote()` + `removeFeature`, which also prunes the lock (`_utils/devcontainer-feature.ts:26-36`).
- Privilege is a project-wide cost for a capability only some flows use: the layer cannot express "opt-in within the layer". A separate layer, or a `supabase` fragment function reading a project fact, are the two data shapes available.

### 5.6 Node major

`projectNodeMajor` reads `.nvmrc` → `.node-version` → `volta.node`, seeded once with `HOUSE_NODE_MAJOR` (`_utils/node-version.ts:1-18`, `devcontainer/generator.ts:126`). `HOUSE_NODE_MAJOR` must be a GA Cloud Functions runtime (`versions.ts:55-60`), a Firebase constraint on a neutral seed (§10).

---

## 6. Versions

- **One place**: `_utils/versions.ts`, plain `export const`. New `POSTGRES_MAJOR`, `PGVECTOR…`, `SUPABASE_CLI_VERSION` go here.
- **Rule**: `_utils/version-spec.ts`: `isPinnedSpec` accepts exact, `^x.y.z`, `~x.y.z` (`:11-15`). `isFloatingSpec` is the complement for registry versions.
- **Writer**: `declareDependencies(tree, by, deps, devDeps)` (`_utils/dependencies.ts:36-65`): baseline only, refuses floats, keeps order, **root `package.json` only**. A wrapper host has none, so an npm-pinned CLI forces `requires: ['node']`.
- **Harness**: `tools/test-generators/cases/versions.mjs` fails a generator going around the seam.
- **Projected tables**: only for what is derived from upstream. `tools/firebase-compat/project.mjs [--write]` writes `firebase-compat.ts` and `gcloud-archive.ts`; `tools/node-facts/project.mjs` writes `node-facts.ts`. Messages resting on a table say "as of <date>" (`firebase-compat.ts:13`).
- **A Postgres or Supabase table is justified if** a sha256-pinned archive is used (the gcloud pattern, with the same mismatch guard, `firebase.ts:22-29`) or a host major must match. Adding one touches: the new `tools/<x>/project.mjs`, `.github/workflows/upstream-tables.yml` (`paths` and a step), `tools/publish-nx-tools/publish.sh:136` (a literal list), `.github/workflows/publish-nx-tools.yml:28` (paths).
- **Tripwire pattern**: `tools/test-firebase-tools` + `.github/workflows/firebase-tools-tripwire.yml` run the pinned tool for real, weekly. Worth copying for undocumented Supabase CLI behaviour.
- **Moving a pin later** is a migration that freezes its values (`versions.ts:18-22`).
- **`engine/house-probe.mts`**: refuses before anything is written, by loading pure, import-free modules (`:13-17`). It names layers directly (`:40, :98`). A Postgres preflight (say, a major mismatch or an unresolvable host) is one block, and must only import import-free modules. `constant()` regex-reads `versions.ts` (`:31`), so a pin must be written as `NAME = '…'`.

---

## 7. House-doc

- **Sections**: `{{#flag}}…{{/flag}}` in `generators/house-doc/HOUSE.md.tpl` and `HOUSE.rules.md.tpl`, flags from `docSections` (`house-doc/generator.ts:122`), defaulting to `[id]`. An unknown flag renders false (`:256`). Nesting works (`:274-295`). **No descriptor field holds doc text; sections are hand-added to the shared templates.**
- **Tokens** are `{{UPPER_SNAKE}}` from the generator's own table.
- **Which file**: `HOUSE.rules.md` is `@`-imported (always in context), `HOUSE.md` is linked (on demand). Firebase's rule block is `HOUSE.rules.md.tpl:84`, its doc blocks at `HOUSE.md.tpl:6, 14, 29, 168, 177, 186`. A safety rule ("seed and reset refuse a non-local host") belongs in rules only if it must hold on every change.
- **`pointer.md.tpl:8`** enumerates sections by flag; a new layer's section must be added by hand to appear in the pointer.
- **`CLAUDE.seed.md.tpl`**: layer-gated prompts for a fresh project (`:19-22`). Add a line only if the project has something to fill in.
- **`{{#plugin-x}}`**: set from `.claude/settings.json`'s `enabledPlugins`, not from `claudePlugins` (`generator.ts:129`). Outside house-doc, use `_utils/plugin-pointers.ts` tables (`generators/ci/skill-pointers.ts`, `firebase-emulators/skill-pointers.ts:10`). `tools/test-layers` fails a hard-coded pointer outside house-doc and a rendered doc naming an unenabled plugin.
- **`claudePlugins`**: a new plugin needs the four-part addition in `CLAUDE.md` Conventions. A skill can instead live in `bespunky-house`, as `firebase-app-hosting` does, avoiding a plugin but then being available in every agent project.
- **Stale override**: `options.firebase` (`generator.ts:54, 98, 123`; `schema.json:8`) claims `house.sh --firebase` forces it. `plan.ts:105-110` never passes it. Only a direct call can.

---

## 8. The `ci` layer and branch-model bindings

**Flow**: `.bespunky/branches.json` → engine's `projection.deploys` (`DeployBinding`, `_utils/branch-model.ts:72-81`) → resolved by `house.sh` → `--branchProjection` (`layers/ci.ts:29-32`) → `ci/generator.ts:69-172`.

`generators/ci/generator.ts` maps `layers` to providers (`:71`), wires only protected lines (`:187-215, 239-247`), one line per environment (`:204-207`), writes `deploy.yml`, provider files, a `ci-<environment>` Nx configuration **only on the provider's own targets** (`:254-303`), and prints `HUMAN_STEP`s. The workflow runs `run-many -t deploy --projects=… --configuration=ci-<env>` (`ci/workflow.ts:217`).

**Cost of a provider: one `CiDeployProvider`** (`descriptor.ts:207-228`). Required: `id, title, deployTargets, deployOptions, authSteps`. Optional: `files, isSetUp, humanStep, retireStep`. Model: `generators/ci/firebase-provider.ts:43-93`. `branches.mjs` already accepts any lowercase id (`model.mjs:203-207`), so no engine change.

**Things that will bite:**

1. **A binding must name every active provider, or the line is not wired at all** (`ci/generator.ts:209-216`). So adding a provider to a project that already deploys **silently stops that line's deploys until the branch model is updated**, with only a note. Two layers each contributing `ciDeploy` (`postgres` and `supabase`) require two entries per binding. For a project already bound, a new provider is a behaviour change needing a loud message.
2. **Secrets have no slot.** `Deploy` step's `env` is fixed (`workflow.ts:213-215`). A provider has only `authSteps` (steps before it) and `deployOptions` (an Nx configuration, committed to the repo). A `DATABASE_URL` or `SUPABASE_ACCESS_TOKEN` must go through a step writing `$GITHUB_ENV`, or a new `deployEnv` field. **Never `deployOptions`**, which land in `project.json`.
3. **Ordering**: database before app is only expressible via `dependsOn` between deploy targets. `run-many` follows the graph; `CiDeployProvider` has no ordering concept. The `prepare` job's affected list must include the db project, hence `inputs` on the target (handoff §4.4).
4. **`id-token: write` is unconditional** (`workflow.ts:197`) with a comment naming Workload Identity Federation. A token-based provider does not need it, so its deploy job holds a capability nothing uses.
5. **Provider home**: `firebase-provider.ts` lives under `generators/ci/`. A new provider belongs with its own generator; the `firebase.ts:18` import direction allows it.
6. **Declaring a provider's human setup**: Supabase link is the same stance as `setup-gcp.sh`: a human runs it (`humanStep`), the house never fabricates cloud state.

**Firebase-specific vs neutral**: neutral: `resolve`, `unprotected`, `writeConfigurations`, marker, workflow structure, `CiDeployProvider`. Firebase-specific: §10.5.

**Branch-model schema**: `appHosting` is a Firebase key at the top of a binding (§10.6). A provider's own GitHub-linked rollout (Supabase branching, if used: **unverified**) has no neutral slot.

---

## 9. Surfaces a new layer must touch

### Derived automatically (from the descriptor plus `--write`)

`engine/layers.sh` · `house.sh` validation, hints, `--help`, ensure closure · `SessionStart` drift (`check-house-version.sh:244-266`) · planner · `app` generator's attach (`attach.ts`) · devcontainer composition, volume reclaim, `house-mounts.sh` · `.claude/settings.json` · `.gitignore` · doc flags · dev.json seeding · CI providers · `requireLayer` messages.

### Manual

**Payload**

| Where | What |
|---|---|
| `layers/<id>.ts`, `layers/registry.ts:45` + import | Descriptor; before `ci` |
| `generators/<id>/`, `generators.json` | The generator(s) |
| `generators/_utils/versions.ts` | Pins |
| `generators/house-doc/HOUSE.md.tpl`, `HOUSE.rules.md.tpl`, `pointer.md.tpl:8`, maybe `CLAUDE.seed.md.tpl` | Doc text |
| `generators/devcontainer/post-create/<piece>.sh.tpl` | Any piece |
| `generators/devcontainer/schema.json:21`, `generators/house-doc/schema.json:17` | Hand lists in descriptions (already stale: no `ci`; house-doc's has no `node`) |
| `generators/gitignore/schema.json:10`, `generators.json` descriptions | Prose naming layers |
| `platform/externals.ts:28-36` | Server-only DB packages (§10.4) |
| `layers/presets.ts` | Only if a preset is wanted |

**Engine**: `engine/house-probe.mts` for any preflight · `engine/house.sh` header comment (`:18-21`) and `--help` prose if a flag is added (deliberately avoid a new one; §10.7).

**Tests**

| Where | What |
|---|---|
| `tools/test-layers/run.mjs` | `--write`, presets, a plan case, agent-artifacts case, **persistence case** (`:1298-1356`), evidence parity (`:228`), migration scope check is automatic (`:1858`) |
| `tools/test-generators/cases/<id>.mjs` | New case, every layout × linking cell; `versions.mjs`, `skill-pointers.mjs` |
| `tools/test-migrations/cases/` | Only if a migration is owed |
| `tools/test-scaffold/` | Shell-level. `render.test.sh:244-249` has a hand list of arms, with a stale comment ("only nx, agent and firebase are addable"; `ci` is too). Add arms; dev-engine checks in `dev-engine.checks.mjs` for any engine change; hook case in `house-hook.test.sh` |
| `tools/dogfood-consumer/run.mjs` | `PRESETS` (`:156-161`, a hand list), `SEEDS` (`:309`) if shapes exist; a `new-*` entry. Its consumer is Firebase + Angular only (`:516`), and this repo wears neither, so **a postgres consumer path is a real new step** |
| New tripwire + workflow | Optional, like `tools/test-firebase-tools` |

**Docs and skills**

| Where | What |
|---|---|
| `plugins/house/skills/new/SKILL.md` | Per-layer requirements (`:19-66`, section per layer), layer table (`:150-160`), planner list (`:109`), verify table (`:346-364`), gather-inputs (`:85`), report-back (`:398`), recipe (`:457`) |
| `README.md` | Layer table (`:500-510`), engine walk-through (`:580-585`), Firebase-style paragraph (`:587`), plugin row if any |
| `plugins/house/tips.txt` | Tips in the same commit (`CLAUDE.md` rule) |
| `plugins/house/commands/add-layer.md:2,21` | Examples |
| `CLAUDE.md` | Layer list (already missing `ci`) |
| `plugins/workflow/skills/local-server-isolation/SKILL.md:30` + `reference/` | Worked example, analogous to `firebase-emulators.md` |
| `plugins/workflow/skills/branch-and-release/` | `reference/changing-the-model.md`, `choosing-a-branch-model.md`, `serving-a-worktree.md` if a provider is added |
| `.github/workflows/upstream-tables.yml`, `publish-nx-tools.yml:28`, `tools/publish-nx-tools/publish.sh:136` | If an upstream table is added |

**Release**: plugin bump through `nx release` (`bespunky-house`, plus `bespunky-workflow` if its skills change), payload bump in `engine/nx-tools/package.json`, "nothing to migrate" stated in the commit if so, dogfood gate (this repo and a consumer), and a container rebuild since the fragment changes.

---

## 10. Hard-coded Firebase assumptions in neutral code

Ordered by how much they block `postgres`/`supabase`.

### Blocking

| # | Where | What is hard-coded | Generalisation |
|---|---|---|---|
| 10.1 | `generators/dev/generator.ts:68` | `if (!detectLayers(tree).includes('firebase')) requireLayer(tree, 'web', 'dev');`. The dev engine is allowed without `web` only for Firebase. **A `postgres` layer listing `{generator:'dev'}` throws in a workspace without `web`.** Also detects from the Tree, not `--layers` | Remove the name: "any layer that lists the `dev` step may run it". The planner's de-dupe (`plan.ts:89-96`) already treats it as a shared step. Could be a guard on "some active layer declares it" |
| 10.2 | `layers/cli.ts:142, 151` (+ `:123-135`, `house.sh:610-612`) | Per-app steps exclude `platform:server` because all per-app steps are "for something a browser loads", a Firebase-era reading. **A backend is the very app a `postgres` per-app step targets.** | A step or layer states the platform it attaches to (`GeneratorStep.platforms`), and `ctx.app` becomes per-step. Blocked until a server-app adapter exists; design for it. |
| 10.3 | `generators/dev/fragments/index.ts:7-9, 29` + `generators/dev/generator.ts:47-52` | Capabilities "attach to an app that is served … never declare an app on their own", reasoning from "an app made only of emulators has nothing to open in a browser". No backend-only or database-only path | A concept for services independent of an app (§4.5), and a "served" that includes a backend |

### Must generalise or the layer will duplicate them

| # | Where | What is hard-coded | Generalisation |
|---|---|---|---|
| 10.4 | `platform/index.ts:37` | The stack's web-only imports are read from `stack.firebase.serverBannedImports`: **neutral classification goes through the Firebase port.** A stack with no Firebase port contributes nothing | Move to `StackAdapter` (a `webOnlyImports` field) |
| 10.4a | `generators/firebase-emulators/generator.ts:435` | The **only** caller of `insertPlatformFirewall` is Firebase. Without Firebase there is no firewall, so "no database client in a browser bundle" (handoff §5) has nothing enforcing it | A neutral firewall step any server capability may list (the planner's shared-step de-dupe fits) |
| 10.4b | `platform/externals.ts:28-41`, `platform/firewall.ts:76-84` | Server-only list is Firebase, `@google-cloud/*`, `express`; no `pg`, `postgres`, etc. The generated comment names Firebase | Add DB drivers (a package fact, so table-correct in any workspace, per `:5-6`); make the comment neutral |
| 10.5a | `generators/ci/generator.ts:213` | `p.id === 'firebase' ? '.firebaserc alias' : 'target'` | `CiDeployProvider.targetLabel` |
| 10.5b | `generators/ci/generator.ts:234` | The "add a binding" message's example names Firebase, whatever is active | Build from active providers |
| 10.5c | `generators/ci/generator.ts:314` | Foreign-pipeline detection: `/\bfirebase\s+deploy\b/`. A project's own `supabase db push` workflow is not seen, **so the house writes a second deploying workflow**, the outcome the file calls worst | `CiDeployProvider.deploySignals` |
| 10.5d | `generators/ci/generator.ts:66` | The marker's `ABOUT` names `tools/setup-gcp.sh` | Neutral wording |
| 10.5e | `generators/ci/workflow.ts:197` | Always `id-token: write`, with a WIF comment | Provider states whether it needs OIDC |
| 10.5f | `generators/ci/workflow.ts:213-215` | Deploy env is fixed; no provider slot (§8.2) | `deployEnv()` |
| 10.5g | `generators/ci/generator.ts:209-216` | Every active provider must be named by each binding (§8.1). Not Firebase-named, but only ever met one provider | Decide per-provider opt-in vs refusal; loud report either way |

### Dev engine and serve wrapper

| # | Where | What is hard-coded | Generalisation |
|---|---|---|---|
| 10.6a | `executors/serve/executor.ts:53, 67`; `schema.json:12-14`; `schema.d.ts:13` | `--no-emulators` → `--skip=emulators`, a process id known to the Nx wrapper | Remains as a legacy alias, or a fragment declares a named skip. `--skip=db` already works generically. Asking whether anything needs the alias is the user's call |
| 10.6b | `generators/dev/files/dev.mjs.tpl:798` | `opts.app === 'firebase' ? 'emulator suite run directly' : …` | `--label` on `claim` |
| 10.6c | `dev.mjs:193-195` | Usage text cites `FIREBASE_*_EMULATOR_HOST` | Cosmetic |
| 10.6d | `dev.mjs:89-93`, `stacks.mjs:399-411` | Detached work and the 180 s timeout were sized for an export | Generic already; only the wording names Firebase |
| 10.6e | `declaration.mjs` `ready`, `url[]`'s `?emulate=none` | `url` is generic; the concept "skipping a process switches the client" was built for Firebase's browser SDK | None needed, since a backend-held connection has no client switch |
| 10.6f | `executors`, `dev/fragments/nx.ts` `NX_TREE_ENV` | Generic, reusable by a postgres fragment | None |

### Neutral contexts carrying Firebase concepts

| # | Where | What is hard-coded | Generalisation |
|---|---|---|---|
| 10.7 | `engine/house.sh:218, 234, 726-727, 1099, 1122` | `--firebase`, the `FIREBASE` variable, the banner, and `--staging` requiring Firebase. The comment at `:742` says "nothing here names a layer" | `--add-layer` already covers intent. **Do not add `--postgres`.** `--staging` is really "this project has a staging environment" |
| 10.7a | `layers/descriptor.ts:91`, `generators/app/generator.ts:41-43, 78-82, 97-98`, `app/attach.ts:29` | `staging` and `firebase` on neutral contexts and the app generator. `wearsFirebase` calls `stack.firebase.chooseFrameworkVersion` | A generic "before the first app" hook for layers that constrain a framework. Not needed by a backend-held DB; only by a future client port |
| 10.7b | `generators/house-doc/generator.ts:54, 98, 123, 157`; `schema.json:8` | `firebase` override flag and `functions` home lookup | Stale override can go (asking first). A layer-specific token lookup has no seam, so `postgres` adding `{{POSTGRES_HOME}}` would add a second special case: consider `LayerDescriptor.docTokens(tree)` |
| 10.7c | `engine/house-probe.mts:40, 57, 98` | Probe names layers; the message cites Cloud Functions | Accepted shape (import-free), but it is another "a new layer edits a neutral file" |
| 10.7d | `generators/_utils/versions.ts:55-60` | `HOUSE_NODE_MAJOR` must be a GA Functions runtime, checked by `tools/test-layers` | A Firebase constraint on a neutral default; acceptable, note it |
| 10.7e | `layers/presets.ts:37`; `adapters/stack-adapter.ts:66-67, 220-237`, `adapters/registry.ts:21` | Preset title; a capability-named port on the stack interface | Handoff's `supabase` client port would add a second capability-named port. If a client port arrives, consider a keyed `capabilities` map rather than one port per vendor |

### Branch model

| # | Where | What is hard-coded | Generalisation |
|---|---|---|---|
| 10.8a | `plugins/workflow/skills/branch-and-release/scripts/lib/model.mjs:134-140, 152, 219`; `_utils/branch-model.ts:79-80`; `generators/house-doc/branch-docs.ts:66-73` | `appHosting` is a first-class deploy key, in the schema, the projection, and the rendered table's column | A neutral "provider's own rollout" list. Only if Supabase needs one; a format-only migration would be owed, so do not do it speculatively |
| 10.8b | `scripts/lib/evidence.mjs:141-147, 187, 256+`; `scripts/branches.mjs:31` | Investigation looks for `firebase.json`, `.firebaserc`, App Hosting. A `supabase/config.toml` is invisible when the skill investigates the deploy story | Add to `BINDING_LIKE` and as a fact |

### Safety guarantees: no neutral seam exists at all

The handoff lists "nothing local reaches production" as carrying over. It exists only inside Firebase's scripts:

- `tools/emulators.sh` `demo-` project id (`emulators.sh.tpl:119-144`), `emulator-project.mjs`.
- `emulator-secrets.cjs` compares sandbox values to production and refuses (`:16-18, 394-403, 472-474`).
- `seed-apply.mjs` refuses without the emulator env (`:12`).
- Worktree-secret isolation (`emulators.sh.tpl:354`).

**The engine offers none of it**, only the agent port rule (`stacks.mjs:272`). For Postgres, the equivalent is a one-file refusal ("host is not loopback") that each `seed`/`reset` target runs. It is simple because there is a single connection string, and it can be a small owned script, not a generalised framework. Worth stating rather than inferring from "guarantees carry over".

---

## 11. Where the code disagrees with `CLAUDE.md`

| `CLAUDE.md` says | Code says | Anchor |
|---|---|---|
| `osPackages` may name an apt `repository`, `signed-by=`, `name=version`, "the firebase layer's `google-cloud-cli`" | Not implemented; `=` is refused; gcloud is `archives`; tests forbid the apt form | `descriptor.ts:391-400`, `house.packages.sh.tpl:46`, `firebase.ts:123`, `tools/test-layers/run.mjs:1343,1351` |
| "never a version-less devcontainer feature" | `github-cli` has no tag; no general check | `agent.ts:73` |
| Layer list ends at `firebase` | `ci` is registered | `registry.ts:45` |
| A capability reaches an app "only through that app's adapter's ports" | Also through `generators.app` and `devFragment` with no adapter | §3.3 |
| "descriptor's `new` and `upgrade` keys" | Nested as `ensurable.new/upgrade` | `descriptor.ts:129` |
| Descriptor enumeration | Omits `gitignore`, `devFragment`, `ciDeploy`, `nxPlugin`, `brings`, `detect` | `descriptor.ts:115-181` |

Also, in the code's own comments:

- `house.sh:742`: "nothing here names a layer", while `house.sh:726-727, 1122` do.
- `tools/test-scaffold/render.test.sh:244`: "only nx, agent and firebase are addable", but `ci` is.
- `house-doc/generator.ts:119-122`: `house.sh --firebase` forces docs, but `plan.ts:105-110` passes no such flag.
- `dev/generator.ts:3`: "Two layers list its step" is accurate today, and is the assumption 10.1 hard-codes.

Handoff statements checked: "only Angular has an `apps` port" is **correct**; "a named volume, like the Playwright cache" is **out of date** (§5.4); "through `os-packages` or a feature, not Docker" must drop the unpinned feature route and, for PGDG, note §5.2; "connection string reaches its processes through `dev.json` env" **is not possible for the backend process from a fragment** (D4); `db:start` as an owned target through one launch script **fits** (`emulators.sh.tpl`, `dev claim`), and "`firebase` already treats backend-only as legitimate" is **correct** (`firebase.ts:1-7, 70-71`).
