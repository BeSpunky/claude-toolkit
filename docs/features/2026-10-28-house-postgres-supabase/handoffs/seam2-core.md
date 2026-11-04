# seam2-core: the `postgres` layer (branch feat/hps2-core)

## Layout

| Where | What |
|---|---|
| `layers/postgres.ts` | Descriptor: `requires: ['agent']`, evidence `postgres/project.json`, fragment by the declared major, `generators.workspace: [postgres, dev]`, `docSections`, `ciDeploy`, `devFragment` |
| `generators/postgres/generator.ts` | A: launcher. B: seven targets, no `projectType`. C: `.bespunky/postgres.json`, `.gitkeep`s. Firewall. Seeds served apps |
| `generators/postgres/{major,dev-fragment,ci-provider}.ts` | The major's one reader; the dependency process; the schema-stage provider |
| `generators/postgres/files/*.mjs.tpl` → `tools/postgres/` | `postgres` (verbs), `layout` (paths), `tools` (scrub, spawn), `url` (pure validation), `stack` (addressing and identity; `runningStacks` is the ONE reader of `dev ps --json`), `schema` (dbmate, seeds, format), `server` (lifecycle) |
| `versions.ts` | `POSTGRES_DEFAULT_MAJOR`, `DBMATE_VERSION`, `DBMATE_DOWNLOADS` |
| `descriptor.ts`, `devcontainer/compose.ts`, `house.packages.sh.tpl` | A third archive format, `binary` |
| `house-doc/*` | `{{#postgres}}` sections |
| `tools/test-postgres/` | The real-binary driver. `tools.mjs` installs through the GENERATED installer into a cache |
| `tools/test-scaffold/postgres-launcher.*` | Decisions against fakes |
| `tools/test-generators/cases/postgres.mjs`, `tools/test-layers/run.mjs` | Generator matrix; persistence, bare binary |

## Departures, and why

1. **A third archive format, outside the listed files.** dbmate publishes bare binaries and the installer took only `.tar.gz` and `.deb`. `postgres.md` §6 anticipated it. A project with no such tool renders the same installer bytes (asserted), so no image moves.
2. **`deploy` passes the URL in dbmate's environment, not `--url`.** ARCHITECTURE 6a says a full-host `--url`. That stands for local verbs, whose URL holds no secret; a deploy's password on argv is readable by every process. The form is tested: `--env DATABASE_URL`, an empty env file, the rest scrubbed.
3. **The variable is `POSTGRES_DEPLOY_URL`, not `DATABASE_URL`,** and a human deploy asks for the database's name on a terminal. `DATABASE_URL` is in every `.env` of a project with a database. The prompt is `postgres.md` §8's point 4. An agent has no terminal, so it is refused there.
4. **A `.env` naming the variable refuses the deploy, even with the variable set.** Nx loads `.env` files into a task, so "never a file" cannot be read off the environment.
5. **A transaction pooler is refused** (6543, `pgbouncer=true`, `-pooler.`). String-based, and fails only towards a refusal; Supabase's session pooler on 5432 passes.
6. **No template clone for `reset`.** Drop, create, migrate, seed. Deterministic, and migrations are not run twice in two forms. ARCHITECTURE said the clone "stays available"; nothing needs it yet.
7. **Seeded-once is a `COMMENT ON DATABASE` inside the seed's own transaction.** Atomic with the seed, and dies with the database, so no marker file can go stale.
8. **The server runs in its own session (`detached`).** So a Ctrl+C or closed terminal goes through the stop policy; in the group, SIGINT would reach the postmaster directly as a fast shutdown and skip the smart bound.
9. **The project has no `projectType`.** Found by the real `house.sh new`: `application` made layout inference read `postgres/` as the apps directory. Now asserted.
10. **Forced to `project.json`** under TS-solution linking, where `createProject` would write `package.json` and the evidence would vanish.

Smart bound: 2 s, below Nx's 5 s grace.

## Persistence audit

- Clusters and identity records: `~/.local/share/bespunky/postgres`, inside the persisted `~/.local`.
- psql history: would land in `$HOME`, so `PSQL_HISTORY` points there too.
- Server and dbmate: in the image, no state. dbmate writes nothing outside the run.
- `~/.pgpass`, `~/.pg_service.conf`: deliberately not kept, every child's environment is scrubbed of what points at them and a deploy's URL never lives in a file.
- No new mount. `tools/test-layers` asserts this.

## Migration finding

Nothing to migrate: a new layer. No existing shape moves. `HOUSE.md`, `HOUSE.rules.md` and the pointer are owned and regenerated, and the installer's bytes are unchanged without a bare binary.

## What the real-binary runs proved (`tools/test-postgres/run.mjs`, real 18.6, dbmate 2.37.0, real engine)

Cold boot ~810 ms, warm ~200 ms. Settings as designed. Migrate, seed, psql, reset through verbs; reset with a client open. Two stacks in a tree. A foreign identifier and a missing record refused by every verb. Stop with a client open on dev stop, SIGTERM, group SIGINT and group SIGHUP, rows intact. A write in flight at a stop commits. kill -9 of everything but the server: orphan in `dev ps`, verb refuses, a new start is refused, `dev stop` clears, next start recovers. kill -9 of the postmaster: stack fails, recovery. Bad migration: no marker, no server. Interrupted initdb: no cluster, sibling swept. Sweep drops and reports. Hostile env and `.env`: stays home, decoy untouched. Deploy: every refusal; the named database migrated; no seed; no password in output. Under `dev serve`: app starts after the seed, gets both URLs; failed migration means the app never starts.

By hand, in a real `house.sh new --local --add-layer=postgres` (wrapper host) through `./nx`: start, new-migration, migrate, reset, psql `--sql`, `--offset`, interactive psql through Nx's PTY, the deploy prompt through it, `.env` refusal.

## Not proven

- A rebuild: root install, real `apt-get satisfy`, `PSQL_HISTORY` on the real volume, data across a rebuild.
- `house.sh` on a real served app: `dev serve` was driven with a hand-written declaration matching the fragment; a generator test covers the fragment.
- Major 17 by real binaries, a major move. arm64. bookworm.
- CI on a real runner. A hosted database: `deploy` has only reached another local server.
- A real Nx `serve` kill sequence above the launcher.
- `~/.local` sweep across containers sharing a volume is not modelled: a tree visible to one and not the other would be swept. A volume belongs to one project folder, so this needs two containers on one folder.
