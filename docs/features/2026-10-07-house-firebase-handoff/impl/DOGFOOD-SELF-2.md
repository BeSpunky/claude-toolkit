# DF1b: `house.sh upgrade --local .` on this repo, round 2 (after the FX1–FX3 fix round)

Worktree `hfh-df1b`, branch `chore/hfh-dogfood-self-2` (= `feat/house-firebase-handoff` at `c0daf89`). Written as it
happened, 2026-10-07. Nothing was pushed, published or bumped, and no toolkit source was touched. Run 1 is
`DOGFOOD-SELF.md`.

**Verdict: PASS.** Run 1's two template defects are gone. Every change traces to a W/FX note. The second run is a
no-op and says so. The sweep turned up two stale but harmless texts in tests and comments (*Findings*).

## The run

- `yarn install` succeeded (no changes). Then `house.sh upgrade --local --yes .` ran: `--yes` is authorised by
  CLAUDE.md's dogfood gate and by the user's standing "Claude does the verification" instruction. It exited 0.
- `[migrate] house tooling 0.49.0 -> 0.50.0`: **18 migrations** were collected from the working tree, 2 more than run
  1. The new ones are `lint-house-apps` (FX2) and `split-serve-follower` (FX1/D3). All 18 ran. Two wrote changes:
  `declare-node-version` created `.nvmrc` = `22` (from `house.Dockerfile FROM typescript-node:22`), and
  `deploys-object-form` updated `.bespunky/branches.json`. The other 16 said "No changes were made", which is
  correct for a repo with no firebase, angular, design-system or apps. No rung claimed a change it did not make.
- After that, the generators ran: gitignore (silent), devcontainer (`UPDATE house.packages.sh`), claude-settings,
  window-identity, and house-doc last (`UPDATE HOUSE.md`, `UPDATE HOUSE.rules.md`). The run ended with `UPGRADE_OK`,
  `UPGRADE_NEXT: rebuild-container`, and `UPGRADE_RELOAD: HOUSE.md HOUSE.rules.md`.
- Commits: `bacb0dd` is Nx's checkpoint, `c9bd838` holds `.nvmrc`, `ce4579a` holds `branches.json`, and `c854c84` is
  the generator output. I committed `c854c84` for review only. Do not land it: its lockfile is from a `--local` run.

## Every file changed (vs `c0daf89`)

| File | Change | Verdict |
| --- | --- | --- |
| `.bespunky/branches.json` | `stages[0].deploys` changed from a string to `{ "note": <same text> }`. Nothing else changed | intended (W9) |
| `.nvmrc` | created, `22` | intended (W1) |
| `.devcontainer/house.packages.sh` | adds the `HOUSE_REPOSITORIES` block (empty), validation of `name=version` pins, `present()`, and the `repositories()` keyring installer | intended (W1). The empty block still renders as `'\n\n'`, which is cosmetic (run 1 reported it too) |
| `HOUSE.md` | stamp `nx-tools=0.50.0 plugin=0.47.2`; "(the Playwright browsers among them)" **removed** (now gated on `web`, FX3); the `.nvmrc` sentence; the *Deploy bindings* paragraph (note / `ci` / `appHosting`, W9); the *Moving Nx is this project's job* bullet (W7) | intended |
| `HOUSE.rules.md` | *Generator-first* now points to `yarn nx list @bespunky/nx-tools` instead of "listed in HOUSE.md" (FX3); *Local servers* adds teardown by handle and the check that ports are free (W3) | intended |
| `package.json` | `@bespunky/nx-tools` changed from `0.49.0` to `0.50.0` | intended |
| `yarn.lock` | the `0.49.0` entry was removed and nothing replaced it | expected for `--local` (house.sh warns about this) |
| `CLAUDE.md`, `house.Dockerfile`, `devcontainer.json`, `-lock.json`, `post-create.sh`, `.bespunky-devcontainer.json`, `.gitignore`, `.claude/settings.json` | unchanged | intended |
| `.bespunky/house-targets.json` | not created | correct: this repo has no house project |
| Deleted | nothing | — |

**Surprising changes: none.**

### Run 1's issues

- **Fixed: "the devcontainer's image tag follow it".** It now reads "**it sets the devcontainer's image tag**, and no
  upgrade ever moves it". That is correct grammar without firebase.
- **Fixed: the ungated "House targets are yours to extend" bullet.** It is absent from HOUSE.md (grep finds no
  `House targets` or `house-targets`). It is now gated on the record, and this repo has none.
- **Fixed: `render.test.sh:106`.** The `--nodeMajor` line is now presented as the 0.29.0 example (FX3). There are no
  `nodeMajor` hits there in the sweep.
- **Still present, and not a regression: Nx's checkpoint commit has `package.json` = `file:/tmp/tmp.…/bespunky-nx-tools-0.50.0.tgz`.**
  This is the same `--local` artefact run 1 reported. It only matters if a `--local` branch is landed.

