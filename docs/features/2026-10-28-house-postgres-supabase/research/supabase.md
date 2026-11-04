# Research: Supabase as a house layer (as of 2026-11-04)

Evidence labels used throughout:

- **[SPIKE]** observed by running it in this devcontainer on 2026-11-04: Debian 13 (glibc 2.41), x86_64, user `node`, `which docker` and `which podman` both empty, CLI `supabase@3.0.0` installed from npm, `SUPABASE_HOME` in the scratchpad. The stacks used automatic or random ports. Default ports were never bound. Everything was stopped and destroyed afterwards (see *Spike ledger*).
- **[SRC]** read in `supabase/cli` at commit `d2e9c6d7c` (2026-11-04, `develop`; `v3.1.0-beta` line, slightly ahead of 3.0.0).
- **[DOC]** fetched from the named URL on 2026-11-04.
- **[UNVERIFIED]** could not be confirmed. Do not treat as fact.

## 0. The finding that changes the design

**Two days ago the CLI went to v3, and three weeks ago Supabase shipped a Docker-free local runtime.** Both post-date most of what anyone knows about the CLI, and the inbound handoff was written without them.

- `supabase@3.0.0` was published 2026-11-02 (`npm view supabase time`; [release](https://github.com/supabase/cli/releases/tag/v3.0.0)). It is a TypeScript/Bun rewrite with a new target model: everything is **local by default**, and `--remote` is the only way out.
- The **stack backend** arrived in CLI v2.119.0 and was announced on 2026-10-14 ([blog](https://supabase.com/blog/local-supabase-project-per-agent-with-or-without-docker)). It has `--runtime docker|podman|native`, one stack per git worktree, automatic ports, lazy services and a committed lock file. The native runtime runs **all services as host processes with no container engine**.
- **Status: experimental.** The feature page says "Public Alpha" ([feature page](https://supabase.com/features/native-local-runtime)), and the Select post says "alpha, off by default" ([blog, 2026-10-02](https://supabase.com/blog/select-2026-build-anything)). "It is unstable, its command interface may change, and it is excluded from the CLI compatibility promise" ([SRC] `apps/cli/docs/stack-commands.md`).
- **It works here.** [SPIKE] `supabase start --runtime native` brought up the whole stack in this devcontainer with no Docker. `db push`, `db diff`, `db reset`, `gen types`, `db dump`, worktree separation and crash recovery all passed.

So the handoff's "biggest design question" (DinD or DooD) is largely dissolved. The question becomes: *is it acceptable to depend on an alpha runtime, pinned exactly?* The verdict is in section 2.

## 1. The local stack

### 1.1 Does `supabase start` require Docker?

| Mode | Docker? | Evidence |
|---|---|---|
| Plain `supabase start` (legacy backend, flag off) | **Yes**, any Docker-API runtime | [SPIKE] fails with `DockerLifecycleInspectError: docker: command not found (podman also not found)`. [DOC] "Plain `supabase start` always uses Docker" ([runtimes](https://supabase.com/docs/guides/local-development/docker-and-native-runtimes.md)) |
| `[experimental] stack = true` or `SUPABASE_EXPERIMENTAL_STACK=1` | **No** on Linux amd64/arm64 (glibc 2.35+) and macOS 14+ arm64 | [SPIKE] selected native automatically. [DOC] same page |

Docker-API runtimes: Rancher Desktop, Podman, colima and OrbStack are listed ([getting started](https://supabase.com/docs/guides/local-development/cli/getting-started)). Selection order when `--runtime` is omitted: Docker if the **daemon answers**, then Podman, then native. Each probe waits up to 10 s. The runtime is saved with the stack and cannot be changed without destroying it ([SRC] `stack-runtime.ts`; [DOC] runtimes).

**PGlite:** I found no PGlite path in the CLI's runtime selection. `StackRuntime` is exactly `"native" | "docker" | "podman"` ([SRC]). PGlite is not an option for this layer.

Native constraints ([DOC] runtimes):

- Does **not run as root** unless `SUPABASE_NATIVE_POSTGRES_USER` names a non-root user. The house user `node` is fine.
- Needs system `tar`.
- First run downloads from the `supabase/slim-services` GitHub releases, falling back to `supabase-cli-artifacts.s3.us-east-1.amazonaws.com`. Allow `github.com` and `release-assets.githubusercontent.com`, or the S3 host.
- "Native is intended for one local project per environment" and "For several local projects on one machine, Docker remains the recommended runtime". Isolation between native stacks is weaker because they share the process table and file locks. This is the one official caveat that touches parallel agents; see section 3.
- Unsupported on the stack backend: `api.tls`, custom `edge_runtime.deno_version`, `db.major_version` other than 15 or 17, Storage Analytics and vector buckets, Auth email `content_path`, third-party identity providers ([DOC] [multiple projects](https://supabase.com/docs/guides/local-development/running-multiple-local-projects); [SRC] `stack/start/SIDE_EFFECTS.md`).
- pg_cron jobs run in background workers, so a job body cannot contain `BEGIN`/`COMMIT` ([SRC] `stack-commands.md`).

### 1.2 Services, footprint, exclusion

Services and versions pinned by `supabase.lock` under CLI 3.0.0 [SPIKE]:

| Service | Version |
|---|---|
| database (`supabase/postgres`) | 17.11.0.011 |
| auth (GoTrue) | v2.197.0 |
| rest (PostgREST) | v16.5 |
| realtime | v2.151.3 |
| storage | v1.88.0 |
| functions (edge-runtime) | v1.77.9 |
| pgmeta | v0.100.0 |
| studio | 2026.11.02-sha-a05e7ec |
| analytics (logflare) | v1.50.15 |
| mail (mailpit) | v1.31.3 |
| pooler (supavisor) | v2.9.13 |
| imgproxy | v3.26.0 |

A gateway also serves the shared API port. The stack "runs no Vector service" ([SRC]).

Footprint:

| Measure | Legacy Docker | Stack, Docker | Stack, native | Observed here [SPIKE] |
|---|---|---|---|---|
| Download (Supabase's figure) | 1.9 GB | 550 MB | 360 MB | not measured |
| Artifact cache on disk | | | | **1.7 GB** extracted (`studio` 440M, `postgres` 382M, `pgmeta` 195M, `analytics` 183M, `storage` 172M, `edge-runtime` 125M, others smaller) |
| Idle memory (Supabase's figure) | 2.6 GiB | 290 MiB | 290 MiB | about **310 MB** RSS, including about 180 MB of CLI owner processes |
| Cold start, empty cache | 93 s | 18 s | 16 s | **63 s** |
| Start with cache | 37 s | 5.2 s | 3.9 s | not measured for a new stack; **about 0.9 s** to resume after `kill -9`, **2.4 s** for a new worktree's `db start` |
| Per-stack data | | | | 46 MB fresh; 170 MB across 3 stacks |
| Two full stacks running | | | | 22 processes, about 600 MB RSS |

Supabase's figures come from the [blog](https://supabase.com/blog/local-supabase-project-per-agent-with-or-without-docker). Self-hosting all components has a different bar: 4 GB RAM minimum, 8 GB recommended ([self-hosting docs](https://supabase.com/docs/guides/self-hosting/docker)).

The CLI binary is 135 MB (`@supabase/cli-linux-x64`) [SPIKE].

**Lazy services.** Only Postgres starts by default. Others start on first request and stop after 60 s idle (Studio 5 min; Functions never). `--eager` disables this. `--preparation on-demand` defers downloads ([DOC]).

**Exclusion.**

- `supabase stack start --exclude studio,analytics -x mail`. Valid names on the stack backend: `rest, auth, realtime, storage, functions, studio, mail, analytics, pooler`. "The database is required." Excluding `rest` requires excluding `studio`. Excluding `studio` removes the MCP endpoint ([SRC], [DOC]). [SPIKE] `-x studio,analytics,mail,functions,realtime,storage,pooler` worked.
- Legacy `-x` takes **container** names: `gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor` ([SPIKE] `start --help`).
- `config.toml`: there is no literal `[service]` section. Each service has its own `enabled` key (`[auth] enabled`, `[storage] enabled`, `[studio] enabled`, and so on) ([config reference](https://supabase.com/docs/guides/local-development/cli/config)).

**Database only.** Yes. [SPIKE] `supabase db start` on the stack backend started a Postgres-only stack and applied migrations in 2.4 s (artifacts cached). A later `supabase start` upgrades it, keeping the data ([SRC]).

### 1.3 Individual services against an external Postgres

**Not supported by the CLI.** The database is a required composition member ([SRC], [DOC]), and I found no CLI option that points Auth, Storage or Realtime at an outside server.

Supabase's self-hosted Compose stack states "Multiple services require specific configuration within the Postgres database" ([self-hosting docs](https://supabase.com/docs/guides/self-hosting/docker)). Third parties do run it against external Postgres, for example [Pigsty](https://pigsty.io/docs/software/supabase), which provisions Supabase's roles, schemas and extensions itself. **[UNVERIFIED]** I did not find official documentation for that setup, and a DEV post notes the `supabase/postgres` image has much bespoke configuration.

**Consequence for the layer:** when `supabase` is worn, the Supabase stack's Postgres **is** the local database. A second, Debian-packaged Postgres beside it serves nothing.

### 1.4 CLI `db` commands against an external Postgres, without Docker

Tested [SPIKE] against a **vanilla** Postgres 17.11 (`initdb` with no Supabase roles, `wal_level=replica`) on a random port. There is no Docker anywhere on this machine.

Connection note: `--remote=<url>` **requires `?sslmode=disable`** for a server without TLS, otherwise it fails with `tls error (The server does not support SSL connections)`. `--db-url` still works in v3, prints a deprecation warning, and is removed in v4 ([DOC] [v3 guide](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3.md)).

| Command | Legacy backend (flag off), no Docker | Stack backend (flag on), no Docker |
|---|---|---|
| `migration list --remote=URL` | Works | Works |
| `db push --remote=URL [--dry-run]` | Works; creates `supabase_migrations` | Works (`db push` re-run against the hand-seeded ledger, section 5) |
| `migration up --remote=URL` | Works | Not re-run; no shadow or container involved ([SRC]) |
| `migration repair --remote=URL` | Works | Not re-run; same |
| `db reset --remote=URL` | Works. **Destructive: it dropped a table the project never migrated** | Not re-run; same |
| `gen types typescript --remote=URL` | Works; in-process, no pg-meta container | Not re-run; same |
| `db lint --remote=URL` | Works | Not re-run; same |
| `db dump --remote=URL` | **Needs Docker** (`DockerRunError`) | Works; bundled `pg_dump` |
| `db diff --remote=URL` | **Needs Docker** (shadow DB, `ImagePrepullError`) | Works; native shadow. Against vanilla Postgres the diff carries Supabase-baseline noise (`ALTER DEFAULT PRIVILEGES ... anon`) |
| `db diff --from migrations --to URL` | **Needs Docker** (`PgDeltaEngineError`) | Works |
| `db pull <name> --remote=URL` | **Needs Docker** (shadow) | Works |

Local-target commands with no stack running, legacy backend [SPIKE]:

| Command | Failure |
|---|---|
| `start`, `status`, `db start`, `functions serve`, `db reset` | Fail on the missing container runtime |
| `gen types` | Fails with `ContainerRuntimeNotFoundError`; it does `container inspect` first ([SRC] `gen/types/SIDE_EFFECTS.md`) |
| `db diff` | Fails: shadow DB image pull |
| `db push`, `migration list`, `test db` | Fail only because nothing is listening on 54322; these need a database, not Docker |

**So the correct form of the question "which commands need Docker":**

- **Legacy backend, Docker required:** `start`, `db start`, `stop`, `status`, `functions serve`, the local `db reset`, the local `gen types`, `db diff`, `db pull`, `db dump`. Also `db schema declarative *`, which uses the same shadow ([SRC]). `test db` runs `pg_prove` in a container ([SRC] `test/db/SIDE_EFFECTS.md`). Not exercised against a live database.
- **Legacy backend, no Docker:** `migration list/up/repair/new`, `db push`, `db lint`, `db reset --remote`, `gen types --remote`, `login`, `link`, `secrets`.
- **Stack backend, no Docker needed for any of the above** on native platforms: "Supported native platforms run the bundled executable ... Neither path falls back to host-installed PostgreSQL tools" ([SRC] `stack-commands.md`).
- **Rejected on the stack backend:** `--use-migra`, `--use-pgadmin`, `--diff-engine migra`.
- **`functions deploy`:** uses Docker bundling only when explicitly selected or available, and the GitHub Actions example has no Docker configuration ([DOC] [deploy](https://supabase.com/docs/guides/functions/deploy); [SRC] `functions/deploy/SIDE_EFFECTS.md`). **[UNVERIFIED]** I did not run a real deploy.

Docs lag: `apps/cli/docs/supabase/db/pull.md` still says `db pull` "requires Docker Desktop" and this is false on the stack backend. Prefer the `SIDE_EFFECTS.md` files, which are accurate and detailed.

## 2. Docker inside a devcontainer

### Verdict: don't add Docker for this layer. Use the native runtime, pinned.

| | Native (recommended) | Docker-in-Docker | Docker-outside-of-Docker |
|---|---|---|---|
| Needs privileged container | No | **Yes** (`"privileged": true`, feature 4.1.3) | No, but gives the container the host daemon |
| Workspace bind paths | Same filesystem, no translation | Same filesystem | **Broken by default** |
| Survives rebuild | `SUPABASE_HOME` on a persisted path, verified by simulation only (below) | `/var/lib/docker` is a per-container volume, plus `SUPABASE_HOME` | Host daemon keeps it, but state is shared with the host |
| Parallel isolation | Weaker; officially discouraged for several stacks on one machine | Strong | Strong, but all worktrees share the host daemon |
| Status | Alpha | Long-standing, but no official Supabase guide found | Same |
| Layer cost | One env var | A privileged flag in every consumer | A host-path mapping in every consumer |

Evidence:

- **DinD.** The feature manifest declares `privileged: true`, an entrypoint, and volumes `dind-var-lib-docker-${devcontainerId}` on `/var/lib/docker` and `dind-var-lib-containerd-${devcontainerId}` on `/var/lib/containerd` ([devcontainer-feature.json](https://github.com/devcontainers/features/blob/main/src/docker-in-docker/devcontainer-feature.json), read through `gh api`, version 4.1.3). So images and volumes outlive a rebuild. **[UNVERIFIED]** whether those per-`devcontainerId` volumes survive every rebuild path, and I did not run DinD here because the container has none. A privileged flag would also be a new property of every consumer that wears the layer.
- **DooD.** The feature states it "does not currently enable bind mounting the workspace folder by default", and the "only way to work around this is to use the **host**'s folder paths" (`LOCAL_WORKSPACE_FOLDER`), which "cannot support folders outside of the workspace folder" ([feature docs](https://github.com/devcontainers/features/tree/main/src/docker-outside-of-docker)). House worktrees live under `.claude/worktrees/` so they are inside the workspace, but `${localWorkspaceFolder}` is unavailable with a clone-in-volume.
- **Known breakage under DooD.** Bind sources resolve on the daemon's filesystem ([devcontainers/cli#613](https://github.com/devcontainers/cli/issues/613)). `supabase test db` failed with `Rel: can't make ... relative to supabase/tests`, and the reporter's workaround was DinD ([supabase/cli#4523](https://github.com/supabase/cli/issues/4523), closed). `functions deploy` looked for container paths on the host ([#2535](https://github.com/supabase/cli/issues/2535), closed not planned). `127.0.0.1` is the devcontainer's own loopback, not the host's, hence the `SUPABASE_SERVICES_HOSTNAME` override ([SRC] `hostname.ts`, `db-config.layer.ts`). A `tcp` `DOCKER_HOST` is also honoured.
- **Network.** [#1939](https://github.com/supabase/cli/issues/1939) (needing `network_mode: host`), [#3886](https://github.com/supabase/cli/issues/3886) (hostname override) and [#4484](https://github.com/supabase/cli/issues/4484) (container-in-container) were all closed by a staleness bot as `NOT_PLANNED` in May and June 2026, **not fixed by a stated resolution**. Their closure tells us nothing about whether they reproduce today. `--network-id` / `SUPABASE_NETWORK_ID` override the generated `supabase_network_<project>` ([SRC]).
- **Analytics.** A community post traced `mounts denied` on the Docker socket to `[analytics]` being enabled ([DEV](https://dev.to/davidshq/supabase-cli-and-docker-mounts-denied-2foj)). Single source, not reproduced.
- **Supabase's own position.** I found **no official Supabase guide for running the stack inside a devcontainer**. Supabase's recommendation for "coding agent sandboxes and CI runners" with no Docker daemon is the native runtime ([DOC]).

### Rebuild survival of the native runtime

[SPIKE, simulated; **I did not perform a real container rebuild**. The release gate must.]

- `kill -9` of every stack process, followed by `supabase start`: resumed in 0.9 s with the same ports and data intact.
- Moving `~/.supabase` away (the `ports.sqlite` registry) while `SUPABASE_HOME` stayed in place, which is what a rebuild would do: the stopped stack resumed in 0.9 s on the same ports with its data intact, and a fresh `ports.sqlite` appeared. No `endpoint_changes` were reported.

State layout ([SRC] `supabase-home.md`, `PortReservations.ts`; [SPIKE]):

```text
$SUPABASE_HOME (default ~/.supabase)
  access-token              0600; when there is no keyring
  telemetry.json, cli-latest, profile
  stacks/<id>/state.json, data/, uploads/, logs/   the database lives here on native
  cache/stack/              1.7 GB of artifacts, shared by all native stacks
~/.supabase/ports.sqlite    port registry; resolved from the passwd database,
                            deliberately ignoring both SUPABASE_HOME and $HOME
```

**Persistence-rule finding.** `~/.supabase` is **not** under any path the `agent` layer persists (`.claude`, `~/.config`, `~/.local`, `~/.cache`). So by default a rebuild loses the login, the local database and 1.7 GB of artifacts. The cheapest fix fits the rule "it honours an env var, point it at a persisted location": set `SUPABASE_HOME` to a persisted path such as `/home/node/.local/share/supabase` in the fragment. Write the path out literally: `${containerEnv:HOME}` is empty in every container, which is the bug this repo already paid for in 0.40.0.

`ports.sqlite` cannot follow it. Its path comes from the passwd database, and that is deliberate in the source. Losing it was harmless in the one simulation above, because `state.json` keeps each stack's ports. Whether a lost registry can let a *new* stack collide with a stopped one's saved port is **[UNVERIFIED]**; a collision would be a failed start, not silent sharing.

Keep artifacts and data apart if needed: `cache/stack` is rebuildable and `stacks/` is not, but one env var moves both.

## 3. Parallel stacks

**On the stack backend, this is solved upstream and it matches the house model closely.**

- **Identity** = project root + git branch + optional `--stack` name. Separate stacks exist per worktree, per branch checked out in the same directory, and per `--stack` name. Two agents on the same checkout and branch **share** one stack ([DOC] [multiple projects](https://supabase.com/docs/guides/local-development/running-multiple-local-projects); [SRC] `supabase-home.md`). [SPIKE] a `git worktree add` got its own stack id, database and ports automatically.
- **`project_id`** is ignored for stack identity ([DOC] config). It matters only on the legacy backend, where it names containers, volumes and `supabase_network_<id>`, so several legacy stacks need distinct `project_id`s **and** distinct ports. In v3 a missing `project_id` names containers after the folder.
- **Ports** are assigned from 20000 to 32767 and stay stable across restarts when `config.toml` has no port keys. "Automatic allocation avoids ports saved by any stack" ([SRC]). Any port key is an exact request, and a taken one fails the start. The `init` template writes them unless `SUPABASE_EXPERIMENTAL_STACK=1` was set during `init`. Keys to remove: `[api]`, `[db]`, `[db.pooler]`, `[studio]`, `[local_smtp]`, `[analytics]` `port`, `db.shadow_port`, `edge_runtime.inspector_port`, and any `smtp_port`, `pop3_port`, `analytics.vector_port`.
- **Overrides by env.** Both mechanisms exist and both work:
  - `SUPABASE_DB_PORT=<n>` (generally `SUPABASE_<UPPER_SNAKE_PATH>`). [SPIKE] the stack came up on the requested port.
  - `port = "env(MY_DB_PORT)"` in `config.toml`. [SPIKE] worked; the value is coerced to a number. "A missing or empty-string env var leaves the literal `env(NAME)` untouched" ([SRC] `cli-config-loading.md`). [SPIKE] with the variable unset, a later `db start` in that project returned in 0.2 s and left no running stack; I discarded its output, so the error text is unknown. Treat an unset port variable as a failure mode the launch script must check.

  No generated config is needed.
- **Reading the result.** `supabase status --env --output-format text` emits quoted dotenv with `DB_URL`, `API_URL`, `PUBLISHABLE_KEY`, `SECRET_KEY`, `ANON_KEY`, `SERVICE_ROLE_KEY` and more. `--output-format json` returns `env` and `endpoints`. `--override-name` renames variables.
- **Limitation.** "Database commands don't accept `--stack`"; to reach a named stack, pass its `DB_URL` as `--remote=<postgres-url>`. A loopback host on the local stack's endpoint counts as local for consent ([SRC] `command-target.md`, wording limited to local or shadow ports, so **a named stack's URL may still prompt**; use `--yes` in scripts as the docs say).

**Mapping to the house.**

1. Let the CLI pick ports and feed `DB_URL` to the backend through `dev.json` env from `status --env`. This is more robust than computing base + offset, because the CLI's allocator already avoids every stack's saved ports, and a backend-held connection doesn't need a forwarded port. Agents then never touch a default port, by construction.
2. Keep the offset form (`SUPABASE_DB_PORT`) only if the dev engine must own the numbers.
3. **A branch switch in one checkout switches stacks**, and the previous one keeps running until stopped. The dev engine's stack handling must expect that.
4. Moving or renaming a directory creates a new stack and orphans the old data until `stack destroy`.

**Open tension to decide, not to hide.** The house runs many worktrees in *one* container, and Supabase says native is meant for one project per environment. [SPIKE] two full native stacks ran concurrently and stayed separate (different databases and ports), at about 600 MB. I did not stress this: no concurrent migrations or resets across stacks, and no long-running load. A third stack I meant to include did not start, because of the unset `env()` above. Supabase's stated concern is shared process table and file locks, so **isolation failures here would be subtle rather than loud**. The dogfood should run concurrent `db reset` across worktrees.

## 4. Postgres version and extensions

- **New hosted projects: Postgres 17.** "Postgres 17 is what we currently default to on the Supabase platform" ([changelog, 2026-05-18](https://supabase.com/changelog/46080-self-hosted-supabase-upgrading-from-pg-15-to-17-breaking-change)). New features "will land on PG 17 first (and subsequently on PG 18)", with no date for 18. **[UNVERIFIED]** I could not create a project, so this is the latest statement, not an observation today.
- **Local.** `supabase init` writes `major_version = 17` [SPIKE], but the **schema default documented for the key is 15** ([DOC] config). A generator must therefore write it explicitly. The stack backend accepts only 15 or 17 ([DOC]). Changing the major requires a new stack; data is refused ([SRC]). "This has to be the same as your remote database's" (template).
- **Upgrade.** Dashboard "Upgrade project" button: the project goes offline while data is copied to a new instance. Deprecated on 17: `plcoffee`, `plls`, `plv8`, `timescaledb`, `pgjwt` ([upgrading](https://supabase.com/docs/guides/platform/upgrading)). Postgres 14 support ended 2026-07-01, and PG15's platform end of life has no date on that page ([search of changelog]; **[UNVERIFIED]** the date).
- **Extensions on `supabase/postgres:17.11.0.011`** [SPIKE, `pg_available_extensions`; 78 available]: `vector` **0.8.2**, `pg_cron` **1.6.4**, `pgmq` **1.5.1**, `pg_net` 0.20.4, `pg_graphql` 1.6.2, `pg_jsonschema` 0.3.3, `pg_partman` 5.3.1, `pgaudit` 17.1, `pgsodium` 3.1.8, `postgis` 3.3.7, `supabase_vault` 0.3.1, `wal2json` 2.6, `wrappers` 0.6.3, `hypopg` 1.4.1. Enabled by default: `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`. The hosted image's versions are **[UNVERIFIED]** but use the same image family, and `stack link` records hosted versions into the lock when linked.
- **Replication.** [SPIKE] `wal_level=logical`, `max_replication_slots=5`, `max_wal_senders=10` locally, out of the box. A vanilla `initdb` gives `replica`. `shared_preload_libraries` includes `pg_cron`, `pg_net`, `pgaudit`, `pgsodium`, `pg_tle`, `supabase_vault`, `supautils`, `auto_explain`, `plan_filter`, `plpgsql_check`, `pg_stat_statements`. So **the handoff's `wal_level=logical` requirement costs nothing in the Supabase case**, and the sync-engine later is not blocked by it. Hosted `wal_level` **[UNVERIFIED]** in this pass; Realtime depends on logical replication, so it is expected to be logical.
- **Role.** `postgres` is **not a superuser** (`rolsuper=f`); `supabase_admin` is [SPIKE]. Any tool that assumes superuser on `DB_URL` will fail, which matters to a neutral runner's `CREATE EXTENSION` statements on allowlisted extensions (handled by `supautils`).

## 5. Migrations and the single source of truth

Verified facts:

- **Naming.** The accepted pattern is `/^([0-9]+)_(.*)\.sql$/` ([SRC] `migration-list.ts`). `migration new` writes `<YYYYMMDDHHMMSS>_<name>.sql`. Files not matching are **skipped with a message** [SPIKE: `notamigration.sql`]. `1_short.sql` is accepted [SPIKE], so ordering is numeric on the prefix and timestamps aren't enforced.
- **Ledger.** `supabase_migrations.schema_migrations(version text not null [PK], statements text[], name text)` [SPIKE on a vanilla server]. Created on demand by `db push` ([SRC] `db/push/SIDE_EFFECTS.md`). `seed_files(path, hash)` is the seed ledger when `--include-seed` is used.
- **`db push` semantics.** Applies pending files in order, one `RESET ALL` + statements + ledger row per migration. Target is **local by default in v3**; `--remote` selects hosted. `--dry-run`, `--include-all`, `--include-seed`, `--include-roles`, `--skip-vault` ([SRC]). A migration older than the last applied one is **refused** with `DbPushMissingRemoteError`, and passes with `--include-all` [SPIKE]. A failing migration rolled back its earlier statement [SPIKE: `create table` then `select 1/0` left no table]; the source says compatible statements run as an implicit batch with one final `Sync`, so statements that cannot run that way may behave differently. **[UNVERIFIED]** for `CREATE INDEX CONCURRENTLY`.
- **`migration repair`** edits the ledger only: `--status reverted` removed the row and left the table [SPIKE]. `applied` inserts one.
- **`migration up`** applies pending files; `db reset` rebuilds and reseeds.
- **Seeds.** `[db.seed] enabled = true`, `sql_paths = ["./seed.sql"]`, globs relative to `supabase/`. [SPIKE] reset applied `supabase/seed.sql`. `db push` seeds only with `--include-seed`.
- **Declarative.** `supabase/schemas/` since CLI 2.115.0 (`[experimental.pgdelta] declarative_schema_path` overrides). `db schema declarative generate`, `db schema declarative sync [--no-apply]`, `db pull --declarative --remote`. "New projects from `supabase init` use it by default" ([blog](https://supabase.com/blog/select-2026-build-anything)). `sync` compares schema files to **migration history**, not the live database. Direct changes through `psql` or Studio "are silently dropped". DML is an error. `db diff` ignores the tree. Objects in `auth`, `storage` and extension-owned objects are excluded ([declarative docs](https://supabase.com/docs/guides/local-development/declarative-database-schemas)). Output is still ordinary files in `supabase/migrations`. pg-delta is the default diff engine in v3 ([DOC]).

**Can the path be redirected?**

- **`workdir` yes:** `--workdir` / `SUPABASE_WORKDIR`, "used exactly as given, with no ancestor directory search" ([SPIKE] `--help`).
- **Migrations path no:** hard-coded to `path.join(workdir, "supabase", "migrations")` at every call site ([SRC] `db-push-core.ts`, `migrate-and-seed.ts`, `migration-file.ts`, `stack-shadow.ts`, `shadow-database.ts`, `db-pull-run.ts`, `migration-fetch-run.ts`). There is no config key.
- **A symlink works.** [SPIKE] with `supabase/migrations -> ../db/migrations`: `db start` applied both files and `migration list` agreed.

**Feeding the same folder from a neutral runner works**, with one obligation: the runner must keep the same ledger. [SPIKE] a hand-created `supabase_migrations.schema_migrations` with a row for an applied migration made `db push` report "Remote database is up to date" and `migration list` show both columns matched. Without that row, `db push` would reapply the file. Any runner with its own ledger (`pgmigrate`, `dbmate`, Flyway) therefore forks the state.

### Cleanest single source of truth (my recommendation; the decision is the design's)

**One folder of plain `<timestamp>_<name>.sql` files, one ledger table: `supabase_migrations.schema_migrations`.**

| | When `postgres` alone | When `supabase` also worn |
|---|---|---|
| Who runs them locally | Neutral runner | CLI (`db push`, `db reset`) |
| Who runs them against production | Neutral runner against `DATABASE_URL`, with TLS | `db push --remote --yes`, or the same runner |
| Folder | The postgres layer's folder | Same folder, reached by the CLI through `supabase/migrations` |

Two ways to arrange the folder:

1. **Make the folder `supabase/migrations` when `supabase` is worn** (a real directory). No symlink to explain, and every Supabase doc applies as written. The catch: `postgres` has to declare the folder path as a parameter, and **adding `supabase` to an existing `postgres` project is a move**, so that path needs handling in the add-layer flow.
2. **Keep a neutral home such as `db/migrations` and symlink `supabase/migrations` to it.** Stable across adding the layer, tested once here. The catch: symlink behaviour across Windows hosts, and in `db pull` or `sync` writing through it, is **[UNVERIFIED]**.

**The ledger is the real coupling.** A neutral runner must either adopt Supabase's table name and shape from day one, even on a project that never wears Supabase, or the add-layer step must back-fill it. Adopting it from day one is the cheaper and less surprising choice: it is three columns and has no Supabase dependency, as the vanilla server test showed.

**The baseline is the other coupling, and it limits how neutral the SQL can be.** Migrations written for Supabase reference `auth.uid()`, roles `anon` and `authenticated`, and allowlisted extensions. They do not apply to a vanilla Postgres. The reverse direction is safe. [SPIKE] the shadow-diff noise against vanilla shows the baseline differs. So "the same folder" holds, but only in the direction neutral to Supabase, and a project that has adopted Supabase features can't return without reworking them. Also: when worn, run `db diff` and `declarative sync` with the CLI's own shadow, not with the neutral tooling.

## 6. CLI distribution

**Current version:** `3.0.0` (`latest`). Tags: `v2.stable` 2.122.1, `next` 3.1.0-next.1, `beta` 3.1.0-beta.11, `hotfix` 1.142.2 ([SPIKE] `npm view`, 2026-11-04).

**Cadence:** 25 stable releases from 2.101.0 (2026-05-21) to 3.0.0 (2026-11-02), about one every 7 days, with bursts; 11 betas in the two days before this report. v2 "gets security and broken-behavior fixes only" ([DOC]).

**The npm package has no postinstall any more.**

- `supabase@3.0.0`: `scripts.postinstall` is absent; 12 kB shim; `optionalDependencies` on `@supabase/cli-<platform>` for 8 platforms; `bin` → `dist/supabase.js`, which `execFileSync`s the platform binary ([SPIKE]; [SRC] `binary-distribution.md`, `bin.ts`). The older line did have one: `supabase@2.20.0` and `2.72.0` run `node scripts/postinstall.js`. It is gone by 2.100.0 ([SPIKE] `npm view`).
- So the postinstall-blocking question is **moot for v3**. [SPIKE] all of these installed and ran `--version` = 3.0.0 with no build-approval step:

| Installer | Result |
|---|---|
| `npm i -E` | OK |
| `yarn` 1.22 `add -D -E` | OK (warning about the `deno` engine in a dependency) |
| `pnpm` 12.3.4 `add -D -E` | OK |
| Yarn 4.9.1 with `nodeLinker: pnp` | OK, `yarn supabase --version` |
| `npm i -g` (prefix in the scratchpad) | **OK. The old "global install unsupported" doesn't hold in practice for v3**, though the docs still show project-local install |

- **A package manager that skips optional dependencies or filters platforms will break it**, with "No matching Supabase CLI binary package found" ([SRC] `bin.ts`). That's an install-flag and CI-cache hazard, and a lockfile committed on one OS should be checked on the other. **[UNVERIFIED]** cross-OS lockfile behaviour.
- Requires **Node 20+** through the shim ([DOC] getting started). The `apk`, `deb`, `rpm` and `tar.gz` packages are standalone Bun binaries with no Node requirement.

**Standalone.** [SPIKE, `gh release view`] v3.0.0 assets include `supabase_3.0.0_linux_amd64.{apk,deb,rpm,tar.gz}`, `supabase_linux_amd64.tar.gz` and `checksums.txt`. There is **no hosted apt repository**: release-process docs list "why no hosted apt/rpm repo" as a deliberate decision ([SRC] `release-process.md`); install is `dpkg -i` of a downloaded file. So the house's `osPackages` third-party apt repository mechanism **doesn't apply**. Community `pkgx` and `Nixpkgs` exist. "Binary signing" is noted as a non-goal ("why unsigned") so `checksums.txt` is the integrity check.

**Which to pick.** A devDependency on a **node host** is natural. On a **wrapper host** (no `package.json`, the `agent` preset) the options are a checksum-pinned tar.gz download or requiring `node`. The handoff assumed only the devDependency. A stack-neutral `postgres` should not force that, so let `supabase` declare its own requirement.

**Pinning.** `supabase` exactly, and also **commit `supabase/supabase.lock`**: it pins every service by digest and per-platform archive hash ([SPIKE]; [SRC]). `CI` set with an existing lock implies `--frozen`. Under the default `linked` specifier, `supabase link` rewrites the lock with hosted versions ("`link --frozen` ... records the link without changing the lock"), so **a human `link` produces a diff to commit**, which is the desired behaviour since it aligns local to production. `stack update` and `stack outdated` manage it. `stack install [--frozen] --runtime native` pre-downloads with no stack, a good fit for an image or post-create step **but**: it writes to `$SUPABASE_HOME/cache/stack`, so pre-fetching it in post-create is not cheap (1.7 GB) and shouldn't be automatic for every project. Note docs still name it `stack prepare` ([DOC] runtimes) while source and `stack install` are current; **verify the name on the pinned version**.

**Breaking changes in v3** ([v3 guide](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3.md)), the ones a generator must know:

- `db push`, `db pull`, `db dump`, `migration fetch/list/repair`, `inspect`, `gen types`, `storage *` target **local by default**. `--remote` is required for hosted.
- Consent: hosted mutations require `--yes` or an exported `SUPABASE_YES=1`. Piped `y` no longer counts. `SUPABASE_YES` in a project `.env*` file doesn't count, and a `.env` defining it makes the shell value not count either. Non-interactive or agent runs fail with `HostedMutationConsentRequiredError` and change nothing.
- Precedence: flag > shell env > project `.env*` (both `supabase/` and root, `.env.<SUPABASE_ENV>.local`, `.env.local`, `.env.<SUPABASE_ENV>`, `.env`) > config (`[remotes.*]` over base) > defaults. **`SUPABASE_*` variables in a project's own root `.env` now override `config.toml`, and `config push` sends them.**
- `[inbucket]` → `[local_smtp]` (a hard failure on load). `gen keys`, `db remote commit/changes`, `db branch *` removed. Removed in v4: `--linked`, `--project-ref` (except on `link`), `--db-url`, `--local`.
- `supabase-go` removed.
- `setup-cli`: `@v1` defaults to CLI 2.20.3; use `@v3`.

**Auth state and persistence.** [SRC] `login/SIDE_EFFECTS.md`, `command-credentials.layer.ts`; [SPIKE]:

| What | Where |
|---|---|
| Token, keyring available | OS keyring, service `Supabase CLI`, account = profile |
| Token, no keyring or `SUPABASE_NO_KEYRING` | `<SUPABASE_HOME or ~/.supabase>/access-token`, mode 0600 (the `SIDE_EFFECTS` file says `~/.supabase`; the code and tests honour `SUPABASE_HOME`) |
| Non-interactive token | `SUPABASE_ACCESS_TOKEN` overrides; `sbp_...` format is validated |
| Profile | `~/.supabase/profile`, when a non-default profile is set |
| Project link | Gitignored, per checkout: `supabase/.link.json` on the stack backend (`supabase/.temp/project-ref` on legacy) |

[SPIKE] in this devcontainer with no secret service, `supabase login --token` wrote the file even without `SUPABASE_NO_KEYRING`. But **`supabase logout` without `SUPABASE_NO_KEYRING` failed with `Couldn't access platform storage: PermissionDenied`**, and only succeeded with it set. Set `SUPABASE_NO_KEYRING=1` in the fragment.

**Consequences:**

- The login rule resolves to `SUPABASE_HOME` on a persisted path plus `SUPABASE_NO_KEYRING=1`: a single entry, no new mount.
- **The link is per-checkout and gitignored, so each new worktree must be linked again**, or receive `SUPABASE_PROJECT_ID`. The CLI will not leak a link across worktrees. That is the right default for "worktrees never borrow another tree's secrets", but it is a papercut to document.
- **`SUPABASE_DB_PASSWORD` is scoped by the CLI:** "Not sending `SUPABASE_DB_PASSWORD` to <target>: this directory is linked to <linked>" ([SRC]).
- Telemetry: `DO_NOT_TRACK=1` or `SUPABASE_TELEMETRY_DISABLED` suppress delivery ([SRC]). The CLI sends telemetry by default, and `login` prints a Claude Code plugin hint when `CLAUDECODE` is set on a TTY.

## 7. Current platform

**API keys.** Publishable `sb_publishable_...` replaces `anon`; secret `sb_secret_...` replaces `service_role`. Not JWTs. "Supabase is deprecating the `anon` and `service_role` keys by the end of 2026" ([API keys](https://supabase.com/docs/guides/api/api-keys)). The [changelog](https://supabase.com/changelog/29260-upcoming-changes-to-supabase-api-keys) entry lists deletion as "Late 2026, TBC" (via search summary; a direct fetch of the `.md` returned 404). **No exact date found**; treat as imminent and **[UNVERIFIED]** for a date. Locally the stack exports both key families [SPIKE]. Generators should emit `PUBLISHABLE_KEY`/`SECRET_KEY` only.

**JWT signing keys.** Asymmetric keys with JWKS at `https://<project>.supabase.co/auth/v1/.well-known/jwks.json`. The legacy secret is "No longer recommended". Backends verify through `getClaims()` or the JWKS, not the shared secret ([signing keys](https://supabase.com/docs/guides/auth/signing-keys)). Whether new projects default to asymmetric: **[UNVERIFIED]**, the page doesn't say. For the consumer's backend, verifying JWTs through JWKS is right if Supabase Auth arrives later.

**Connections (matters to the backend).** ([connecting](https://supabase.com/docs/guides/database/connecting-to-postgres), [IPv4](https://supabase.com/docs/guides/platform/ipv4-address))

| Mode | Port | Address family | Prepared statements | Use |
|---|---|---|---|---|
| Direct | 5432 | **IPv6 by default**; IPv4 with paid add-on (Pro+) | Yes | Persistent backend with IPv6 |
| Shared pooler, session (Supavisor) | 5432 | **IPv4 always** | Yes | Persistent backend on an IPv4-only network |
| Shared pooler, transaction | 6543 | IPv4 | **No** | Serverless, short-lived |

The IPv4 add-on is not dual-stack; it swaps the AAAA record for an A record. **Decision relevance:** many cloud backends are IPv4-only for egress, so the default connection for a Node backend often has to be the session pooler, and LISTEN/NOTIFY and session features need session mode rather than transaction. Add-on price: **[UNVERIFIED]** (the page refers to a usage guide).

**Sync engines:** logical replication through the shared pooler versus a direct connection, and PowerSync/Electric specifics, were not researched here. **[UNVERIFIED]**

**Branching.** GitHub integration or Dashboard (beta). Preview branches are ephemeral; persistent ones are long-lived. Data-less by default ([branching](https://supabase.com/docs/guides/deployment/branching)). `$0.01344` per branch-hour on Pro, not on Free ([pricing](https://supabase.com/pricing)). Median readiness 21 s after the October rollout ([blog]). CLI: `supabase branches`; `--remote=<branch>`.

**Edge Functions.** `[edge_runtime] deno_version = 2` is what `init` writes, with `policy = "per_worker"` [SPIKE]. Custom `deno_version` is unsupported on the stack backend, and legacy keeps `deno_version = 1` as an option. Edge runtime v1.77.9 [SPIKE]. **Exact Deno patch version: [UNVERIFIED].**

**Secrets.** `supabase secrets set NAME=value`, `--env-file <file>`, `list`, `unset`. Unattended needs `--yes`. `unset` with no names fails, `--all` removes everything. Names can't begin with `SUPABASE_`. Read immediately, no redeploy ([secrets](https://supabase.com/docs/guides/functions/secrets)). **There's no stdin form in the docs or in `secrets/set/SIDE_EFFECTS.md`**; the only stdin mention is the TTY check for the project picker. So the handoff's "via stdin like `push-secrets.sh`" **doesn't map**. The safe equivalent is `--env-file` from a private temp file (mode 0600), because `NAME=value` arguments show up in the process list. Local: `supabase/functions/.env`, and per-function `.env` files are not loaded on the stack backend ([SRC]).

**`gen types`.** `typescript`, in-process, direct DB introspection on the local or `--remote` target ([SRC] `gen/types/SIDE_EFFECTS.md`). `--project-id` is deprecated. [SPIKE] 0.5 s; output is unformatted. Works on a vanilla server through `--remote=URL`. Only meaningful in TypeScript-consuming projects, so it belongs behind an adapter.

**RLS and tenant claims.** ([RLS](https://supabase.com/docs/guides/database/postgres/row-level-security))

- Store tenant in `raw_app_meta_data` ("cannot be updated by the user"), never `raw_user_meta_data`.
- JWT claims can be stale: "If your backend has direct DB access, check membership in the database for sensitive operations."
- Wrap `auth.jwt()` / `auth.uid()` in `(select ...)` for the plan cache. Index policy columns.
- `service_role` has `bypassrls`. Views run with owner rights unless `security_invoker = true`.
- **For this consumer:** the backend connects with a Postgres role, so `auth.jwt()` isn't set unless the backend sets it. If that role is `postgres`, it owns the tables and **bypasses RLS on them unless `FORCE ROW LEVEL SECURITY`** (standard Postgres, not on the page; the page's text is only about `bypassrls`). So RLS keyed on `tenant_id` needs a dedicated non-owner, non-`bypassrls` app role, plus `SET LOCAL app.tenant_id` or equivalent. Worth a house-doc section. This is my reasoning from Postgres semantics and has not been exercised here.

**Queues.** Built on `pgmq` ([queues](https://supabase.com/docs/guides/queues)); release stage not stated. **Cron.** Built on `pg_cron`; recommended at most 8 concurrent jobs, each within 10 minutes, per-second schedules possible ([cron](https://supabase.com/docs/guides/cron)). Both are extensions on the same image [SPIKE] and portable in principle.

**Compute (new, relevant).** "Long-lived web services and agents in any language" next to your database; **private alpha with a waitlist** ([blog, 2026-10-02](https://supabase.com/blog/select-2026-build-anything)). The CLI has `experimental compute` behind `SUPABASE_EXPERIMENTAL_COMPUTE` ([SRC] `compute-commands.md`). So the handoff's "no hosting for a Node backend" is **still true for anyone not in the alpha**, with a change coming. Nothing to design for today.

**Pricing** ([pricing](https://supabase.com/pricing), [cost control](https://supabase.com/docs/guides/platform/cost-control)). The fetched pricing page may be a cached copy, though one search result flagged it as over a year old; billing docs updated 2026-10-29 agree on the base.

| Handoff claim | Verdict |
|---|---|
| Free: 500 MB DB, 1 GB storage, 5 GB egress, 2 active projects, paused after 1 week, no backups | **Correct** |
| Pro from $25, $10 compute credit, 8 GB disk, daily backups 7 days, never paused | **Correct** (Micro $10, Small $15, Medium $60) |
| PITR $100/month | **Correct**, per 7 days of retention |
| Spend cap default; compute and replicas outside it | **Correct, and broader.** Also excluded: Branching Compute, Custom Domain, provisioned IOPS and throughput, IPv4, Log Drains, MFA Phone, **PITR** |

Other: Pro 100 GB storage, 250 GB egress, 100,000 MAU, 2 M function invocations. Free 50,000 MAU, 500,000 invocations.

## 8. Official tooling for agents

- **MCP server.** Hosted `https://mcp.supabase.com/mcp`. Scope with `?project_ref=<id>` (also disables account tools), `?read_only=true` (read-only Postgres user), `?features=database,docs`. Storage is off by default ([MCP](https://supabase.com/docs/guides/getting-started/mcp)).
- **Local MCP.** Served by the stack at `<API_URL>/mcp`. "Ports are assigned per project, so read the MCP URL from this output rather than assuming a default port" ([SRC]); [SPIKE] present in `status --env` as `MCP_URL`. It requires Studio; excluding `studio` removes it. Docs' `http://localhost:54321/mcp` holds only on the legacy backend.
- **Safety guidance.** "Connecting an LLM to your Supabase projects carries security risks." Not for customers. Read-only for unattended routines. Keep manual tool approval on. Prompt injection through data is "the primary attack vector"; result wrapping "is not foolproof".
- **Agent skills.** `github.com/supabase/agent-skills`, `npx skills add supabase/agent-skills`; skills `supabase` and `supabase-postgres-best-practices` ([AI skills](https://supabase.com/docs/guides/ai-tools/ai-skills)).
- **Claude Code plugin.** The CLI's own hint names `supabase@claude-plugins-official` ([SRC] `login-claude-hint.ts`). Docs give `npx plugins add supabase-community/supabase-plugin` and say it bundles MCP and skills ([plugins](https://supabase.com/docs/guides/ai-tools/plugins)). **[UNVERIFIED]** that both are the same artifact; I did not install either.

**For the layer.**

- A layer's `claudePlugins` could name `supabase@claude-plugins-official`, but it bundles an MCP connection. Under the house's rule that local never reaches production, **a default-enabled hosted MCP with write access conflicts with it**. If enabled, it should point at the local `MCP_URL` or use `project_ref` + `read_only=true`. Check what the plugin's MCP configuration defaults to before enabling.
- Agent skills float ("We update our agent skills frequently"), which sits against "versions never float" unless the marketplace pins them. A generated pointer to them must also obey the rule for naming plugins only where enabled.

## 9. CI deploy

- **Action.** `supabase/setup-cli@v3`, a moving major tag, needs Node 20+ (provisioned if missing). With `version` omitted it reads the version from root `bun.lock`, `pnpm-lock.yaml` or `package-lock.json`; **`yarn.lock` is not on that list**, so a Yarn project must set `version` explicitly or it gets `latest` ([setup-cli](https://github.com/supabase/setup-cli)). **The docs' own examples still say `@v1`, which defaults to CLI 2.20.3, with `version: latest`, which floats.** Pin exactly: `version: 3.0.0`.
- **`db push`.** ([managing environments](https://supabase.com/docs/guides/deployment/managing-environments))

```yaml
env:
  SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
  SUPABASE_DB_PASSWORD: ${{ secrets.PRODUCTION_DB_PASSWORD }}
  SUPABASE_PROJECT_ID: ${{ secrets.PRODUCTION_PROJECT_ID }}
steps:
  - run: supabase link --project-ref $SUPABASE_PROJECT_ID
  - run: supabase db push --yes --remote
```

  The token needs Project Settings, API Keys and API Key Secrets read access for `link`. Least-privilege tokens work for `link` and `db push` since 3.0.0 ([release]).
- **`functions deploy`.** `supabase functions deploy --remote=$PROJECT_ID --yes` with `SUPABASE_ACCESS_TOKEN` ([deploy](https://supabase.com/docs/guides/functions/deploy)). No DB password. GitHub example has no Docker.
- **Password handling.** `--password` works only on hosted targets; `supabase link --password` is ignored in v3. With no `SUPABASE_DB_PASSWORD` the CLI mints a temporary login role through the Management API (`cli_login_*`) ([SRC] `db/push/SIDE_EFFECTS.md`). For `--remote=<postgres-url>`, the password goes in the URL, or `.pgpass`/`PGPASSFILE` ([SRC]), and a URL in a command line is visible in logs and `ps`.
- **Direct URL as neutral path.** `db push --remote="$DB_URL" --yes` works with no access token, which is what a neutral deploy target needs. It uses the same ledger.
- **In CI.** Set `SUPABASE_ENV` and audit `SUPABASE_*` ([DOC]). `CI` plus an existing lock freezes `start`. A workflow's `supabase/config.toml` `[remotes.<name>]` is selected by project ref.

## 10. Inbound handoff, checked

| Handoff claim | Finding |
|---|---|
| `supabase start` needs Docker; "biggest design question" | **Outdated.** True for the default backend only. Native runtime exists (alpha) and works here |
| Decide among DinD, DooD "or something else" | Something else exists. Recommend native |
| `supabase login`, `link` human-run | Correct. Link is per-checkout, so every worktree relinks |
| "Pin it as a devDependency" | Right on a node host. No postinstall in v3. Also needs `supabase.lock` committed. A wrapper host needs another route |
| Open question: "does its CLI read the same directory" | The path can't be configured, `workdir` can, a symlink works. Ledger is the real coupling |
| `wal_level=logical` must be set | Already so in the Supabase image. A neutral Postgres must set it |
| `supabase db push` as deploy, "against `DATABASE_URL`" | Correct, but v3 requires `--remote` + `--yes`. Without `--remote`, it silently targets **local** |
| `supabase secrets set` "via stdin" | **No stdin form found.** Use `--env-file` |
| Generator-owned `supabase/config.toml` | **Caution.** Mostly project state. Own only `[experimental] stack`, `[db] major_version`, and the absence of port keys. `SUPABASE_*` in the project's own `.env` will override it |
| Supabase maps to GoTrue Auth, Storage, Realtime, Edge Functions (Deno), `pg_cron` | Correct |
| "no hosting for a Node backend" | True today; Compute is in private alpha |
| Pricing | Correct; the spend cap excludes more than stated |
| `requires: ['postgres']` | **Reconsider what it means.** The Supabase stack supplies its own server (section 1.3), so the dependency is on the migrations folder, ledger and connection seam, **not** on Debian Postgres running. Otherwise you run two servers and migrations meant for one |
| "A database per stack" on a shared server, or a server per offset | With Supabase, **a server per stack** is what upstream provides |

## 11. What this means for the layer

Conclusions the design has to take or argue with:

1. **Runtime.** Stack backend (`[experimental] stack = true` committed), `--runtime native` default in house containers, exact CLI pin, `supabase.lock` committed. No Docker feature, no privileged container. Keep an escape hatch for a project wanting a container engine: the CLI selects Docker or Podman by itself when the daemon answers, so a project that adds one changes behaviour. **Pass `--runtime native` explicitly in the launch script**, or a host-socket setup changes runtime silently, and the choice is sticky to the stack.
2. **Alpha risk is real; bound it.** Exact pin, plus a tripwire like the firebase-tools one (`start --runtime native`, migrate, diff, reset, status JSON). Move the pin deliberately. The legacy `db push` path is the fallback for deploy, which doesn't depend on the alpha. Flags and output may change between releases, so parse `--output-format json` in one place only.
3. **Stack dependency on a live connection.** `DB_URL` comes from `status --env` into `dev.json`, never a shared file.
4. **Postgres seam.** `postgres` owns: folder, ledger shape, runner, connection contract, seed. It offers a "server provider" seam, whose default is the Debian server, and whose Supabase provider is the stack. Reset and seed route to the provider's CLI when worn.
5. **Safety in depth.** v3 already gives local-by-default and consent, but `db reset --remote=<url> --yes` works on any URL. Owned targets must never pass `--remote` from a local target; only the declared deploy target may. Refuse non-loopback hosts in the launch script as an independent check. Audit `SUPABASE_*` in project `.env` files, and never set `SUPABASE_YES` for an agent environment.
6. **Persistence.** `SUPABASE_HOME` to a persisted path, written literally; `SUPABASE_NO_KEYRING=1`. Extend the `tools/test-layers` persistence case. Disk: 1.7 GB artifacts plus data.
7. **Version truth.** CLI pin in `versions.ts`; `major_version` written explicitly, 17. Move the Postgres major in the `postgres` layer in step with the CLI's accepted majors (15, 17 only on stack).
8. **Generators.** Emit only new keys. Use v3 flags only (`--remote`, `--yes`, not `--linked`, `--db-url`). `[inbucket]` must not appear. Prefer the declarative tree only if the project opts in; versioned migrations stay the shared contract in either case.
9. **Agents.** Prefer the local `MCP_URL`. Don't enable a hosted write-capable MCP by default.

## 12. Not verified

- A real container **rebuild** with `SUPABASE_HOME` on a persisted volume (simulated only).
- Concurrent stress on several native stacks in one container (`db reset`, migrations, long uptime).
- Anything against a real hosted project: `link`, `db push --remote`, `functions deploy`, `secrets set`, `branches`, `config push`, plugin or MCP behaviour, and the hosted `wal_level` and extension versions.
- DinD and DooD in practice. This container has neither; findings are from docs, the feature manifest and issue reports.
- Exact removal date for legacy keys; whether new projects default to asymmetric JWT keys; PG15 platform end of life; IPv4 add-on price; exact Deno version.
- Non-Linux behaviour: Windows has no native runtime, so a Windows host running a Linux devcontainer is fine, but a CLI on bare Windows needs Docker.
- arm64 was not exercised; artifacts for `linux-arm64` are listed in the lock.

## Spike ledger

Started, all under the scratchpad, all stopped:

- `supabase@3.0.0` installs under npm, yarn 1, pnpm, yarn 4 PnP, npm -g (scratch prefix).
- Native stacks in scratch projects `app`, `wt` (git worktree), `sym`, named stack `second`, on automatic or random ports in the 20000–32767 or ephemeral ranges. `supabase stop`, then `stack destroy` for all.
- One vanilla Postgres 17.11 from the artifact's binaries on a random port (46403); killed during the crash test, its data dir deleted.
- `supabase login --token sbp_000...` with a **fake** all-zero token into a scratch `SUPABASE_HOME`, followed by logout. This sent a best-effort `GET /v1/profile` to Supabase with that invalid token.
- Early runs accidentally pointed `--remote` at `127.0.0.1:5432` when a shell variable was empty. Nothing listens there, so all failed with `ECONNREFUSED`. This included a `db reset --remote --yes`: **an empty port silently defaults to 5432, so a launch script must validate the URL.**

Side effects outside the scratchpad: `~/.supabase/ports.sqlite` is written regardless of `SUPABASE_HOME` (it reappeared after I moved the directory away). `cli-latest` and `telemetry.json` were also there, first dated at my first CLI run (05:39 UTC); the likely source is the early `--version` and `--help` calls made before I exported `SUPABASE_HOME`, not confirmed. Telemetry was **on** for the first spike commands, before I set `DO_NOT_TRACK=1`. I removed `~/.supabase` after destroying the stacks, and deleted the scratchpad spike and the CLI clone.
