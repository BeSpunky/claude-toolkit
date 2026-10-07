# FF — R1 fixes (version truth, the Node source) + the scripted consumer dogfood

Worktree `hfh-ff` (branch `feat/house-firebase-handoff--ff`). Every finding was reproduced (or read and checked) before
it was fixed. Ledger: `handoffs/20261007T070000Z-ff-fanout.md`. Sub-notes: `FF-G.md` (gcloud), `FF-D.md` (dogfood tool).

## Per finding

| id | verdict | evidence | fix |
| --- | --- | --- | --- |
| R1-0 | **fixed** | Reproduced: `house.sh new --local --preset=angular --firebase shop web` → `The "vitest-angular" unit test runner requires Angular v21 or higher. Detected Angular v20.3.0` → `UPGRADE_FAILED`, rc 1. With that fixed, the REAL run exposed two more defects the vitest error had masked: (a) the workspace had **no @angular/common, compiler, forms, platform-browser, router, rxjs or zone.js** — @nx/angular 23.3's `ensureAngularDependencies` adds the runtime only when `@angular/core` is undeclared, and the creation pin declared core alone; (b) create-nx-workspace's **TypeScript 6.0.3**, which Angular 20's compiler-cli refuses (`>=5.8 <6.0`). And vitest-analog on the publishable design-system failed its own lint on Angular 20 (`@nx/dependency-checks` flags the vite config's imports). | `adapters/angular/workspace-angular.ts`: the ONE place that reads the workspace's Angular (declared first, as @nx/angular judges) and makes the major-dependent choices — `libraryUnitTestRunner`: 21+ → vitest-angular (built) / vitest-analog; below 21 → @nx/angular's own default (jest). `pinAngularForFirebase` declares @nx/angular's whole runtime set for the major from its own table (zone.js below 21, as its app generator decides) and the TypeScript the major's compiler accepts (`ANGULAR_TYPESCRIPT_BY_MAJOR`, projected from @angular/compiler-cli's peer). Swept the adapter/templates for other version-gated choices (zoneless, `provideAppInitializer`, `security.allowedHosts`, unit-test options): none other within @nx/angular 23's 20–22. **Proven**: a clean real `new --local --preset=angular --firebase shop web` → `NEW_OK` (Angular 20.3, TS ~5.9.3, @angular/fire 20.1.0, firebase ^11.8.0, firebase-tools 15.32.1); `nx run-many -t lint,test,build` → web lint/test/build, functions lint/build, design-system build/test all pass. Two lint failures remain, IDENTICAL on a fresh Angular 22 `new --preset=angular` (so not this change): design-system `@nx/dependency-checks` (`@angular/common` unused) and shared-browser `no-empty-function` ×8 — reported, out of FF's scope. |
| R1-1 | **fixed** | Ran the old rung's regex against `typescript-node:1-22-bookworm` → `1`. Feature `lts` / `22.11` → nothing written → later seeded 24. | `_utils/node-spec.ts` (pure): image tag grammar `[dev-][<imgver>-]<major>[-<distro>]` (a lone number is Node's only when typescript-node publishes it — `4-bookworm` is image 4); the official `node:` image; feature `22.11` / `lts` / `latest`; a project `build.dockerfile`'s final FROM (ARGs substituted). Unknown → reported, never seeded. Rung fixture cases: `1-22-bookworm`, `22-bookworm`, feature `22.11`, feature default `lts`, a ubuntu Dockerfile (nothing written), `.node-version` (no second file). |
| R1-2 | **fixed** | Table already said `firebaseToolsOk: false` for 17–19; the rung never read it. | The projection now carries `firebaseToolsPin` (the house pin, or the newest stable firebase-tools inside @angular/fire's peer — 13.35.1 for 17–19). The rung declares the in-peer version and says why; the generator warns with the exact version; the probe refuses `add-layer firebase` on npm where the pin is outside the peer. |
| R1-3 | **fixed** (FF-G) | Google's apt index: 543…588 only; the versioned archive still serves 480.0.0 (2024). | Versioned archive + projected sha256 per arch, a generic `archives` fragment concept, `/opt/bespunky/<id>/<version>` + `current` + `/usr/local/bin` links; pin moves switch cleanly; apt repository mechanism (and so the Signed-By conflict) removed. See `FF-G.md`. |
| R1-4 | **fixed** | `lts/*`, `lts/iron`, `node`, `22.x`, commented `.nvmrc` all threw mid-generate; odd majors passed. | nvm grammar accepted (comments, blanks, exactly one value; versions, x-ranges, `lts/*`, `lts/-n`, `lts/<codename>`, `node`/`stable`); aliases resolved from the projected, dated `node-facts.ts` (`tools/node-facts/project.mjs` — nodejs.org + MCR's tag list) and SAID; `system` / personal aliases refused. `typescript-node` majors validated (`assertNodeImage`, only where the house's image is used). All refused in house.sh's **probe** before anything is written (`house-probe.mts`), the generators keep the throw as a backstop. Functions `engines.node`: nearest runtime (below, else the oldest — 18 → 20, was 24). |
| R1-5 | **fixed** | Read: the check sat before the generator tests in the per-push job; no schedule; publish never ran it. `semver.validRange('(^21.2.0) >=21.0.0')` → null. | `.github/workflows/upstream-tables.yml` (weekly, on demand, on projection changes) runs firebase-compat + node-facts; removed from `migration-tests.yml`; `publish.sh` refuses a stale table. `minWithinMajor`: each `\|\|` alternative bounded to the major (`semver.intersects` + `minVersion`). |
| R1-6 | **fixed** | Read. | `ANGULARFIRE_TABLE_AS_OF` (moves only when the data does — the check compares as of the recorded date); every table-backed message says "as of <date>"; no "yet", no "every upgrade checks again" (a test asserts no `yet`). |
| R1-7 | **fixed** | Read: `updateJsonInPlace` on package.json in angularfire / adopt-extracted / publishable-lib / linking bypassed the guard; templates unscanned; the rung's regex disagreed with the seam. | `_utils/version-spec.ts`: ONE rule (`isPinnedSpec`, `isFloatingSpec`; links, git, file:, npm: aliases classified). `updateManifest` guards every manifest write (restores and throws on a floating addition; workspace links pass); all sites converted. The rendered functions manifest is checked. The generator test HARNESS now fails any case whose run writes a floating dependency into any package.json — every write path, templates included. Static guard extended to JSON helpers on package.json (one reasoned exemption). The rung reports with `isFloatingSpec` (`^1`, `>=1`, `1.x` now reported; fixture). |
| R1-8 | **fixed** | Read. | The projection asserts `major(angularfire) === Angular major` for every row (throws "premise gone"); the judges' premise is stated in `angularfire-judge.ts`. |
| R1-9 | **fixed** | `isPinnedSpec(installed version)` always true. | Removed (with the reason in a comment). |

## Disputes

- **Migrations importing live code** — upheld. Rule made precise (versions.ts header): a migration FREEZES every value
  it writes (pins, derived tables); it may share pure mechanics that take those values as parameters (as every rung
  shares json-edits). `angularfire-judge.ts` is pure with the table injected; `pin-floating-dependencies` and
  `firebase-cli-from-package` judge with `migrations/0.50.0/firebase-compat-0.50.0.ts` (frozen copy);
  `declare-node-version` freezes its Node facts.
- **`add-layer firebase` on Angular 22** — upheld: refused in the probe, before anything is written
  (`firebase-angular-unpaired`, with the judge's own choices). Proven by a real run (below).
- **firebase-tools as a root devDependency** — weighed, KEPT. A separate tools manifest or `npx -p` decouples the
  resolver, but costs a second install step (post-create, CI, house.sh), a second lockfile, PATH wiring for every Nx
  target, and (`npx -p`) loses lockfile pinning of the CLI's transitive graph — the very thing the pin is for. The peer
  coupling is real but narrow and now handled: within Nx 23's Angular matrix (20–22) every @angular/fire peer admits
  the pin; outside it (17–19) the rung picks the in-peer version and the probe refuses npm add-layer with the choices.
  The coupling is also *correct*: @angular/fire's peer states which CLIs its tooling works with.
- **`.nvmrc` vs `.node-version`, Volta, `engines`** — upheld. One source: the FIRST of `.nvmrc`, `.node-version`,
  `volta.node` the project has (never a second file seeded); `engines.node` is a range, only checked; disagreements
  are named on every run. CI's setup-node reads the declared file. An adopted image's own Node is named when it
  disagrees. HOUSE.md says exactly this.

## Not verified / left

(filled in at the end of the run)
