# Integration — merging W2..W8 into feat/house-firebase-handoff

Written as it happens. Order: w7, w4, w5, w2, w3, w6, w8 (w1 later). After each merge: test-generators + test-migrations.
Test-generators skips (18+) are the cases needing `@nx/angular` / `@nx/js`, which are not installed in this worktree.

## Merges

### w7 (App Hosting story)
- Clean merge. test-generators 116 ok / 18 skip · test-migrations 119 ok.

### w4 (emulators through the origin)
- Conflict: `migrations.json` — both added a 0.50.0 entry at the same spot. Resolved as a union (a 3-way JSON merge
  script over the index stages: keys either side added are kept, a key both sides changed differently would abort).
- test-generators 116 ok / 18 skip · test-migrations 127 ok.

### w5 (declared deploys, house-targets record)
- `tips.txt`: W7's App Hosting tip and W5's three deploy/targets tips are independent — kept all.
- `firebase-emulators/generator.ts` header: W5 added the rules/seedRules paragraph, W7 rewrote the apphosting.yaml line
  (seed where App Hosting reads; shadow warning) — kept both, W5's paragraph before W7's line. Import list: both sides
  added `readProjectConfiguration` — kept once.
- `skills/new/SKILL.md`: two hunks, each a pair of lines (devcontainer, emulator config / forwardPorts row, firebase.json
  row). Each side changed a DIFFERENT line of the pair against the old text: W4 the devcontainer/forwardPorts line
  (origin relay, `4500` added, no same-port requirement), W5 the firebase.json/emulator-config line (no predeploy, seeded
  rules). Took W4's line + W5's line in each — taking either side whole would have resurrected the other's removed claim.
- `HOUSE.md.tpl` *Working with Nx*: W7's "Moving Nx is this project's job" + W5's "House targets are yours to extend" —
  independent bullets, kept both.
- test-generators 128 ok / 18 skip · test-migrations 127 ok.

