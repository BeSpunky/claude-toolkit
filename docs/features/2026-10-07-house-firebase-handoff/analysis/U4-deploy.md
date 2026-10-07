# U4 — deploy story (B1, B2, B3, B4, B6)

Triage of the inbound handoff's deploy items against this checkout (nx-tools 0.49.2). Read-only analysis; the consumer repo was not available, so its evidence is quoted, not verified. Paths are relative to `plugins/house/engine/nx-tools/src/` unless stated.

## The one fact that reframes all five

The house's deploy story is *"App Hosting is Firebase's, CI is Firebase's"* — `generators/house-doc/HOUSE.md.tpl:253-255`: *"This project ships **no GitHub Actions deploy workflow** — linking the repo at step 3 hands CI/CD to Firebase's GitHub integration."* That is true **only for the web app**. App Hosting builds and rolls out the client; it never deploys Cloud Functions, Firestore rules/indexes or Storage rules. So the house ships a backend (the `functions` project, the emulator suite, `push-secrets`) with **no production path except a human running `nx run functions:deploy` from a laptop**, and rules/indexes with no path at all. B1–B4 are all faces of that one missing concept: **the backend deploy**. B6 is a defect inside the one path that does exist.

## Mechanics verified in this checkout

- **House-project targets are re-asserted on every upgrade.** `generators/_utils/project-files.ts:177-183` (`ensureHouseProject`): `config.targets = { ...(config.targets ?? {}), ...owned.targets }`. So the targets the generator declares (`build`, `lint`, `deploy`, `push-secrets` on `functions`; `emulators*`, `seed:build`, `reset` on `firebase`) behave as **class A per target name** — a new or changed owned target reaches every existing project on the next upgrade *without a migration*; user-added *other* targets survive. Consequence the consumer will hit: **their hand-added `inputs` on `functions:deploy` (B2) are wiped wholesale on their next upgrade**, because the owned `deploy` replaces the whole target object. Whatever we ship must carry those inputs itself.
- **`nx affected` honours `{workspaceRoot}/…` file inputs on any target.** `node_modules/nx/dist/src/project-graph/affected/locators/workspace-projects.js` (`getImplicitlyTouchedProjects` → `extractFilesFromTargetInputs`): every target's `inputs` — string `{workspaceRoot}/x`, `{fileset}` form, or via nx.json **or project-level** `namedInputs` — becomes an implicit-touch pattern for that project. So the consumer's B2 fix works, and **it does not need `nx.json` at all**: inline inputs on the owned targets (or a project-level `namedInputs` in the `firebase` house project) are enough. That keeps B2 entirely inside generator-owned territory — no class-B edit, no migration.
- **The house writes no rules at all.** `firebase.json`'s `emulators` and `functions` keys are generator-owned (`generators/firebase-emulators/generator.ts:195-200`); `firestore` / `storage` keys are never written, and no `firestore.rules`, `firestore.indexes.json` or `storage.rules` is seeded (grep: zero hits in `src/`). The consumer's root rules files are their own (`firebase init`). The Storage emulator is always in the house suite (`emulator-ports.ts:30` `HOUSE_EMULATORS`), so a project without `storage.rules` runs its Storage emulator with no rules config (behaviour of the CLI in that case not verified here — flag for the implementer).
- **The branch model is already readable by generators.** `generators/_utils/branch-model.ts` (`BranchProjection`: `production: string[]`, `productionPatterns: string[]`, `chain`, …; `branchModelFromOption` / `readBranchModel`), and the planner already hands the resolved projection to house-doc (`layers/plan.ts:31-35, 94`, `layers/cli.ts:62`). A CI generator reuses exactly that seam.

---

## B1 — no `deploy` for rules / indexes / storage rules

**Verdict: real gap, larger than reported.** It is not just a missing target: the house never configures rules at all.
**Origin:** `generators/firebase-emulators/generator.ts:454-486` (`ensureFirebaseProject` — `emulators*`, `seed:build`, `reset`, no `deploy`); `:195-200` (firebase.json: no `firestore` / `storage` keys); header `:24-49` lists no rules files.

