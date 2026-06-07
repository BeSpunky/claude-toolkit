# Reusable-tool extraction — design spec

**Status:** draft for confirmation. No code until this is agreed.

Turns a generic piece discovered while working *inside* a project into a published, shared `@scope/*` package that the project then consumes back — across the sandbox boundary between an in-project DevContainer and a host that can see all projects.

The toolkit **skill** (`engineering:architecture-first`) owns only the *discipline* (recognize → abstract → place on purpose → never inline-and-forget) and stays generic. **This mechanism** owns the *where and how*, and is house infrastructure (it knows the scope, the shared workspace, the registry).

---

## 1. The boundary problem & the two bridges

The in-project (DevContainer) context and the host (cross-project) context **cannot talk directly** — different access scopes. The mechanism never needs them to. They hand off through artifacts that already cross the boundary:

- **Out (sandbox → host): git.** The in-project step commits a *marker* into the project repo; the host reads it.
- **Back (host → sandbox): the package registry.** The host publishes; the project pulls the package.

No special channel, no daemon — the repo and the registry *are* the channel.

---

## 2. Lifecycle

| # | Step | Runs in | Tool |
| --- | --- | --- | --- |
| 1–2 | work + **detect** a generic piece | project | `architecture-first` discipline (human/Claude judgment) |
| 3 | **stage** it (place / do something) | project *(sandbox-safe)* | `mark-extractable` **generator** (in-workspace) |
| 4 | **extract** into the shared workspace | host | `extract-tool` **host script** (cross-workspace — *not* a generator; see §2.1) |
| 5 | **publish** | shared workspace | its existing Nx release |
| 6 | **consume back** | project *(registry)* | `adopt-extracted` **generator** (in-workspace) |

`extraction.json.status` tracks position: `candidate` → `ingested` → (removed on `adopted`).

### 2.1 Why step 4 is a script, not a generator

An Nx generator operates on the **Tree of a single Nx workspace** — it can't reach across to another. But on the host, `~/projects` is a **flat set of isolated workspaces** (each project is its own Nx workspace; the shared library workspace is another) with **no Nx workspace spanning them.** The extraction move *reads from one workspace and writes into another*, so it cannot be a generator at all.

Steps 3 and 6 stay **generators** because each runs entirely *inside one* workspace (the project's own). Step 4 is a **plain host script** with filesystem access to both the source project and the shared workspace; for the *in-shared-workspace* part (scaffolding the package shell) it may invoke the shared workspace's own Nx generator as a subprocess (`cwd` = shared workspace) — but the cross-workspace orchestration is the script's.

---

## 3. The marker (sandbox → host hand-off)

Two parts, co-located with the extractable lib:

**a) An explicit Nx tag** on the lib's `project.json` — a self-documenting, discoverable flag the host script can find (by reading project.json, or `nx show projects --withTag reusable-tool:extraction-candidate` *inside the project*):

```jsonc
// libs/<name>/project.json
{ "tags": ["reusable-tool:extraction-candidate"] }
```

The `reusable-tool:` prefix (Nx `key:value` tag convention) makes the intent unmistakable to anyone reading `project.json` and namespaces it away from boundary-rule tags (`scope:`, `type:`).

**b) An `extraction.json`** in the lib root — the rich metadata:

```jsonc
// libs/<name>/extraction.json
{
  "status": "candidate",              // candidate | ingested  (removed when adopted)
  "proposedPackage": "@bespunky/name",// suggested published name (default <scope>/<lib>)
  "summary": "One line: what it is and why it's generic",
  "rationale": "Why it's generic enough to extract",
  "sourceWorkspace": "@workspace/name", // the source repo (root package.json name)
  "sourceLib": "<lib project name>",
  "sourceLibRoot": "libs/<name>",
  "entry": "libs/<name>/src/index.ts",  // the library's public entry
  "kind": "js",                       // js | angular  (Nx library preset)
  "declaredDeps": {                   // from the lib's own package.json, if any
    "dependencies":     { "...": "..." },
    "peerDependencies": { "...": "..." }
  },
  "frameworkVersions": {              // installed ranges of @angular/*, @nx/*, nx, rxjs, …
    "@angular/core": "^20.0.0",       //   → extract-tool pins the package to these majors (decision #2)
    "rxjs": "^7.8.0"
  },
  "ingestedPackage": null,            // filled by extract-tool: { name, version }
  "markedAt": "YYYY-MM-DD",           // stamped by the generator
  "notes": ""
}
```