## `branches.mjs` on the migrated model

- `validate .bespunky/branches.json` reports **valid** (exit 0).
- `verify --proposed .bespunky/branches.json` reports **no violations** (exit 0). Every check is `[ok]`: direct
  commits, chain containment, no regression, and hygiene.
- `verify` and `describe` against the copy in force (`development`, which still has the string) refuse with exit 1.
  This is as designed, and the message is FX3's new one: *"this branch's copy already has the object form … it
  resolves when this branch lands on "development". Nothing else to do: no upgrade, no edit."* `status` prints the
  same note and still reads the model. Run 1's "run the house upgrade" cry-wolf is gone.

## Idempotency

The second `house.sh upgrade --local --yes .` exited 0 and printed `house tooling already at 0.50.0 — no migrations to
run`. It printed **no** `UPDATE`/`CREATE` line and nothing claiming a change, and ended with `UPGRADE_NEXT: none`
("Nothing this run wrote needs a new session or a container rebuild"). It made no new commits, `git status` was
clean, and **the diff was empty**.

## Sweep

`git grep` excluding `docs/`, `*/migrations/*` and `tools/test-migrations/*`, which are frozen history. Hits in
`migrations.json` descriptions are frozen rung text in every case.

| Identifier | Hits | Verdict |
| --- | --- | --- |
| `proxied` | `worktree-domains/proxy.mjs.tpl:8`, `worktree-domains.tpl:379`, `generators.json:77` | legitimate: they mean "reverse-proxied", not the retired switch |
| `nodeMajor` | `_utils/node-version.ts`, `devcontainer/{compose,generator}.ts`, `layers/{agent,node,descriptor}.ts`, `tools/test-layers/run.mjs` | legitimate: the internal `{{nodeMajor}}` token fed from `.nvmrc`. It is not an option in any schema |
| `--node-major` | none | clean |
| firebase-cli feature (`features/firebase-cli`, `jajera`) | `migrations.json` only; `layers/firebase.ts:91` and `new/SKILL.md:359` both say there is NO such feature; `test-layers/run.mjs:1184` asserts that it is absent | legitimate |
| `--environment staging` | `migrations.json:186`; `firebase-app-hosting/SKILL.md:37` ("that flag never existed") | legitimate |
| `portOffset=` | `_utils/inline-house-sections.ts:165` | legitimate: frozen matching text for the pre-0.5 sections it retires |
| `portOffset=` | `tools/test-scaffold/dev-engine.checks.mjs:102,114,117` | **stale illustration** (finding 1) |
| `portOffset` (no `=`) | `dev.mjs.tpl` (the `--port-offset` option field), `firebase-emulators/service-configs.ts:112` (names it as a 0.33–0.49 export) | legitimate |
| old continuous `serve` | `executors.json`, `_utils/dev-server.ts`, `follow-stack`, `serve-preflight`, `serve/executor.ts` and `dev.mjs.tpl` all describe the `dev-stack` + follower split. `test-generators/cases/lint-house-apps.mjs:21` deliberately ages a fixture to the 0.49 shape. `stack-identity.mjs` and `test-layers:1274-1275` assert the new shape. There are no e2e or `devServerTarget` references to `<app>:serve` | legitimate, apart from finding 2 |

## Findings (none blocking; reported, not fixed)

1. **`tools/test-scaffold/dev-engine.checks.mjs:102,114,117`.** The test's hand-made `dev.json` declares
   `url: [{ param: 'portOffset', value: '${OFFSET}', when: 'offset' }]`, and its assertion labels say "?portOffset
   added" and "?portOffset kept (as 0.34.x did)". The mechanism under test is the generic, stack-free `url` params
   of `dev.json`, and that mechanism stays. But W4 retired the house's `?portOffset=${OFFSET}` switch, so the example
   now models a shape the house no longer writes. Renaming the param (for example to `offset`) would stop it reading
   as current.
2. **`firebase-emulators/generator.ts:72`** says "the DEV LOOP (a continuous multi-process serve)". `serve` is now the
   non-continuous follower and `dev-stack` is the continuous one. It is a comment only and loosely still true.
3. **Cosmetic, carried over from run 1:** `house.packages.sh`'s empty `HOUSE_REPOSITORIES='\n\n'`. Also, the *Moving
   Nx* bullet's example (a Vite `configLoader` warning) renders in an agent-only project that has no JS layer. It is
   harmless generic advice.
4. **Pre-existing `--local` artefact:** the checkpoint commit pins the `/tmp` tarball (see *Run 1's issues*).

## Container

This round changes nothing container-facing compared with run 1: the same `house.packages.sh` delta, and no
features, mounts, env or image changes. Run 1's rebuild checklist still applies unchanged. The firebase image half
(the gcloud apt repo, `firebase` from `node_modules/.bin`) cannot be observed from this repo. The Firebase fixture
dogfood has to observe it.
