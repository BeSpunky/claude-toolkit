# seam-platform: what was built

Unit of Landing 1 (`PLAN.md`), on `feat/hps-platform`.

## Names

- `StackAdapter.webOnlyImports` (required; Angular `['@angular/*']`, js `[]`). `FirebaseClientPort.serverBannedImports` is gone. `adapters/workspace.ts` gains `workspaceStacks(tree)`.
- `ensurePlatformFirewall(tree, who)` in `platform/index.ts`. `insertPlatformFirewall` is no longer exported from the platform surface: this is the one way in.
- `_utils/deploy-contract.ts`: `deployTarget(projectRoot, { command, inputs, watches, requires?, gates? })` returns `{ target, contract }`; `watchedInputs(projectRoot, watches)`.

How Landing 2 uses them:

```ts
ensurePlatformFirewall(tree, 'postgres');
const deploy = deployTarget(home.root, {
  command: 'node tools/postgres.mjs deploy',
  inputs: ['default'],
  watches: ['supabase/migrations/**/*'],   // a file or a glob, never a bare directory
});
ensureHouseProject(tree, 'postgres', home, { ..., contract: { deploy: deploy.contract }, targets: { deploy: deploy.target } });
```

`requires` takes `{ projects, target }`, which is what seam-ci's schema-before-code ordering can state.

## Where the brief's anchors did not hold

- **`firewall.ts:76-84` is not generated text.** It is `LEGACY_COMMENTS`, the pre-0.50 comment word for word, which `upgradePlatformFirewall` matches in order to delete it. `LEGACY_BANS` beside it is the same kind of record. Neutralising either would leave the old comment in every project still to upgrade, so both stay. The generated comment that did name Firebase was `PLATFORM_MEANING.server` (`platform.ts:33`), now neutral.
- **`firebase-deploy-rules.mjs.tpl` is at `generators/firebase-emulators/`,** not under `files/`.
- **The research said to extract `watchedFiles`/`unwatchedBy`. Not done.** That check exists because this deploy reads what ships from `firebase.json` at run time, so its set can drift from the inputs written at the last upgrade. A schema deploy's set is known when the generator runs, so there is no second caller, and a new owned runtime module would break Firebase's byte-identity for nothing. Extract when a deploy reads its shipping set at run time.
- **`platform.mjs` used `pg` as "a package the table does not know".** It now uses a made-up name.

## Drivers, read from each package (2026-11-04)

Banned: `pg` (imports `net`, `tls`), `pg-native` (libpq), `pg-pool`, `pg-cursor`, `pg-query-stream` (peer on `pg`), `pg-promise` (depends on `pg`), `postgres` (imports `net`, `tls`; its `workerd` condition is still server), `slonik` (`@slonik/pg-driver`). No browser field or condition in any.

Deliberately absent: `@supabase/supabase-js`, `@electric-sql/pglite`, `@prisma/client` (browser export), `knex` (browser field), `kysely`, `drizzle-orm`, `@neondatabase/serverless` (`disableWarningInBrowsers`).

## Verification

- Byte identity: every file of five Firebase fixtures (hybrid and TS-solution, with and without ESLint, Angular evidence, `seedRules`), generated before any change and after. 161 of 165 files identical. The 4 that differ are `eslint.config.mjs`: 1 comment line and the 16 new ban lines in each of `web` and `shared`.
- Existing workspace: the old generator's output re-run through the new generator changes 0 files in all five, the firewall included.
- Real lint (a scratch workspace with real `eslint` and `@nx/eslint-plugin` 23.1.0): clean `web` and `shared` projects and a `server` project on `pg` and `postgres` pass; `web` importing `pg` or `postgres`, and `shared` importing `pg/lib/index.js`, fail with Nx's ban message.
- Real Nx CLI (`nx show projects --affected --files=`), now a test case: glob and file outside the root are seen; a bare directory is not.

## Open

- **An existing firewall does not gain the drivers.** It is project state, so a Firebase project that later adds `postgres` keeps a list without `pg`. See the report: a rung, or Landing 2's call.
- **`HOUSE.md.tpl:29,249`** describes the firewall only inside `{{#firebase}}`, and line 29 says `Node / Cloud Functions`. A `postgres`-only project gets a firewall its docs do not mention. House-doc was out of this unit's scope; owed by Landing 2.
- **No ESLint config means no firewall, silently** (`ensurePlatformFirewall` returns). Behaviour kept from Firebase. A `postgres` project on the wrapper host has no lint, so nothing keeps `pg` out of a browser bundle. Landing 2 should say so.