### w2 (emulator secrets, seed applier, configDir)
- `migrations.json`: union (split-seed-applier, retell-secrets-example added).
- `firebase-emulators/generator.ts`, `canonicalFunctionsBlock`: **real judgement.** W5 removed `predeploy` (Nx owns the
  build through `functions:deploy`'s `dependsOn`) and dropped the `lint` parameter; W2 (branched before W5) still had
  the predeploy and the `lint` parameter, and added `configDir`. Kept W5's no-predeploy signature + comment and W2's
  `configDir` paragraph; the body (auto-merged) already carried `configDir` without predeploy. Seed tooling: W5 added
  `tools/firebase-deploy-rules.mjs`; W2 replaced the inline `seed/build.mjs` write with `writeSeedTooling()` (which
  writes build.mjs + the new apply.mjs) — kept W5's deploy-rules write + W2's call.
- `skills/new/SKILL.md` *Emulator config* bullet: W5 (no predeploy, rules seeding) and W2 (sandbox gitignore line)
  edited the same line — rebuilt it from W5's text with W2's `.secret.sandbox.local` gitignore entry, and added the
  `configDir` fact W2's notes describe but the bullet did not carry.
- test-generators 129 ok / 18 skip · test-migrations 140 ok.

### w3 (stack identity, one port table)
- `migrations.json`: union (stack-owned-dev-processes).
- `emulator-ports.ts` `hostDialledPorts`: **judgement.** W3 replaced the `ALWAYS_ON` constant with the port table's
  `alwaysOn` (hub + logging); W4 had replaced that same skip with "skip hub; skip logging here because it is pushed
  once at the end, for the Emulator UI's Logs tab". Kept W4's — W3's line would skip logging and W4's trailing push
  re-adds it anyway, but W4's states the intent (logging IS host-dialled now); the table still drives `emulatorPorts`.
- `firebase-emulators/generator.ts`: header — W3's `tools/emulator-ports.mjs` + W2's `apply.mjs` mention, merged into
  one sentence. Imports — W3 retired `FIREBASE_DEFAULT_PORTS` for `defaultPort`/`renderEmulatorPortsModule`; kept W3's
  import + W7's apphosting-config import. `ensureFirebaseProject` — W5's `rulesFiles` signature + W3's "not
  `continuous`" comment.
- `tips.txt`: union. `local-server-isolation/SKILL.md`: W4's `?portOffset=`-free example line + W3's Teardown section.
- test-generators 132 ok / 18 skip · test-migrations 143 ok.

### w6 (ci layer, setup-gcp.sh, structured deploys)
- `skills/new/SKILL.md` GitHub bullet: W7 rewrote the "why offer it" reason (App Hosting's GitHub mode is recommended,
  local source needs no remote); W6 appended "unless the project wears the opt-in `ci` layer". Applied W6's tail to W7's
  text.
- `skills/new/SKILL.md` Firebase deploy bullet: **judgement.** Both rewrote the old "CI/deploy is Firebase's" bullet —
  W6 into "Deploys — two halves" (App Hosting is Firebase's; functions/rules go through `deploy` targets and the `ci`
  layer), W7 into the App Hosting facts (both modes, `--root-dir`, walk-up/shadowing, the new skill). Composed one
  bullet: W6's two-halves frame, W7's App Hosting detail in the first half, W6's second half verbatim. Follow-up
  commit: "(next bullet)" → "(the `ci` bullet below)" — a sub-bullet sits between them.
- `house/tips.txt`, `workflow/tips.txt`: union.
- test-generators 142 ok / 18 skip · test-migrations 143 ok.

### w8 (fail-closed platform firewall, skip link, Analog tsconfig)
- `migrations.json`: union.
- `firebase-emulators/generator.ts`: W8 moved `addPlatformBoundaries` out to `src/platform`; W5 had added
  `existingTargets` / `rootRulesInputs` / `seedRules` right before it. Kept W5's helpers, dropped the moved function
  (and W8's import removals stand). Header: W2/W3's tools line + W8's firewall line.
- `HOUSE.md.tpl` functions paragraph: W5 added "(see *Deploying the backend*)", W2 added the secrets table after it, W8
  rewrote the firewall sentence in the same line — W5's/W2's text with W8's firewall sentence.
- `skills/new/SKILL.md`: Cloud Functions bullet — W2's secrets sentences + W8's fail-closed firewall sentence; checklist
  row — W8's firewall row + W2's `apply.mjs`.
- test-generators 146 ok / 22 skip · test-migrations 156 ok.

### w1 (one versions source, .nvmrc, firebase-tools devDep, pinned gcloud) — merged last, as directed
- `migrations.json`: union (pin-floating-dependencies, declare-node-version, firebase-cli-from-package,
  gcloud-cli-from-image). `tips.txt`: union. `layers/firebase.ts`: both imports (W6's CI provider, W1's gcloud pin).
- `firebase-emulators/generator.ts`: imports — W8's `../../platform` + W1's versions/dependencies/node-version;
  W1's new `reportRuntimeMismatch()` placed before W5/W3's `ensureFirebaseProject` signature + comment.
- `HOUSE.md.tpl` functions paragraph: W1's `engines.node` ↔ `.nvmrc` sentence inserted into the W5/W2/W8 text.
- `skills/new/SKILL.md`, **judgement**: four lines where W1 (features → pinned image package + firebase-tools devDep;
  the Angular-major note) and W4 (forwards are for the app's port + the Emulator UI) each edited the same sentence.
  Rebuilt each from W4's text with W1's facts applied, so neither the retired features nor the retired same-port
  requirement comes back.
- No lockfile change. test-generators 162 ok / 22 skip · test-migrations 181 ok.

## Integration checks

1. **Retired keys on the first 0.50 upgrade (no `.bespunky/house-targets.json` yet).** With no record, a key the house
   no longer declares is kept as the project's. Findings:
   - `continuous` on `firebase:emulators*` / the dev-server leaf (W3): kept by the merge, but removed by rung
     `stack-owned-dev-processes` (runs before the generator). OK.
   - `serve-preflight` (W3): an addition — arrives. OK.
   - firebase.json `functions[0].predeploy` (W5): the `functions` block is re-asserted whole. OK.
   - functions:build's `.env` asset (W2): **survived** — the house dropped `options.assets` entirely, so it read as a
     project key. Fixed: new rung `0.50.0/read-functions-params-in-place` (removes exactly the house entry, the
     emptied key with it; a project-shaped `.env` asset kept + reported), 5 fixture cases; plus a generator case
     `first-050-upgrade` that ages a project to 0.49 with no record and runs rungs + generator in upgrade order —
     asserting all three retired keys are gone. Verified it FAILS without the new rung.
2. **`portOffset` sweep.** The two skill lines were already fixed on W4's branch. Fixed: firebase-auth template comment
   (`emulatorFor`), service-configs comment, the dev.json declaration example, the gitignore block's camelCase flag.
   Left with reason: the serve executors' `portOffset` option (the Nx option behind `--port-offset`), frozen migration
   texts + fixtures, the generic url-switch test in test-scaffold, `docs/shared-browser-DESIGN.md` (dated record).
3. **presets.ts:68** — `` `new` `` inside a template literal. Fixed (`'new'`). Why no test saw it: every runner (and
   the publisher) compiles through `compile-generators.mts` = `ts.transpileModule`, which emits best-effort JS and
   reports nothing unless asked; the line is in a refusal branch no valid preset reaches. `compile-generators.mts` now
   requests syntactic diagnostics and fails naming file:line (verified: the old presets.ts fails test-layers at
   compile, `presets.ts:68:70 ',' expected`).
4. **Projections.** `test-layers --write`: no layers.sh drift. mod-brand: 5 projections match. playwright-deps: match
   (playwright-core 1.63.0, debian13). firebase-compat: table matches npm (firebase-tools 15.32.1); gcloud
   588.0.0-0 published.
5. **Everything** (after all fixes): test-generators `--strict` 185/185 (with @nx/angular + @nx/js 23.1.0 linked from a
   scratch install, removed after; 163 ok / 22 skip without) · test-migrations 186/186 · test-layers 100/100 ·
   test-scaffold 20 files pass · test-tips 10 · test-voice 38/38 · test-mod-brand 8 · test-branches 49 ·
   test-standing pass · check-descriptions ok · check-script-modes ok · check-release-invariants FAILS as expected:
   `bespunky-house` (0.47.2, unbumped), `bespunky-workflow` (0.11.0, unbumped), `@bespunky/nx-tools` ("changed since
   0.50.0" — the shared pre-bump commit 53cb79d reads as a release; 0.50.0 is not published). `bespunky-design-system`
   is NOT flagged. Nothing bumped.
6. **Contradiction sweep** (`git grep` over proxied, firebase-cli, gcloud-cli/jajera, `--environment staging`,
   nodeMajor/`--node-major`, same-port, emulatorFor/offsetUrl/resolvePortOffset, GitHub-driven, ALWAYS_ON,
   FIREBASE_DEFAULT_PORTS, MAIN_WORKTREE, predeploy, continuous). Fixed: new skill passed the retired `--nodeMajor`
   and said the project's Node comes from the newest image tag / running Node (W1: `.nvmrc`); README said the Docker
   tag is "the Node source" and called the Firebase forwards "same-port forwards for the emulator suite" (W4: the app
   needs only its port; the forwards serve the Emulator UI). Remaining hits are legitimate (migration descriptions,
   the Docker-fallback `MAJOR` that only picks the generators' image, the seeds' MAIN_WORKTREE borrowing W2 kept,
   the dev engine's own `resolvePortOffset`, the App Hosting skill stating `--environment` never existed).

## Still owed before any release (not this integrator's)
- Plugin bumps: bespunky-house, bespunky-workflow; payload version commit for 0.50.0.
- Dogfood: `house.sh upgrade --local` on a Firebase fixture + a container rebuild (W1 feature removals, gcloud image
  package, never built here) — the finish gate.
- Open user question from W6: keep the string form of `deploys` as a note.