**Fix (design):**
1. An owned `deploy` target on the `firebase` house project whose `--only` is **derived from `firebase.json`**, never hardcoded: `firestore:rules` iff `firestore.rules` is declared, `firestore:indexes` iff `firestore.indexes` is, `storage` iff `storage.rules` is. Nothing declared → no target (an empty `--only` would deploy everything). Its inputs are derived the same way (the paths `firebase.json` names, plus `{workspaceRoot}/firebase.json` and `{workspaceRoot}/.firebaserc`) — one source of truth, so wherever the project keeps its rules, `affected` sees them.
2. Seed `firestore.rules` / `firestore.indexes.json` / `storage.rules` (class C, write-once) **only when the layer is ENSURED** (`new` / `add-layer firebase`), and put them **inside the `firebase/` project** (`firebase.json` → `"firestore": { "rules": "firebase/firestore.rules", … }`). Files inside a project root are affected natively; no `{workspaceRoot}` trick needed for them.
3. **Pushback — never seed rules on a plain `upgrade`.** An existing project with no rules files in the repo has its live rules managed in the console. Seeding a default rule set and, in the same release, adding a deploy target + CI would make the first CI run **overwrite production security rules with the seed**. Derivation from `firebase.json` (point 1) is what makes this safe: no declared rules → nothing deployed.

**Output class:** the `deploy` target = owned target on a house project → reaches existing projects by upgrade (A in practice). Rules files + the `firestore`/`storage` keys = C (seeded, never owned). **Migration: no** (owned target needs none; seeding is ensure-only by design).

## B2 — root Firebase files invisible to `nx affected`

**Verdict: real gap; the consumer's diagnosis is right, the placement (nx.json) is not the best home.**
**Origin:** `generators/firebase-emulators/generator.ts:430-434` (`functions:deploy` — no `inputs`), and the absence in B1.

**Fix:** carry the inputs on the owned targets themselves:
- `functions:deploy`: `inputs: ["production", "^production", "{workspaceRoot}/firebase.json", "{workspaceRoot}/.firebaserc"]` — with a fallback to `default`/`^default` when the workspace defines no `production` named input (an `nx init` workspace may not; the generator must read `nx.json` and pick, not assume).
- `firebase:deploy`: derived from `firebase.json` as in B1.
- Optionally a **project-level** `namedInputs.firebaseConfig` in the `firebase` house project for readability — never in `nx.json`.

Why not nx.json: `nx.json` is class-B project state (created at baseline, evolved only by migration), and a nx.json named input referenced by an owned target creates a cross-file coupling the generator must then also guarantee. Inline / project-level keeps the whole thing generator-owned and self-contained.

**Output class:** owned targets (A in practice). **Migration: no.** Leftover to report, not remove: a consumer who already added `firebaseConfig` / `firestore` named inputs to `nx.json` keeps them as unused declarations — theirs, harmless; HOUSE.md (or the release note) should say they can delete them.

## B3 — no backend CI deploy workflow