*(This is the exact shape `mark-extractable` writes — the generator is the source of truth.)*

The marker is **committed** — that is the hand-off. The project keeps consuming the lib via its TS path alias meanwhile; nothing breaks.

---

## 4. The tools (two generators + one host script)

- **In-workspace generators** (`mark-extractable`, `adopt-extracted`) live in the house generator package (`nx-tools`), already copied into every scaffolded project. Toolkit source: `plugins/project-starter/skills/new-project/assets/nx-tools/src/generators/`.
- **The host script** (`extract-tool`) is a standalone Node CLI — *not* an Nx generator (§2.1) — that runs on the host with access to all `~/projects`. Toolkit home: a small `tools/` package in the toolkit (TBD location), runnable with `node` / `npx`.

### 4a. `mark-extractable` — generator, in project (sandbox-safe) — ✅ BUILT (Phase 1)

Marks an **existing** Nx library as an extraction candidate and captures its metadata. It does **not** abstract the code — recognising genericity and structuring it into a clean library is the developer's `architecture-first` judgment: scaffold with the standard `nx g @nx/js:lib` / `@nx/angular:library`, move the code in, *then* mark that library.

- **Options:** `lib` (required), `summary` (prompted), `rationale`, `package` (default `<scope>/<lib>`), `scope` (default `@bespunky`), `kind` (`auto`|`js`|`angular`).
- **Steps:** (1) validate it's a library; (2) add the `reusable-tool:extraction-candidate` tag; (3) detect `kind` from the build executor / deps; (4) capture installed framework version ranges (for the major-tracking rule, decision #2); (5) write `extraction.json` (status `candidate`).
- **Result:** tagged lib + committed marker. Project still uses it via its path alias — nothing breaks.
- **Idempotent:** re-runs preserve lifecycle (`ingested`) and prior input.
- **Code:** `nx-tools/src/generators/mark-extractable/`.

### 4b. `extract-tool` — host tool (cross-workspace), runs in Docker — ✅ BUILT (Phase 2)

Lift a candidate from a project into the shared workspace as a publishable package. **Not** a generator (§2.1) — and **runs in Docker**, because the host's Node (v12) is too old for modern Nx. A thin launcher (`extract-tool.sh`) runs the logic (`extract-tool.mjs`) inside the `typescript-node` base image with `~/projects` mounted — exactly the `scaffold.sh` pattern — so both workspaces and the shared workspace's own Nx (its mounted `node_modules`) are reachable.

