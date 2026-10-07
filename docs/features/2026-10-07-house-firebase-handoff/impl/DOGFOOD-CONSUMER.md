# DF2 — consumer dogfood: a house Firebase + Angular project upgrades 0.49.2 → 0.50.0

Release gate, from a consumer's point of view. Written 2026-10-07 by the DF2 unit (ledger
`handoffs/20261007T040000Z-dogfood.md`). Nothing in the toolkit was changed. The fixture lives in the scratchpad
(`…/scratchpad/df2/coach`) and is throwaway.

## Verdict: FAILED, on one regression

- **`nx run firebase:seed:build` always fails under Nx** (details in B1). This is new in 0.50.0.
- **A stack stopped through the house serve path loses its emulator data** (B2). This was observed, but not
  compared against 0.49.2.

Everything else the change promises held when observed. Most of it is clean.

## How the fixture was built

1. The released toolkit (`development` @ 4f01d00, nx-tools 0.49.2) ran
   `house.sh new --preset=angular --firebase --staging coach web`. It produced **Angular 22.1**, Nx 23.3.0,
   `"firebase": "latest"` and `"@angular/fire": "latest"`. Yarn installed firebase 12.19 at the root, and
   @angular/fire 20.1.0 with firebase 11 nested under it. That is the A1 two-SDK state.
   - The scaffold already had `proxied: true` on both auth and functions, in `environment.ts` and in the interface.
     No hand edit was needed.
2. Hand-applied shapes, one commit each:
   - a three-line model (`development → staging → main`) written with the released `branches.mjs write`, with
     string `deploys` on both stages;
   - hand `inputs` on `functions:deploy`;
   - a hand `firebase:deploy` target with inputs and its own command;
   - root `firestore.rules`, `firestore.indexes.json` and `storage.rules`, declared in `firebase.json`;
   - an `onInquiryCreated` trigger using `defineSecret('TELEGRAM_BOT_TOKEN')`, with the key added to the example;
   - a gitignored `.secret.local` holding a fake production token;
   - an edited `runConfig` in the root `apphosting.yaml`;
   - an untagged `brand` library that the app imports.
3. `house.sh upgrade --local --yes .`.
   - On `development`, the preflight **refused**: the branch is protected, and nothing was written. The message is
     clear and names the fix.
   - On a work branch, the upgrade ran: 16 rungs and 12 commits, then the generators.

## The upgrade diff, item by item

| Check | Observed | Verdict |
| --- | --- | --- |
| Pins | `pin-floating-dependencies` left both packages at `latest` and reported that no stable @angular/fire exists for Angular 22, with the two choices. | intended (a clear refusal), but see D1 |
| `.nvmrc` | `22`, read from `house.Dockerfile FROM typescript-node:22`. Functions `engines.node` is `"22"`. Nothing moved. | intended |
| firebase-tools | `devDependencies["firebase-tools"] = "15.32.1"`. It was appended after `vitest`, out of alphabetical order. `firebase` resolves from `node_modules/.bin` inside Nx targets (verified with an empty HOME). | intended (the ordering is cosmetic) |
| Devcontainer features | `firebase-cli` and `jajera/gcloud-cli` were removed. `house.packages.sh` gained `google-cloud-cli=588.0.0-0` and a `signed-by` repository. Port 4500 was forwarded and labelled. `forwardPorts` was reflowed from one line to nine. | intended. The reflow is churn. **No rebuild was observed** (no Docker here). |
| Hand `inputs` on `functions:deploy` | Kept. The house inputs were merged in as a set, and nothing was reported (correct, since nothing conflicted). Gained `dependsOn: [build, lint]`, `cache: false` and `parallelism: false`. | intended |
| Hand `firebase:deploy` | Its inputs were kept and merged. Its **command was replaced** by `node tools/firebase-deploy-rules.mjs` and **reported**, with "no record, re-apply if it was yours". On the second run there was no report, because the record exists. | intended |
| B6 (single build) | `functions[0].predeploy` is gone. `nx run functions:deploy` ran lint → build → deploy, with one build. | intended |
| `proxied` | Gone from `environment.ts` and from the interface, together with its comments. The client glue was rewritten. `?portOffset=` was dropped from `dev.json`. | intended |
| deploys | Both stages became `{ "note": … }`, byte-minimal. The feature's `branches.mjs status` reads on, and `describe` refuses on the not-yet-landed `development` copy. | intended, but see D4 |
| Seed applier | `world.mjs` lost the stock applier, the hosts and the stock `ref`/`at`, and imports them from the new `apply.mjs`. The worlds are intact. | intended |
| Secrets example | The header was rewritten. The `TELEGRAM_BOT_TOKEN` key was kept. | intended |
| Platform tags | `brand` was classified as `platform:web` from its `@angular/core` import. `shared-browser` and `worktree-domains` became `platform:shared`. The root project `@coach/source` (the verdaccio holder) **also became `platform:shared`**. Each was reported with the re-classify command. | intended. Tagging the root project is surprising but harmless. |
| Skip link | `_a11y.scss` was seeded and forwarded. The report gives the adoption snippet. Compiled in a real `nx build web` (`ds.skip-link()` and `ds.visually-hidden(true)`): the CSS is correct and token-driven. | intended |
| App Hosting comments | `apphosting.yaml`, `apphosting.staging.yaml` and `environment.prod.ts` were corrected (no `--environment`, `--root-dir`, the walk-up rule). The `runConfig` edit was preserved. | intended |
| `continuous` | Removed from `dev-server` and from every `firebase:emulators*`. `serve` gained `serve-preflight`. The firebase targets' keys were reordered (churn). | intended |
| `functions:build` `.env` asset | Removed. `firebase.json` gained `functions.configDir`. | intended |
| `.gitignore` | Gained the `.secret.sandbox.local` block. | intended |
| Second upgrade | **Empty diff.** `UPGRADE_NEXT: none`. | intended |