**Verdict: real gap, and HOUSE.md actively misleads** (`HOUSE.md.tpl:253-255` claims CI is Firebase's; it is, for App Hosting only). Overlaps C1/C3.

**Should deploy be a toolkit concern at all? Yes — but opt-in, as its own layer.** Not every Firebase project deploys from GitHub Actions (some use Cloud Build, GitLab, or deploy by hand); forcing a workflow + GCP identity on every `add-layer firebase` would push cloud-side setup onto people who never asked. Proposal:

- A **`ci` layer** (requires `nx`; ensurable `new`/`upgrade` = explicit ensure only; evidence = the house-marked workflow file). It owns the **stack-agnostic** pipeline: `on: push` to the production lines + `workflow_dispatch` (input: all vs affected), `nrwl/nx-set-shas`, `nx affected -t deploy` / `nx run-many -t deploy`, `concurrency: { group: deploy-${{ github.ref }}, cancel-in-progress: false }`. It knows nothing about Firebase: its contract is *"every project's `deploy` target is how that project ships"* — which B1/B2 make true for the Firebase projects.
- The **cloud-auth step is a capability contribution**, the same shape as adapters' ports: the `firebase` layer contributes "authenticate to GCP" (`google-github-actions/auth` with WIF) + the forwarded args (`--project=<alias> --non-interactive`) + `tools/setup-gcp.sh`. A future AWS/Vercel layer contributes its own. CI-provider choice (GitHub today) is likewise an adapter, detected from the `origin` remote, not hardcoded.
- **Concurrent deploys:** `affected -t deploy` may run `functions:deploy` and `firebase:deploy` in parallel against one Firebase project. Mark deploy targets `parallelism: false` (Nx ≥19.5) rather than relying on a `--parallel=1` in the workflow.

**How the generator learns the production line(s):** exactly as house-doc does — the planner passes the resolved projection (`--branchProjection`, `layers/plan.ts:94`) and the generator reads it via `_utils/branch-model.ts`; standalone it reads the tree. Rules:
- **Undeclared model → write no workflow**, report it, and point at the branch-and-release skill. The toolkit never assumes `main` (the projection's whole reason to exist); a deploy trigger guessed wrong ships to production from the wrong line.
- `production` is an **array**, and `productionPatterns` (maintained release lines) exist. Deploying *every* production line to the same Firebase project is wrong for maintained versions. First cut: trigger on `projection.production` exact names only, report patterns as not wired. The real answer is a **structured `deploys` binding** (line → deploy target/alias, e.g. `{"firebase": "default"}` on `main`, `{"firebase": "staging"}` on a staging stage) in the branch model — today `deploys` is free text "documentation — nothing verifies" (`HOUSE.md.tpl:291`). That is a `workflow`-plugin schema change (branches.mjs + projection), cross-plugin, and the natural home for C3 too. With it, a staged chain gets staging deploys for free.

**Owned vs seeded: argue OWNED (class A), with adoption.** The workflow's trigger refs and `setup-gcp.sh`'s WIF attribute condition are both **derived from the branch model**; they must stay in lock-step with it and with each other. Seeded, a model change (e.g. adding a staging line, or renaming `main`) silently leaves CI deploying from the old line — or never — with nothing to detect it. Owned, the next upgrade re-renders both. Customisation lives in the seams that are already the project's: its `deploy` targets (what ships and how) and a never-regenerated hook (e.g. an optional `deploy-backend.local.yml` reusable workflow called before deploy, or simply targets). Adoption mirrors the devcontainer: a provenance marker (comment header) identifies a house-written file; an existing **unmarked** `.github/workflows/deploy-backend.yml` (this consumer's) is never overwritten — the house writes nothing over it and reports the switch (`house.sh add-layer ci` with an explicit adopt). When the model changes, the upgrade should also **say "re-run `tools/setup-gcp.sh`"** (the cloud side cannot be regenerated) — detect by stamping the refs the script was rendered for.

**Output class:** workflow + `setup-gcp.sh` = A (owned, regenerated; adoption for unmarked). **Migration: no** (new layer, explicit ensure). HOUSE.md firebase deploy section = A (house-doc), rewritten: App Hosting ships the web app; the `ci` layer (or `nx run <p>:deploy` by hand) ships functions + rules.

## B4 — IAM grants refused for agents

**Verdict: correct behaviour, real gap in what we ship around it.** Nothing in the toolkit today anticipates it; an agent following the consumer's path burns turns on refused `gcloud iam …` calls.
**Fix:** `tools/setup-gcp.sh` (owned, from the firebase layer's CI contribution): parameterised (GCP project id, GitHub `owner/repo`, production refs — rendered from the projection, overridable by flag), **idempotent** (describe-before-create for pool, OIDC provider, SA, each binding), **attribute-condition restricted** to the repo and the declared production refs, least-privilege roles (Firebase Rules Admin, Cloud Functions Developer, Service Account User on the runtime SA, Secret Manager accessor/viewer as functions need, Firebase Extensions viewer only if used — implementer to confirm the minimal set by running it), a `--dry-run` that prints every `gcloud` call, and a `--rollback`. Output: the two values the workflow needs (`workload_identity_provider`, `service_account`) printed for the human to set as repo variables (not secrets — they aren't secret).
**Up front, in three places:** the HOUSE.md firebase deploy section, the `bespunky-house:new`/`add-layer` skill text, and the script's own header: *"Claude cannot grant IAM — by design. Review this script, then run it yourself: `! bash tools/setup-gcp.sh --project <id>`."* The skill should hand the user that line instead of attempting any grant.
**Output class:** A. **Migration: no.**

## B6 — functions build twice on deploy

**Verdict: real.** `functions:deploy` has `dependsOn: ['build']` (`generator.ts:430-434`) **and** `firebase.json` → `functions[0].predeploy` runs `nx lint` + `nx build` (`generator.ts:118-131`, the array at `:129`). Under `nx run functions:deploy` the build runs once as a dependency and again nested inside `firebase deploy`. Locally the second is usually a cache hit (only if `build` is cacheable in that workspace's `targetDefaults` — the generator sets no `cache` on the target, and an `nx init` workspace may not have one); in CI without a remote cache it is a real second build, plus a nested Nx invocation inside an Nx task.

**Fix — one orchestrator, and it is Nx.** Building is Nx's job; `predeploy` is the Firebase CLI reaching back into Nx only so that a raw `firebase deploy` works. Make `functions:deploy` `dependsOn: ['build', 'lint']` (lint only where `@nx/eslint` is present — keeping today's lint gate) and **drop the `predeploy` entries** from the owned `functions` block. State in HOUSE.md: deploy through `nx run …:deploy` (or CI), never raw `firebase deploy`. If raw `firebase deploy` must stay safe, the `predeploy` can become a cheap **guard** that fails when `dist/<functions root>` is missing — not a second build. (Alternative considered and rejected: keep `predeploy`, drop `dependsOn` — it keeps the build invisible to Nx's task graph, so `affected -t deploy` can't order or cache it.)
**Output class:** both the `functions` block of `firebase.json` and the target are generator-owned → A. **Migration: no.**

---

## Summary table

| Item | Real? | Origin | Output class | Migration |
|---|---|---|---|---|
| B1 | yes (bigger: no rules configured at all) | `firebase-emulators/generator.ts:454-486`, `:195-200` | target A (owned house target); rules files C, ensure-only | no |
| B2 | yes | `generator.ts:430-434`; `_utils/project-files.ts:181` clobbers hand-added inputs | owned targets (A); avoid nx.json (B) | no |
| B3 | yes; HOUSE.md misleads | `house-doc/HOUSE.md.tpl:253-255` | new opt-in `ci` layer, workflow A + adoption | no (new layer) |
| B4 | behaviour correct; shipping gap | — | `setup-gcp.sh` A; doc A | no |
| B6 | yes | `generator.ts:129` + `:432` | A (owned firebase.json `functions` block + target) | no |

## Extra ideas / open questions

- **The B-class rule vs `ensureHouseProject`.** CLAUDE.md lists `project.json` targets as class B, but house-project targets are in fact re-asserted every run (`project-files.ts:181`). Worth stating explicitly in CLAUDE.md that *house-owned target names on house projects* are A, so the next author doesn't write a needless migration — or doesn't expect a hand edit to survive.
- **Structured `deploys` binding** in `.bespunky/branches.json` (workflow plugin) is the right seam for B3's line→target mapping and for C3. Without it, the first cut supports only `production` exact names → one Firebase alias.
- **Verify, don't assume (finish gate):** `parallelism: false` support in the pinned Nx; Storage emulator behaviour with no `storage.rules`; the minimal IAM role set (run `setup-gcp.sh` against a throwaway GCP project); `firebase deploy --only firestore:rules,firestore:indexes,storage` against a real project from a dogfood repo.
- **B5 adjacency:** the CI workflow needs a Node version and `firebase-tools`; both should come from the project (`.nvmrc`/`engines`, `firebase-tools` as a devDependency run via `npx --no-install firebase`) — so the `ci` layer depends on B5 being fixed, or it bakes a fourth copy of the Node version.
