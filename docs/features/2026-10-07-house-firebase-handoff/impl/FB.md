# FB — R2 fixes: an offline project id by default, secrets by firebase's own rules (branch `feat/house-firebase-handoff--fb`)

Scope: the emulators.sh SECRETS section, the emulator project id, seeding, `configDir`. Every finding reproduced first.

## The structural guarantee (the decision) — verified, and where it stops
- **Source (firebase-tools 15.32.1):** `emulator/controller.js:191` announces a `demo-` project ("attempts to access
  non-emulated services for this project will fail"); `adminSdkConfig.js:21,40` skips the Admin SDK config API for
  `demo-`; `management/projects.js:52,165` — Google refuses to create a `demo-` project. So every API call addressed by
  the project Firebase hands the code names a project that cannot exist.
- **Does NOT hold for** (stated in HOUSE.md, *What a local run can reach*): `getCredentialsEnvironment`
  (`emulator/env.js:47`) still passes `firebase login`/ADC credentials to functions, so code naming the REAL project or
  resource itself (hard-coded id, `projects/<real>/secrets/…`, explicit `initializeApp({projectId})`, a real bucket
  name) runs as the developer; and non-Google services (`.env` webhooks, third-party APIs). Credentials were not
  stripped: the ADC file is `$HOME/.config/gcloud/…` (google-auth-library), only hideable by moving HOME.
- **Run (real firebase-tools + Java 21, scratch):** export under `real-x`, import under `demo-real-x`: Firestore is
  project-agnostic (served under both ids), Auth imports into the current id, **Storage keys by bucket name** →
  `align-storage` moves the other mode's bucket at launch (data never silently out of sight). Tripwire (below): the
  Functions emulator under `demo-tripwire` announces it, serves the placeholder, never contacts googleapis.

## Design
- `tools/emulator-project.mjs` (owned): suite id = app id's `demo-` twin unless `environment.ts` COMMITS a service real
  (EMULATE `false` / literal `default: false`) → real id. Browser: `emulatorProjectId()`/`firebaseOptions()` in
  firebase.config.ts (bounded functions, beside FD's `emulatorEndpoint`), same rule; offline it also uses
  `<demo id>.appspot.com` (the emulated Admin SDK's default bucket). A per-session `?real=<svc>` under an offline suite
  logs why and how to commit it; `?emulate=none` is untouched.
- **Removed `FIREBASE_EMULATOR_PROJECT`** — a launch-only override splits the browser from the suite. **No compat
  kept; the orchestrator should put that question to the user.** Sandbox does NOT switch to the real id (the decision
  allows it, but the browser cannot see the sandbox choice, and third-party sandbox credentials need no real id).
- `tools/emulator-secrets.cjs` (owned): firebase's dotenv parser + key rules ported; `place` (launch) and
  `inertSecretsPlugin` (build). `tools/functions-esbuild.config.cjs` + `esbuildConfig` on `functions:build`.

## Per finding
- **R2-1 fixed.** Reproduced (inline comment / quotes went live). Values parsed, written re-quoted; refused when equal to
  ANY production value (parsed or raw, this tree's or the main worktree's `.secret.local`); banner says exact copies only.
- **R2-2 fixed.** Reproduced (`FIREBASE_SERVICE_ACCOUNT` → `parseStrict` "Validation failed", no `code` → nothing loaded).
  Refused keys left out and named; placed file re-read with the INSTALLED firebase-tools `parseStrict`; non-round-trip → exit 2.
- **R2-3 addressed by the decision** (offline id) + the exact statement above; not fully closable (credentials remain).
- **R2-4 fixed.** `tools/test-firebase-tools/run.mjs` + weekly/on-change workflow: port vs real parser (corpus, key
  rules, round-trip), `secretManagerOrigin()` honours the var, real emulator e2e. Launch checks the installed
  firebase-tools honours the sink: warn offline, exit 2 under a real id. String-form `secrets: ["K"]` scanned.
  Unverifiable without a login in CI: where the fetch dials (firebase fails at auth first) — part 2 covers the origin.
- **R2-5 fixed.** The inert file is a build output (real esbuild verified). Rung `read-functions-params-in-place`
  (reshaped, unreleased) retires the 0.49 inline `esbuildOptions` (record-less merge kept it beside `esbuildConfig` —
  reproduced in test-generators); a project's own options are kept + reported, and the generator then omits esbuildConfig.
  Not added: the two tool files as build `inputs` (a stale cache yields an equivalent inert file; launch rewrites it).
- **R2-6 confirmed + fixed.** Checked every published version: the EMULATOR reads `configDir` from **15.25.1**
  (`controller.js localCfg.configDir`; 15.25.0 does not), deploy from 14.1x. Generator warns on a lower declared pin;
  launch refuses (exit 2) below 15.25.1.
- **R2-7 fixed.** Token comparison (comments, quotes, `;`, trailing commas, arrow parens); marker/host regexes
  format-tolerant; customised applier keeps running — `build.mjs` uses `world.applyWorld` when exported; report is advice.
- **R2-8 fixed.** `apply.mjs` requires `GCLOUD_PROJECT` too (emulators:exec always sets it, `commandUtils.js:290`).
- **R2-9 fixed.** Firebase-gated rule in HOUSE.rules.md (never sandbox / never commit a real service without the user).

## For others
- **FA:** `emulators-stop.test.sh` "state dir is released" raced (release lands ~50 ms after `exited`); now polls,
  bounded. Two orphaned fake-suite processes from that test's `hang` case (from my two failing runs) were killed by PID.
- **FD:** the proxy is already id-agnostic — no change needed for the demo id.
- **push-secrets (follow-up, fixed).** Reproduced: the old script pushed `"sk_live_q" #x`, `'sk_live_s'`, the key
  `export EXPORTED`, and undecoded escapes (`tools/test-scaffold/push-secrets.test.sh` fails 11 checks on it). It now
  reads `.secret.local` through the ONE parser (`emulator-secrets.cjs push-entries`, NUL-separated pairs, values never
  printed); a malformed line or a key Firebase refuses stops the whole push (exit 2) before anything is set;
  `--dry-run` shows each key with length, sha256 prefix and edges.
- Suites after merging `feat/house-firebase-handoff`: test-generators 200/0 (25 skip), test-migrations 252/0,
  test-layers 101/0, test-scaffold 23 files ok, firebase-tools tripwire ok.