- **Invocation:** `tools/extract-tool/extract-tool.sh --from <project> [--into bespunky] [--lib <name>] [--scope @bespunky] [--dry-run] [--no-scaffold] [--force]`.
- **Pre:** Docker available; the lib has a valid `extraction.json` with `status: candidate`.
- **Steps:** (1) discover candidates (every `extraction.json` with `status: candidate`); (2) resolve `@bespunky/<name>`; (3) **new** package → scaffold the shell via the shared workspace's own generator as a subprocess (`yarn nx g @nx/js:lib` / `@nx/angular:library --publishable --importPath=<pkg>`); (4) copy the lib's `src/` in; (5) set `package.json` — name, deps, `peerDependencies` (framework deps pinned to the **installed major**, decision #2), `publishConfig.access=public` (decision #1), and the initial version (`0.<ngMajor>.0` for Angular libs, `0.0.1` otherwise; existing packages leave the bump to `nx release`); (6) write the project's marker → `status: ingested`.
- **Update existing package (decision #4):** if the package dir exists, it's an *update* (replace `src/`, refresh peerDeps; version bump left to `nx release`).
- **Output is a DRAFT for review** — source-derived peerDeps are best-effort; review them and the version before releasing. The tool does **not** publish.
- **Code:** `tools/extract-tool/` (`.sh` launcher + `.mjs` logic).
- ⚠️ **Untested end-to-end** (no marked candidate exists yet); built to the house `scaffold.sh` Docker pattern.

### 4c. `adopt-extracted` — generator, in project — ✅ BUILT (Phase 3)

Replace the local lib with the published public-npm package; close the loop. Runs as a normal generator inside the project's own workspace. Honours **verify-then-delete** (decision #3) as a **two-step** flow, since a generator can't install-build-then-conditionally-delete in one pass:

- **Options:** `lib` (required), `package` (default from the marker's `ingestedPackage`/`proposedPackage`), `version` (default `latest`), `finalize` (the delete step), `keepShim`.
- **Step 1** — `adopt-extracted <lib>`: adds the package dependency (`yarn add @bespunky/<name>` from public npm — no registry wiring, per the `nx-enso` precedent §6), **rewrites imports** from the local TS path alias → the package (best-effort module-specifier codemod), and **keeps the local lib**; marker → `adopting`.
- **Verify** — build the project to confirm the package works.
- **Step 2** — `adopt-extracted <lib> --finalize`: confirms the dep is present, then **removes the local lib** (project, files, tsconfig path alias). Loop closed.
- **`--keepShim`** — one-step staged migration instead: the lib becomes `export * from '@bespunky/<name>'` and stays; old import paths keep working.
- **Code:** `nx-tools/src/generators/adopt-extracted/`.
- ⚠️ **Untested end-to-end**; the import codemod is best-effort — review the diff and the build before `--finalize`.

---

## 5. Publish (step 5)

The mechanism does **not** reinvent publishing — it uses the shared workspace's **existing Nx Release** flow (**verified**: `nx.json` has a `release` block; packages carry `nx-release-publish`). `extract-tool` leaves the package release-ready; a human/host then runs **`nx release`** in `bespunky` (Verdaccio for local staging, public npm for the real release). Nothing new to build here.

---

## 6. Verified facts (host inspected) & remaining decisions

**Topology:** `~/projects` is a flat set of **isolated** Nx workspaces, nothing spanning them — so step 4 is a host script (§2.1). ✓

**Shared workspace — `~/projects/bespunky`, scope `@bespunky`:**
- Nx + yarn (v1) workspace; libraries live in `packages/*`. ✓
- Scaffolding generators present: **`@nx/js:lib`** (TS utils — e.g. `@bespunky/typescript-utils`) and **`@nx/angular:library`** (Angular libs built with `@nx/angular:package` / ng-packagr — e.g. `@bespunky/angular-google-maps`). `extract-tool` picks the right one by `kind`. ✓
- **Publish = Nx Release** (`nx.json` has a `release` block; packages carry an `nx-release-publish` target) → `nx release` versions + publishes. **Verdaccio** (`.verdaccio/config.yml`) is a **local staging registry** (proxies npm, offline publish allowed), *not* the projects' source. ✓

**Consume-back path (the key finding):**
- Real precedent: **`nx-enso` consumes `@bespunky/typescript-utils` from public npm** — with an **empty `.yarnrc`, no `.npmrc`, and no registry config** in its devcontainer. Projects resolve `@bespunky/*` from the **default public npm registry**.
- **So consume-back needs no project-side registry wiring**: publish the extracted package to npm (the existing pattern), then `adopt-extracted` just `yarn add @bespunky/<name>`. **The earlier "Phase 3 registry wiring" is dropped** (it would only matter for a Verdaccio-only dev loop — optional, deferred).
- Confirmed: the toolkit scaffold configures no registry today, and doesn't need to for the npm path.

**Confirmed decisions:**
1. **Publish target — public npm** (matches the existing `@bespunky/*` packages).
2. **Versioning:**
   - **Framework-coupled packages** (the lib *is* / *depends on* a well-known framework — Angular, Nx, RxJS, etc.): the package's relevant version segment and its **peerDeps follow the major installed in the source repo** (e.g. repo on Angular 20 → peer `@angular/core: ^20`, package versioned in the matching line, as `@bespunky/angular-google-maps@0.20.x` tracks Angular 20). `mark-extractable` must therefore **capture each framework dep's installed major** in the marker.
   - **Non-framework libraries:** plain **semver, to the letter** (own independent line from the initial version).
3. **Consume-back — verify, then delete.** `adopt-extracted` installs from public npm and **confirms the package resolves and builds**, and only *then* deletes the local lib. No permanent shim by default (the `--keep-shim` flag remains available for staged migrations).
4. **Update-existing-package — in scope.** `extract-tool` handles re-extraction into an already-published package as a **new version** (per the rule in #2), not only first-time extraction.

---

## 7. Phasing (post-confirmation)

- **Phase 1 ✅** — marker convention (the explicit tag + `extraction.json`) + `mark-extractable` generator. Sandbox-safe.
- **Phase 2 ✅** — the `extract-tool` host tool (Docker launcher + `.mjs`: scaffold the `@bespunky/<name>` package via `@nx/js:lib` / `@nx/angular:library`, copy source, set deps/peerDeps, mark `ingested`). Publish stays the existing `nx release`.
- **Phase 3 ✅** — `adopt-extracted` generator: two-step verify-then-delete — add + import-codemod (keep lib) → build to verify → `--finalize` removes the local lib. `--keepShim` for staged migration.
- **Phase 4 ✅ (distribution)** — `@bespunky/nx-tools` made **publishable** (compiled JS via `compile-generators.mts`; `files`/`publishConfig` set) + a Docker publish script (`tools/publish-nx-tools/`, user-run with npm auth). The scaffold's `HOUSE_BLOCK` (so both scaffold **and** `--repair`) adds `@bespunky/nx-tools` as a **devDep**, so it survives `yarn install` and the generators run natively in any project's devcontainer. The `architecture-first` skill already references "the house mechanism" generically.
  - **Bootstrapping:** publish first (`tools/publish-nx-tools/publish.sh`), then new projects get the devDep automatically and existing ones via `scaffold.sh --repair`.

## 8. Status — end-to-end tested ✅

Run in Docker against throwaway Nx workspaces (source project + a stand-in shared workspace):

- **`mark-extractable`** ✅ — tagged the lib (project-crystal: tag in `package.json`) and wrote a correct `extraction.json` (proposed package, deps, framework versions, entry, `kind`).
- **`extract-tool`** ✅ — scaffolded `@bespunky/greet` via `nx g @nx/js:library`, copied the source, set `package.json` (version `0.0.1`, deps, `publishConfig` public), flipped the marker to `ingested`.
- **`adopt-extracted`** ✅ — rewrote the consumer's import to the package, added the dep, set status `adopting`; `--finalize` planned the local-lib deletion ("loop closed"). The `yarn add` correctly 404'd (the package isn't published) — the verify gate working.

**Bug found & fixed by the e2e:** `adopt-extracted`'s import codemod only checked tsconfig path aliases, so it missed **project-crystal / package-based** workspaces (libs resolved by their `package.json` name). Now it rewrites *both* the tsconfig alias and the lib's package name.

**Only steps requiring real npm remain unexercised** (can't publish in a test): the actual `nx release` publish, the real `yarn add` resolving from npm, and a post-adopt build. The surrounding logic is validated.

*(Registry wiring is no longer a phase — projects consume `@bespunky/*` from public npm, per the `nx-enso` precedent. A Verdaccio dev-loop would be a separate optional enhancement.)*