## Running it the way a developer would

Java is missing from this container. I ran with a JRE downloaded into the scratchpad and put on PATH for my processes
only. Chromium is the W4 proof's headless shell, using its extracted libraries.

- **Serve** (`nx serve web --port-offset=20938`, random) brought up a fully shifted stack.
  - Without Java, the emulators failed and the engine stopped the stack, exiting 1. **`nx serve` still exited 0 and
    printed "2 tasks: 2 succeeded"** (D3).
- **`dev ps`** listed the stack with each port's listening state. **`dev stop`** stopped it in under a second and
  confirmed every port was free. No process was left behind.
- **A second serve with another offset** was refused by `serve-preflight`. The message is precise. **A second plain
  `nx serve`** printed the attach notice, then waited.
- **Secrets banner**: `INERT — 1 declared (TELEGRAM_BOT_TOKEN)`. The placed `dist/apps/functions/.secret.local`
  contains `EMULATOR_INERT_TELEGRAM_BOT_TOKEN`. The production token was never read.
- **Seed applier refusal**: `node tools/seed/build.mjs default` with no emulator hosts exits 1 and names the three
  legitimate paths. Run directly, `node tools/seed/apply.mjs` is silent and exits 0. It is a library, so that is fine.
  Run outside Nx, a seed build works on its own shifted suite, and the D4 banner now reads
  `sign in as: demo@demo.test (Demo)`.
- **Deploy without credentials** (empty HOME, no `.firebaserc`): both targets fail with Firebase's own
  `Failed to authenticate, have you run firebase login?` (D5).
- **Through the origin**: curl reached Auth signUp, the Storage rules (403, which is correct), the Functions callable
  `ping`, and Firestore REST writes, all at `http://localhost:25138`.
  - **Headless Chromium on the upgraded app**: it crashes with **`No Firebase App '[DEFAULT]'` (app/no-app)**. That
    is the A1 crash, still present, which is expected on the refusal path.
  - After following the upgrade's advice (`"firebase": "^11.8.0"`, reinstall, one `@firebase/app`), anonymous
    sign-in succeeded. Every request went to the page's own origin: `/identitytoolkit…/accounts:signUp` and
    `accounts:lookup`. **Zero off-origin requests.**
- **Lint and firewall**:
  - `brand` (web) importing a new untagged lib fails with Nx's fixed text,
    `A project tagged with "platform:web" can only depend on libs tagged with "platform:web", "platform:shared"`.
  - `functions` (server) importing `brand` (web) fails the same way.
  - `nx g @bespunky/nx-tools:platform util` inferred `platform:web` and lint passed.
  - **But the web app has no `lint` target** (D2).

## Bugs

