# Plan — the shir-halili-coaching handoff (draft, awaiting the user's decisions)

Input: `INBOUND-HANDOFF.md`. Evidence: `analysis/U1…U7`. Status: **proposal, nothing implemented.**

## Verdicts

| Item | Verdict | Where it originates (nx-tools/src unless noted) |
| --- | --- | --- |
| A1 | real; the class is wider | `adapters/angular/firebase-client.ts:104`; also `navigation-core:69`, `adopt-extracted:122`, `firebase-emulators:295` |
| A2 | real (the toolkit's part) | `firebase-emulators/emulators.sh.tpl:208-232` feeds prod `.secret.local`, borrows main tree's |
| A3 | real | Firestore/Storage dial ports directly; `proxied` off for migrated projects; SSR offset = 0 |
| B1 B2 B6 | real | `firebase-emulators/generator.ts:129,195-200,430-486` |
| B3 B4 | real gap (new capability) | HOUSE.md.tpl:253-255 "CI is Firebase's" |
| B5 | real; worse | `layers/firebase.ts:84` unpinned features; `engine/house.sh:1008` takes Node major from the *upgrading host* |
| C1 | real; worse | root `apphosting*.yaml` (`generator.ts:206-208`) never read → staging ships prod config |
| C2 | docs gap | — |
| C3 | partly exists | `branches.mjs evidence` sees workflows; no App Hosting probe, no recheck of `deploys` |
| D1 | real; worse | shared hub file `tmpdir/hub-<projectId>.json` → main's hub exports into the worktree's folder (data swap) |
| D2 | real | Nx shares one long-running task per workspace; key lacks the offset |
| D3 | real | skills say "tear down" with no method; no handle exists |
| D4 | real | applier lives in seeded `tools/seed/world.mjs` |
| E1 E2 E3 | not ours (firebase-tools init / upstream Nx & Analog) | docs pointer only; nav-core may show E3 too |
| E4 | real toolkit gap | platform firewall ignores untagged libs |
| E5 | consumer code; DS opportunity | skip-link primitive + `<main>` in the seeded app shell |

## Cross-cutting concepts (one fix per class, not per item)

1. **Version truth** — one versions module in nx-tools, a check that fails on any floating range a generator writes, a derived Angular→AngularFire→firebase table (`tools/…/--write`, drift-checked like playwright-deps). Node lives once in the project (`.nvmrc`), read by the composer, functions `engines`, CI. (A1, B5)
2. **Nothing local reaches production** — emulators get inert placeholder secrets for every declared key; real values only by a loud opt-in; no cross-tree borrowing; seeding refuses without emulator hosts. (A2)
3. **Stack identity** — a stack is (tree, offset). Give each one a state dir (`.bespunky/run/<stack>/`): its own `TMPDIR` (hub file), `NX_WORKSPACE_DATA_DIRECTORY` (task lock), and a run record (PID, ports, cmd) that powers `dev ps` / `dev stop`. Every emulator port (hub, logging, eventarc, tasks, websocket) from ONE generated port module; free-port check covers them. (D1, D2, D3, A3's SSR offset)
4. **One origin for the browser** — every emulator through the dev server's origin; server-side dials the container with the stack's offset. (A3)
5. **Deploy is declared, not assumed** — owned `firebase:deploy` derived from `firebase.json`, inputs on the targets themselves, Nx owns the build; an opt-in `ci` layer whose workflow refs come from the branch projection; owned `setup-gcp.sh` the human runs with `!`; a structured `deploys` binding shared with C3. (B1-B4, B6, C3)
6. **Docs say what is true** — both App Hosting modes, yaml at rootDir, account-move recipe, `nx migrate` is the project's job. (C1, C2, E2)

## Proposed release waves

1. **Safety** — Version truth (A1/B5), Nothing-local-reaches-production (A2), apphosting relocation migration + docs (C1), the D1 hub isolation part of Stack identity.
2. **Dev loop** — the rest of Stack identity (D2, `dev ps/stop`, D3 skill text), One origin (A3).
3. **Deploy** — targets (B1/B2/B6), `ci` layer + `setup-gcp.sh` (B3/B4), structured `deploys` (C3), C2 recipe.
4. **Hygiene** — firewall for untagged libs (E4), DS skip link (E5), generator-owned seed applier (D4).

## Open decisions for the user

- Wave split vs one release.
- A3: keep a direct-dial option for existing projects? (explicit backwards-compat question)
- B3: is CI deploy a toolkit concern (opt-in `ci` layer)? And the structured `deploys` schema change in the workflow plugin.
- E4: tightening the firewall makes untagged libs fail lint in existing projects.

## Notes for the consumer reply

- Owned targets are re-asserted on every upgrade (`_utils/project-files.ts:177-183`): their hand-added `inputs` on `functions:deploy` will be **wiped** by their next upgrade until wave 3 ships.
- E1/E2/E3 are not toolkit output — `firebase use --add` before `firebase init`; `nx migrate latest`.

## Corrections after adversarial verification (2026-10-07)

Ledger: `handoffs/20261007T010000Z-verify.md`; evidence: `verification/V1…V9`. Supersedes the rows above where they disagree.

- **C1 — premise refuted.** App Hosting walks up from the backend rootDir (buildpacks `detectAppHostingYAMLRoot`), so root `apphosting*.yaml` are read. The real bugs: the toolkit instructs `backends:create --environment staging`, a flag firebase-tools 15.32.1 does not have (env name never set → staging builds prod); no guidance that Nx needs Root Directory set; an app-level yaml shadows the root one. **No relocation migration** — fix the instructions instead.
- **D2 — proposed fix unsound.** The outer `serve` target is continuous and collides before the engine runs; a separate Nx data dir costs a cold graph and cache misses. Needs a design.
- **A3 — refined.** `requireLocalPort` cannot make a mismatch fail (VS Code forwards elsewhere + dialog). Origin routing works over http only; Storage resumable uploads need `changeOrigin: false`; SSR offset matters only for apps that add SSR.
- **D1 — confirmed by reproduction, both exit orders lose data.** eventarc/tasks don't collide (they float); only a declared `websocketPort` would.
- **A1 — widened.** `@angular/fire` must follow the installed Angular major (no stable release for Angular 21/22); the per-app step re-adds `latest` on every upgrade.
- **A2 — widened.** A missing or empty secret makes the emulator fetch the real Secret Manager value when the projectId is real.
- **B2 — new fact.** Owned targets are replaced whole on every upgrade (`project-files.ts:180`); CLAUDE.md's "targets are class B" is wrong for house-owned targets.
