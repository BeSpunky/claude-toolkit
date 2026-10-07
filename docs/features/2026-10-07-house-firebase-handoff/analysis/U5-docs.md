# U5 — Firebase deploy docs (C1, C2, C3)

Read-only triage against the worktree at `feat/house-firebase-handoff`. Paths are relative to the repo root.
External facts were checked against Firebase docs on 2026-10-07 (cited inline); the consumer repo was not available.

## C1 — the deploy story and the location of `apphosting.yaml`

### Verdict: CONFIRMED, and it is worse than reported

Two separate defects:

1. **The docs describe a single deploy mode (GitHub-linked auto-rollout) as the only one.** App Hosting has two:
   - **GitHub-linked** (Developer Connect): a push to the backend's live branch triggers a rollout. Firebase docs say you can
     connect a repo "at any time in the Deployment tab of a backend's settings".
   - **Local source** (`firebase deploy --only apphosting[:<backendId>]`): this needs an `apphosting` array in `firebase.json`
     (`backendId`, `rootDir`, `ignore`). Per the docs, "the entire parent directory of firebase.json will be zipped and uploaded",
     so a monorepo's `libs/` and root lockfile are available to the build. The docs also say "the same build process is used
     for local source deployments as GitHub deployments".
   The consumer ran in mode 2 for months, while every surface we generate says mode 1 is the only one.

2. **`apphosting.yaml` is seeded at the workspace root, where App Hosting never reads it in an Nx workspace.**
   - Firebase *configure* docs say: "create and edit the `apphosting.yaml` file in your **app's root directory**". The
     `apphosting.<env>.yaml` files follow the same rule.
   - Firebase *monorepos* docs say: "If you don't specify the 'root directory' field for Nx, then the build will fail."
     **An Nx backend's root directory therefore has to be the app directory (`/apps/<app>`)**, which puts the only
     `apphosting.yaml` App Hosting reads at `apps/<app>/apphosting.yaml`.
   - So the yaml we seed at the root is **dead in every house project that deploys**. This is not specific to the consumer.
   - **The staging override is dead too.** `apphosting.staging.yaml` (root) holds `scripts.buildCommand: npx nx build <app> --configuration=staging`.
     HOUSE.md.tpl:262 says this override exists to stop the staging backend from "silently ship[ping] **prod's** config".
     Because the file sits at the root, it is ignored, and that is exactly what happens.

### Does the toolkit generate both a root apphosting.yaml AND rootDir=/apps/<app>?

**Half.** The toolkit generates the root yaml. It **never** writes `rootDir`:
- `plugins/house/engine/nx-tools/src/generators/firebase-emulators/generator.ts:206` has
  `if (!tree.exists('apphosting.yaml')) tree.write('apphosting.yaml', template('apphosting.yaml.tpl'));`, at the root, for any client app.
  Line :208 writes `apphosting.staging.yaml` the same way, also at the root.
- `generator.ts:198-200`: `firebase.json` gets only `emulators` and `functions`. "Any other top-level keys the user added are preserved."
  No `apphosting` block is written. The consumer's `rootDir: /apps/<app>` came from `firebase init apphosting` or the console's
  Root Directory field, which a working Nx backend *requires*.
- Net effect: the toolkit's yaml location contradicts the only working Nx configuration. The report's proposal, "stop generating
  a root apphosting.yaml when rootDir is the app", is narrower than it needs to be. **rootDir is always the app for Nx**, so we
  should never seed at the root.

### Every wrong sentence (sweep)

