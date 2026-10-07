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