- **B1 — seed:build is broken under Nx (regression, new in 0.50.0).**
  - Where: `firebase-emulators/emulator-ports.mjs.tpl`, lines 106 and 120, which call `console.log(port)` and
    `console.log(offset)` on numbers. Nx run-commands sets `FORCE_COLOR=true`, so Node prints `\e[33m6000\e[39m`.
  - Effect: `build-seeds.sh` then calls `shift … <colored> …` and dies with
    `usage: emulator-ports.mjs shift`. **Expected:** a seed build. **Observed:** exit 1 in 80 ms, every time.
  - The same bug hits `ports`. Under `nx run firebase:emulators`, `reap-emulators.sh` gets colour-coded port strings,
    so its port reclaim **silently** matches nothing.
  - Fix: print strings (`String(offset)`), and add a test case that runs both commands with `FORCE_COLOR=true`.
- **B2 — stopping a stack loses its emulator data.**
  - Expected (W3, D1): `dev stop` and Ctrl+C export the suite to `.emulator-data-<offset>`.
  - Observed: data written through the origin, then `dev stop` (0.7–0.9 s) left **no export** one time and an
    **empty directory** another. SIGINT to the serve's process group also left no export.
  - The same suite run directly (`PORT_OFFSET=… bash tools/emulators.sh`) with one SIGTERM exported fully, in about
    26 s.
  - Restoring `continuous: true` on `firebase:emulators` did not help, so `stack-owned-dev-processes` is not the cause.
  - Suspect: Nx 23.3's run-commands `kill()` → `killProcessTreeGraceful(pid, SIGTERM)` signals the whole tree,
    including the JVMs, which is the double signal. W3 verified against Nx 23.1, and `new` scaffolds 23.3.
  - `dev stop` also reports "stopped — ports free" well before an export could finish.

## DX friction

- **D1 — the two refusals give conflicting advice.**
  - The migration says: pick an @angular/fire for Angular 22, or move to Angular 20.
  - The firebase-client generator, on every upgrade, says: `Set "firebase": "^11.8.0" and reinstall`. On Angular 22
    that leaves @angular/fire 20 with unmet Angular peers.
  - After that edit, `"@angular/fire": "latest"` still floats, and **nothing reports it any more**.
- **D2 — the house Angular app is created `--minimal`, with no `lint` target and no eslint config.** So the platform
  firewall never checks the web app's own imports, which is the case E4 exists for. Pre-existing, but it undercuts the
  E4 claim.
- **D3 — `nx serve` exits 0 with "succeeded" when the stack died** (here, emulators without Java). The engine exits 1,
  and the executor resolves `success: false`, but Nx reports the continuous task as succeeded. Probably pre-existing.
  An agent reading exit codes is misled.
- **D4 — the outdated `deploys` notice on a branch that is already migrated still says "run the house upgrade".**
  That branch has already run it. What is left is to land the branch.
- **D5 — deploy guidance stops at Firebase's "have you run firebase login?".** Nothing points to
  `firebase use --add` or to `-P <alias>` for a project with no `.firebaserc`.
- **D6 — in a non-TTY Nx run (how agents run), the preflight's refusal is hidden.** Only
  `✖ nx run web:serve-preflight` and a log path are printed; the explanation appears only with
  `--output-style=static`.
- **D7 — stale owned text left in existing projects.**
  - `.gitignore` still says `` `<app>:serve --portOffset` ``. The generator text was fixed, but the existing block is
    not refreshed.
  - The devcontainer still says "Forwarded at the SAME host number". The forwards now serve the Emulator UI.
- **D8 — `[firebase-emulators] Rewrote apps/web/src/app/firebase.config.ts` is printed on every upgrade, including
  the no-op second one.**
- **D9 — Firestore's websocket stays on 9150 in shifted suites** (seen in the seed build's
  `UI websocket is running on 9150`, and in the stack's reserved ports). A second concurrent suite has to fall back.
  Unverified as a collision.
- **D10 — an Nx `@nx/angular:library` created after the upgrade is born untagged.** Only house generators classify at
  birth. Lint does catch it.

## Not run, and why

- **Container rebuild** (feature removal, the gcloud image package, `which -a firebase`): there is no Docker here.
- **A real deploy and a real `firebase init`**: no credentials, by design.
- **The trigger path with the inert token**: the emulator routed `onInquiryCreated` to a worker labelled `ping`
  ("incorrect Content-Type application/protobuf"). That looks like an emulator quirk outside this change, and was not
  investigated. The inert value was confirmed from the placed file instead.
- **0.49.2 baseline for B2/D3**: not compared.