| File:line | Text |
|---|---|
| `plugins/house/engine/nx-tools/src/generators/house-doc/HOUSE.md.tpl:245` | "config in `apphosting.yaml`" (no location given; fine once corrected below) |
| `…/HOUSE.md.tpl:249` | "(interactive — picks region and **links a GitHub repo**). **Link the repo this project was scaffolded with** — that linkage is what sets up deploy CI…" |
| `…/HOUSE.md.tpl:253` | "After the backend is created, **App Hosting deploys are GitHub-driven** … Tweak build/runtime behavior in `apphosting.yaml` at the workspace root." |
| `…/HOUSE.md.tpl:255` | "linking the repo at step 3 hands CI/CD to Firebase's GitHub integration" (one mode only) |
| `…/HOUSE.md.tpl:262` | staging: "`apphosting.staging.yaml`, which tells the App Hosting backend named `staging` to build…" (true only at the app root) |
| `…/HOUSE.md.tpl:291` | "Each Firebase App Hosting backend tracks one branch, chosen when the repo is linked at `firebase apphosting:backends:create`" (says nothing about the local-source mode, which tracks none) |
| `…/firebase-emulators/apphosting.yaml.tpl:9-16` | header: "LINK IT when prompted by backends:create. That linkage IS the deploy CI…" |
| `…/firebase-emulators/apphosting.staging.yaml.tpl` | header assumes the file is read (it isn't, at the root) |
| `…/firebase-emulators/environment.prod.ts.tpl:14-16` | "App Hosting deploys are GitHub-driven … `apphosting.yaml` at the workspace root." |
| `…/firebase-emulators/firebase-welcome.sh.tpl:59,64-65` | "LINK THIS REPO so deploys auto-run on push" / "deploys are GitHub-driven" |
| `…/firebase-emulators/generator.ts:32-35` | header comment: apphosting.yaml location |
| `plugins/house/skills/new/SKILL.md:30` | "Firebase App Hosting deploys are GitHub-driven" (used as the reason for offering `--github`) |
| `…/skills/new/SKILL.md:64` | "CI/deploy is Firebase's, not ours … Deploy CI is wired when the user links…" |
| `…/skills/new/SKILL.md:397` | the verbatim user-facing speech ("link this GitHub repo — that's the deploy CI") |
| `…/skills/new/SKILL.md:472,477,483` | "`apphosting.yaml` at the workspace root" ×2, "LINK THIS REPO; that linkage is the deploy CI" |
| `plugins/house/engine/house.sh:36-37, 1066, 2391` | comments: GitHub-driven deploys; apphosting.staging.yaml |
| `README.md` | not swept by me; grep `apphosting\|GitHub-driven` there too |

### Proposed fix

- **Generator (class C, a seed).** Seed `apphosting.yaml` (and `apphosting.staging.yaml` with `--staging`) at **`<clientApp root>/`**,
  resolved through the project's root (`readProjectConfiguration(tree, clientApp).root`), never a hardcoded `apps/`. One pair per client app.
  The "only if absent" rule stays. The staging template's `buildCommand` path semantics still need checking once the file lives
  in the app dir. Does App Hosting run the command from the rootDir or from the repo root? `npx nx` works from either, but this
  needs a real rollout to observe (finish gate: observe in the target).
- **Do not generate `firebase.json` → `apphosting`.** `backendId` is cloud state that does not exist at generate time. ("Never
  fabricate" also applies here.) Document instead that `firebase init apphosting` writes it, with `rootDir: "/<appRoot>"`, and
  recommend that `ignore` include `node_modules`, `.git`, `.nx`, `dist`, `.emulator-data` and `firebase-debug.log`. The upload zips
  the whole repo, so this keeps it small and keeps local emulator data off the cloud.
- **Docs: one "Deploying" section that covers both modes.**
  1. *Local source*: `firebase init apphosting` writes the firebase.json block, then `firebase deploy --only apphosting:<backendId>`.
     No GitHub is needed.
  2. *GitHub auto-rollout*: connect in Console → Backend → Settings → Deployment. Set **Root directory `/<appRoot>`** and the live branch.
     **Leave rollout path filters empty**: an Nx app builds from `libs/`, `tools/` and the root lockfile, so filtering on the app dir
     skips rollouts that matter.
  3. **How to tell which mode is live**: `firebase apphosting:backends:get <backendId> --project <id>`. The Repository column is
     empty in local-source mode and shows the repo in GitHub mode.
  4. `apphosting*.yaml` lives at **the backend's root directory** (the app dir). A file at the workspace root is ignored.
  The `new` skill's wording ("we ship no deploy workflow, Firebase owns CI") is still a good default. Present it as the
  *recommended* mode, not the only one, and drop the claim that `--github` is required for Firebase.
- **Pushback on "deploys are GitHub-driven" as the default in the `new` skill's user speech:** keep recommending the link. Say
  that local source works with no link, and that it is how you deploy before a remote exists.

### Migration: YES (one-way shape change for existing projects)

The root `apphosting.yaml` / `apphosting.staging.yaml` (and any `apphosting.<env>.yaml`) are now at the wrong shape. Proposed
rung `src/migrations/<next>/move-apphosting-config-to-app-root.ts`, with the payload bumped in the same commit:
- **Target dir:** if `firebase.json.apphosting[]` exists, use each entry's `rootDir`. This is the authoritative, user-declared
  fact, and it handles multi-app. Otherwise use the single client app's root. With several client apps and no rootDir, the target
  is a guess: **move nothing and report**.
- **Per root file:**
  - (a) **Target absent:** move it (write the target, delete the root). If the root file differs from the seed template, the user
    edited it, and moving it **makes their dead edits live**, e.g. the consumer's memory bump. That is the intended fix, but it
    changes runtime behaviour on the next rollout, so the log must say so loudly, file by file.
  - (b) **Target present and root == pristine seed:** delete the root. Nothing can depend on it.
  - (c) **Target present and root edited:** **do not merge**. A YAML semantic merge of two files where one has silently been
    ignored is a guess about intent. The root copy is dead (App Hosting cannot read it), so by the "what can still depend on it"
    test it could be removed. But it carries user intent that was never applied. Leave it and **report** it with a one-line diff hint.
- Retarget references: `git grep apphosting.yaml` in the project (README, docs). Report rather than rewrite prose.
- Fixture cases: pristine, edited, both-present, multi-app with and without firebase.json rootDir, core-only (no client app → no-op).
- **Dogfood needs a real App Hosting rollout** to observe that the moved file is now honoured, because a fixture cannot show it.

## C2 — moving a project between Google/GitHub accounts

### Verdict: CONFIRMED gap (nothing exists; `git grep -i "developer-connect\|developer connect"` → no hits in plugins)

### Fix

Docs only. **Where:** keep HOUSE.md short, with one line under the Deploying section: "moving accounts/orgs → see the
`bespunky-house:new` skill's Firebase reference". Put the recipe in a reference file the skill loads on demand. Account moves are
rare, and HOUSE.md is already long. The recipe:
1. The GitHub link lives in **Developer Connect**, not in Firebase:
   `gcloud developer-connect connections list --project <id> --location=<region>`. gcloud is in the firebase layer's devcontainer
   (`layers/firebase.ts:84`, `gcloud-cli` feature), so the recipe runs in-container.
2. Every connect attempt that was abandoned leaves a connection in `PENDING_USER_OAUTH` / `PENDING_INSTALL_APP` (the consumer had 11).
   Delete stale ones with `gcloud developer-connect connections delete <name> --location=<region>`, and keep the one the backend uses.
   Find it from `backends:get` or the console.
3. The OAuth step reuses the **browser's currently signed-in GitHub account**. Sign into the target account (or use a private
   window) before reconnecting.
4. Reconnect from Console → Backend → Settings → Deployment, then **install the Firebase GitHub app on the org** that owns the
   repo, not on the personal account. Re-set the root directory and the live branch.
5. Verify with `backends:get` (Repository column) and one test rollout.

Migration: **no**.

Extra idea: the `firebase-welcome.sh` banner and HOUSE.md could mention that `firebase login:list` / `gcloud auth list` show
*which* Google account is active. Account confusion is the root of most of this.

## C3 — `deploys` binding proposed from real state

### What exists today

- `deploys` is a free-text string (or null) on stages, releases, hotfixes and tags. It is validated only for type
  (`plugins/workflow/skills/branch-and-release/scripts/lib/model.mjs:164`), listed by `describe` (`lib/describe.mjs:17-32`), and is
  explicitly "documentation … never verified by the engine" (`SKILL.md:42`, `reference/choosing-a-branch-model.md:38`, HOUSE.md.tpl:291).
- **There already is an evidence mechanism:** `branches.mjs evidence [--json]` (`lib/evidence.mjs`), which feeds the
  investigation in `reference/choosing-a-branch-model.md` §1–5. Its bindings section:
  - reads every tracked `.github/workflows/*.yml` with triggers plus `deploySignals()`. `lib/workflows.mjs:59` already matches
    `firebase deploy` and `/deploy/i`, so a `deploy-backend.yml` **is already reported** as an inferred binding with its branch triggers;
  - lists `apphosting*.yaml`, `firebase.json` and `.firebaserc` projects as `observed`;
  - emits `'App Hosting backends / console-only deploy targets' → 'live in the cloud console — ask'` as **unobservable** (`evidence.mjs:149`).
- **The premise "branches.mjs is network-free" is false.** `remoteFacts()` (`evidence.mjs:208-237`) already shells out to an
  authenticated `gh` for branch protection and environments, and degrades to `unobservable` when gh is absent or unauthenticated.
  An authenticated API answer is explicitly an `observed` tag (`evidence.mjs:4`). What *is* by construction is "read-only, plans
  moves, never executes them, never writes the model without a human".

### Verdict: PARTLY VALID. The real gap is narrower than proposed, plus one design gap

- The "deploy-backend.yml presence" half is **already covered** by evidence.
- The App Hosting half is a real gap. It is the one fact the evidence gives up on.
- The consumer's actual pain was a different one: **drift after declaration**. Evidence runs only when someone is choosing or
  changing the model. Nothing re-checks the bindings later, so when auto-rollout went live the declared `deploys` silently went stale.

### Proposed fix

1. **Add an App Hosting probe to `evidence`, mirroring `remoteFacts`** (same pattern and precedent; still read-only and never
   writing the model). For each project in `.firebaserc`, when the `firebase` CLI exists and is logged in, run
   `firebase apphosting:backends:list --project <id> --json`. Emit one `observed` fact per backend: id, region, repository (or
   "none → local-source deploys"), root directory. On no CLI or no login, keep today's `unobservable → ask`. Caveat to verify:
   the **live branch** is on the backend's *traffic/rollout policy*, not on the backend resource, and `backends:get` may not print
   it. Check `--json` output against a real backend before promising a "branch" fact. If it is absent, the branch stays a question.
   Firebase CLI calls are slow (seconds per project) and need a login, so make the probe opt-in or time-boxed so that `evidence`
   doesn't hang.
2. **Pushback on `branches.mjs` *proposing* the binding:** the engine reports facts and the skill proposes. The mapping
   "backend X with repo Y tracks branch Z → line Z `deploys: 'App Hosting backend X (auto-rollout)'`" belongs in
   `choosing-a-branch-model.md` §4 (the model draft) and `changing-the-model.md`, where the user confirms it. That keeps the
   "nothing writes the file without a human" rule intact.
3. **Drift (the real bug):** add a `verify`-style check that compares declared `deploys` against current evidence. While
   `deploys` is free text this can only be heuristic (does it mention a backend id that evidence no longer sees, or does a
   repo-linked backend's line have `deploys: null`?). A robust version needs a **structured binding** (e.g. `deploys: { text,
   appHosting?: { project, backend } }`). That is a schema change across the model, describe, the HOUSE.md projection and every
   reader, so it needs a design decision and confirmation first (architecture-first gate), not a patch. Recommend surfacing that
   choice to the user rather than sneaking it in.
4. Cheap win regardless: a skill line, "after you connect or disconnect a repo on a backend, re-run `branches.mjs evidence` and
   update `deploys` through the change procedure". Add it to the C1 Deploying section too.

Migration: **no** (the model file is never written by migrations; a schema change, if chosen, is the change procedure's business).
