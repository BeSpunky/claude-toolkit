# POLISH — final polish after the release gate (firebase 13 day)

Written as it happens, 2026-10-07, on `feat/house-firebase-handoff` directly. Context: `firebase@13.0.0` was published
today (2026-10-07T19:36Z); its `@firebase/ai@3.0.0` declares `engines.node >=24.12.0`, so the released toolkit's
`"firebase": "latest"` now refuses to install on a Node-22 house container (FINAL-GATE.md §1).

## Units

| id | unit | owner | paths | status |
| --- | --- | --- | --- | --- |
| P1 | firebase-compat table records Node-engine facts; a firebase the project's Node cannot run is never chosen | main | tools/firebase-compat, _utils/firebase-compat.ts, adapters/angular/angularfire*.ts, migrations/0.50.0/firebase-compat-0.50.0.ts, house-probe.mts | done `9699e617` |
| P2 | "pin what is installed" advice describes the real installed firebase | main | adapters/angular/angularfire-judge.ts + a generator fixture | done `9699e617` |
| P3 | house.packages.sh archive comment gated with its block | main | devcontainer templates | done `1b16e718` |
| P4 | dogfood-consumer: "baseline broken upstream: <cause>" reported apart from the change's failures | subagent | tools/dogfood-consumer only | done `47aeb04f` |

## Outcomes

- **P1.** The table check passed against npm before the change: firebase 13 changes no row (it is outside every
  @angular/fire range; Angular 20's `^11.8.0` resolves 11.10.0, Angular 21's prerelease `^12.18.0` resolves 12.19.0).
  What it did not know was Node. Now every row's `firebaseResolves` and `FIREBASE_BY_DIST_TAG.latest` (13.0.0) record
  the release the spec resolves to, the Node majors (18–26) its whole dependency closure accepts (every `engines.node`,
  from npm's install documents), and the requirements that exclude any. Grouped by range; 13.0.0 needs `>=24.12.0`
  (`@firebase/ai@3.0.0` and 8 more). The judge never chooses a release whose firebase the project's Node cannot
  install: the refusal names the requirement, the package, and the project's Node (`.nvmrc`), and offers moving Node;
  the creation-time Angular choice and the move-to-Angular-N choice obey it. The probe passes its own Node resolution.
  The 0.50.0 rung's frozen table carries the same facts (0.50.0 unpublished, same projection date).
  - yarn refuses an engines mismatch; npm and pnpm only warn (unless engine-strict). The messages say exactly that.
  - A static guard (`versions` case) forbids a quoted `latest` in the payload; the dist-tag is a key the table carries,
    so the code looks it up instead of naming it.
- **P2.** "Pin what is installed and runs today: … firebase ^11.8.0" is now "Pin the installed @angular/fire 20.1.0
  with the firebase range it carries … The root firebase installed today is 13.0.0 (outside that range, and needs a
  newer Node than this project's): the reinstall replaces it with firebase 11.10.0 (as of the table)." The floating
  finding says "It has already moved: the installed firebase 13.0.0 needs Node >=24.12.0 (@firebase/ai@3.0.0); this
  project's Node is 22 (.nvmrc) …". Fixture cases: the real-installed-state advice, and Node-gated choice (Node 22
  refused with "Move this project to Node 24 or later", Node 24 chosen, unknown Node not judged).
- **P3.** The comment moved inside its own `{{#ARCHIVES}}` block; test-layers asserts it is absent without archives and
  present with them.
- **P4** (subagent). `UPSTREAM_CAUSES` (yarn / npm `EBADENGINE` / pnpm `ERR_PNPM_UNSUPPORTED_ENGINE`) classify only
  RELEASED-side failures; the toolkit under test never gets the excuse. Real run: `UPSTREAM released · new … — baseline
  broken upstream: @firebase/ai@3.0.0 requires node >=24.12.0, this Node is 22.23.2`, then `PASS (incomplete: baseline
  broken upstream — seed, upgrade not covered)` and the `YARN_IGNORE_ENGINES=true …` rerun line. `--self-test` covers
  the recognisers.

## Suites (2026-10-08)

generators 213/0 (25 skip) · migrations 276/0 · layers 102/0 · scaffold 25 files ok · branches 55 ok · tips 10 ok ·
check-descriptions ok · check-script-modes ok · firebase-tools tripwire ok · firebase-compat check ok · dogfood
`--self-test` ok. Payload type-check: no errors in the touched files (the tree's pre-existing ones are unrelated).

Not done here: no push, publish or version bump.
