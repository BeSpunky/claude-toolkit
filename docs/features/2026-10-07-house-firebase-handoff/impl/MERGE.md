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
