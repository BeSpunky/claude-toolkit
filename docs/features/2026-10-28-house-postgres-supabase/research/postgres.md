# Postgres layer: current facts and recommendations

> Research date: **2026-11-04**. Effort: `house-postgres-supabase`. Treats `INBOUND-HANDOFF.md` as unverified.
>
> **How to read the evidence marks**
> - **[S]** read from the cited primary source on 2026-11-04.
> - **[M]** measured here, in a spike. Debian 13 container, amd64, ext4 under overlay, NVMe. PostgreSQL `18.6 (Debian 18.6-1.pgdg13+2)` and pgvector 0.8.7, extracted with `dpkg -x` into the scratchpad and run as non-root on a random port, TCP only. Timings are one machine, a few runs: treat as orders of magnitude.
> - **[I]** read directly from an apt index, npm or the GitHub API on 2026-11-04.
> - **[K]** training knowledge, not re-verified today.
> - **[R]** my reasoning, not a sourced fact.

## Conclusions that shape the architecture

1. **The Postgres major is a per-project declared fact, not one house constant.** The core defaults to 18. A Supabase project must run 17, because that is what Supabase offers today. A migration written against local 18 using `uuidv7()` or a virtual generated column would fail on a 17 host (§1, §7).
2. **The usual `name=version` apt pin against PGDG expires.** The `*-pgdg` index keeps a rolling window of three versions. The durable source is `apt-archive.postgresql.org`, suite `<codename>-pgdg-archive`, which keeps everything but also carries betas and RCs. Any package not pinned floats onto a prerelease: `libpq5` resolved to `19~rc1` in a simulated install. Pin the whole closure, per Debian codename (§2).
3. **Today's installer cannot express this.** `house.packages.sh` refuses any token containing `=`, and the descriptor no longer has an apt `repository` field. It has `ArchiveTool`, for `.tar.gz` only. The postgres layer needs a new fragment kind (§2.5). `CLAUDE.md` still describes the removed apt `repository` mechanism, and says `google-cloud-cli` uses it, so that passage is stale.
4. **Run one container-scoped server with one database per stack, cloned from a template.** Cloning takes about 35 ms and six parallel clones took 77 ms. The server's lifetime belongs to the container, not to any stack (§3, §4).
5. **Forward-only plain SQL in `<14 digits>_<name>.sql`, with `dbmate` as the neutral runner.** One folder can serve both dbmate and the Supabase CLI, but only if files carry an **empty** `-- migrate:down` block. A non-empty down block is executed by the Supabase CLI as part of the migration. I reproduced this: the table was created and immediately dropped, with no error (§6).
6. **One tracker per database.** dbmate and Supabase keep separate history, so a database applied by one fails under the other (§6).
7. **The core must model two URLs: runtime and direct.** Every pooled host tells you to migrate over a direct connection, and every sync engine needs one too (§5, §7).
8. **Safety is identity, not host strings.** Compare `system_identifier` over the same connection. Local verbs should not accept a URL at all. dbmate and goose both auto-load `.env`, which is a real leak path (§8).

---

## 1. Current Postgres

### Facts

| Fact | Value | Source |
|---|---|---|
| Latest GA major | **18** (18.6) | [Versioning, S](https://www.postgresql.org/support/versioning/) |
| Other supported | 17.11, 16.15, 15.19, 14.24 | same |
| Final release dates | 18: 2030-11-14. 17: 2029-11-08. 16: 2028-11-09. 15: 2027-11-11. **14: 2026-11-12** | same |
| Support window | 5 years from first release | same |
| Minor cadence | Second Thursday of Feb, May, Aug, Nov, plus out-of-cycle. **Next: 2026-11-12**, then 2027-02-11, 2027-05-13, 2027-08-12 | [Roadmap, S](https://www.postgresql.org/developer/roadmap/) |
| PG 19 | **Not GA.** RC1 on 2026-10-15, RC2 planned 2026-11-12, **GA planned 2026-11-19** "unless an issue is discovered" | [RC1 announcement, S](https://www.postgresql.org/about/news/postgresql-19-rc-1-released-3409/) |

The roadmap page still says 19 is planned for October 2026. The RC1 announcement is the newer statement.

### What 18 changed, for a new project ([release notes, S](https://www.postgresql.org/docs/18/release-18.html))

- **`uuidv7()`**, plus an explicit `uuidv4()`. Works in the spike [M].
- **Asynchronous I/O**: `io_method` is `worker` (default), `io_uring` or `sync`, set at server start only ([config, S](https://www.postgresql.org/docs/18/runtime-config-resource.html)). The spike reports `worker` [M]. Keep the default: whether `io_uring` works under a given container seccomp profile is not verified.
- **Virtual generated columns are now the default**; `STORED` must be written to get write-time storage. SQL that omits the keyword means something else on 17, where only stored exists. [K for the 17 half]
- **Data checksums on by default in `initdb`** (spike: `data_checksums=on` [M]). `pg_upgrade` requires the setting to match, which matters when upgrading from a pre-18 cluster.
- **`pg_upgrade` keeps optimizer statistics**, except extended statistics.
- **MD5 passwords are deprecated**, with warnings.
- **Logical replication**: generated columns can be published (`publish_generated_columns`), the `CREATE SUBSCRIPTION` streaming default moved from `off` to `parallel`, conflicts are logged and counted, and `idle_replication_slot_timeout` can invalidate abandoned slots. In the spike that timeout is `0` (off) and `max_slot_wal_keep_size` is `-1` (unbounded) [M], so an abandoned logical slot can still fill a dev disk unless the house sets one of them.
- **`file_copy_method`** (`copy` default, `clone`). See §4.

### What 19 changes ([draft release notes, "AS OF 2026-10-09", S](https://www.postgresql.org/docs/19/release-19.html))

- **`wal_level = replica` becomes sufficient for logical slots.** "The system automatically increases the effective WAL level to `logical` when creating the first logical replication slot, and decreases it back to `replica` when dropping or invalidating the last" ([WAL config, S](https://www.postgresql.org/docs/19/runtime-config-wal.html)). A new `effective_wal_level` reports it.
- **Publications can include sequences** (`FOR ALL SEQUENCES`) and `ALL TABLES` publications can use `EXCEPT`.
- **`REPACK` / `REPACK (CONCURRENTLY)`** replace `VACUUM FULL` and `CLUSTER`, which remain for compatibility.
- Automatic scaling of AIO workers (`io_min_workers`, `io_max_workers`), JIT off by default, `max_locks_per_transaction` default 128, `log_lock_waits` on by default, RADIUS removed, casts between `bytea` and `uuid`.
- The draft has no `CREATE DATABASE` strategy changes.

### Docker image data-directory change (relevant only as prior art)

From 18 the official image uses a version-specific `PGDATA`, `/var/lib/postgresql/18/docker`, and declares its `VOLUME` at `/var/lib/postgresql`, so `pg_upgrade --link` can work across majors. On 17 and below, mount at `/var/lib/postgresql/data` ([Docker Hub, S](https://hub.docker.com/_/postgres)). The lesson for the house: **key PGDATA by major**.

### Recommendation

**Core default: 18. Do not pin 19 yet.** 18 is GA with 4 years of support left. No surveyed host offers 19 in production (RDS has only an RC1 preview), and it is 15 days from GA with an RC still to come. Revisit once hosts carry it.

**With `supabase` worn: 17**, derived from the project's `supabase/config.toml` `major_version`, not from a second constant. Supabase CLI 3.0.0's `supabase init` writes `major_version = 17` [M]. PG 18 appears nowhere in Supabase's [database changelog, S](https://supabase.com/changelog?tags=database), whose latest entries name 15.19 and 17.11 (2026-10-30).

So the pin table must be keyed by major, with at least 17 and 18 live. PGDG carries both today [I].

**Timing:** the 2026-11-12 minors will move 18.6 and 17.11. Re-project the pin just before release.

---

## 2. pgvector and packaging

### 2.1 pgvector

- Current: **0.8.7 (2026-10-01)**, fixing a buffer overflow in IVFFlat index builds ([changelog, I](https://github.com/pgvector/pgvector/blob/master/CHANGELOG.md); [PostgreSQL news on CVE-2026-103484, S](https://www.postgresql.org/about/news/postgresql-19-rc-1-released-3392/)).
- README: "supports Postgres 13+". The unreleased 0.9.0 **drops 13 and 14** and adds HNSW async I/O ([README and changelog, I](https://github.com/pgvector/pgvector)).
- PGDG packages it for 14 to 19 [I].

### 2.2 What the base images are

- `agent`: `mcr.microsoft.com/devcontainers/base:debian` (`plugins/house/engine/nx-tools/src/layers/agent.ts`). The upstream manifest maps `base:<v>-debian` to **trixie** ([manifest, I](https://github.com/devcontainers/images/blob/main/src/base-debian/manifest.json)).
- `node`: `typescript-node:{{nodeMajor}}`, default Node 24. Manifest `latest` is `24-trixie` ([manifest, I](https://github.com/devcontainers/images/blob/main/src/typescript-node/manifest.json)). This container is Debian 13 [M].
- **Both tags float across Debian releases.** When the tag moves to forky, a `pgdg13` pin no longer exists there [R]. The pin table has to be keyed by codename, and an unknown codename has to fail loudly.

### 2.3 What is actually in the archives [I, 2026-11-04]

| Source | `postgresql-NN` | `postgresql-NN-pgvector` |
|---|---|---|
| Debian **trixie** main | 17 only: `17.11-0+deb13u1` | `postgresql-17-pgvector 0.8.0-1` (old, predates the fixes in §2.1) |
| Debian **bookworm** main | 15 only: `15.18-0+deb12u1` | none |
| PGDG `trixie-pgdg` | 14 to 18, e.g. `18.6-1.pgdg13+2`, `17.11-1.pgdg13+2` | `0.8.7-1.pgdg13+1` for 14 to 19 |
| PGDG `bookworm-pgdg` | same set, `…pgdg12+2` | `0.8.7-1.pgdg12+1` |
| PGDG component `19` on trixie | `19~rc1-1.pgdg13+1` (separate component, not `main`) | in `main` |

Debian's own packaging cannot serve 18, and its pgvector is old, so **PGDG is required**. Same versions on arm64 for `postgresql-18` and its pgvector in `trixie-pgdg` [I]. The [Apt wiki, S](https://wiki.postgresql.org/wiki/Apt) lists amd64 and arm64, and bookworm, trixie, forky and sid.

### 2.4 Pinning: the rolling window is the trap

- **`name=version` works.** In an unprivileged `apt-get -s` simulation, `postgresql-18=18.6-1.pgdg13+2` and an older `18.1-1.pgdg13+2` both resolved [M].
- **Old versions do not stay on the main repo.** Every package I checked in `trixie-pgdg` lists exactly three versions (`postgresql-18`: 18.6, 18.4, 18.3) [I]. The pool is pruned too: `18.0` returns 404 [I]. The [FAQ, S](https://wiki.postgresql.org/wiki/Apt/FAQ) says "the *-pgdg distributions only contain the most recent version"; observed practice is three. Either way, a pin on it dies within a few quarterly releases and every cache-miss image build then fails. This is the same failure `descriptor.ts` documents for Google's gcloud repo.
- **The durable source is the archive.** "Older versions are available in the archive at https://apt-archive.postgresql.org/" (FAQ). Suite `trixie-pgdg-archive`, component `main`. It holds `postgresql-18` from `18~beta1` to `18.6-1.pgdg13+2`, and `postgresql-17` back to `17~beta1` [I]. Its pool serves `18.0-1.pgdg13+3` on both amd64 and arm64 [I]. Only `Packages` and `Packages.bz2` exist, not `.gz`, which apt handled fine [M]. The index was dated 2026-11-04 00:17, so I infer a daily sync, not verified.
- **The archive is signed by the same key**: `apt-get update` with `signed-by=` on the dearmored `ACCC4CF8` key accepted it [M]. Fingerprint `B97B 0AFC AA1A 47F0 44F2 44A0 7FCC 7D46 ACCC 4CF8`, from [postgresql.org/media/keys/ACCC4CF8.asc, I](https://www.postgresql.org/media/keys/ACCC4CF8.asc).
- **The archive contains prereleases, and dependencies float onto them.** Simulating the install with only the three obvious pins, apt chose `libpq5 19~rc1-1.pgdg13+1` and `libpq-dev 19~rc1-1.pgdg13+1` [M]. The dependencies explain why: `postgresql-18` depends on `libpq5 (>= 17~~)` and `postgresql-common (>= 275~)`, and pgvector on an unversioned `postgresql-18` [I]. Only `postgresql-client-18` is an exact `=` dependency.
- **The closure to pin**: `postgresql-NN`, `postgresql-client-NN`, `postgresql-NN-pgvector`, `libpq5`, `postgresql-common`, `postgresql-client-common`. Debian's own dependencies (`libicu76`, `liburing2`, `ssl-cert`, …) float with Debian like every other house OS package.
- **Version strings are per codename** and carry a rebuild suffix (`pgdg13+2`). They should be projected from the index by a tool, never typed, matching `firebase-compat` and `node-facts`. The pool also held `18.6-3.pgdg13+1`, which is not in the `trixie-pgdg` index [I], another reason to project from an index rather than the pool.

### 2.5 Signed-by setup and what the house lacks

The conventional setup ([Apt wiki, S](https://wiki.postgresql.org/wiki/Apt)) stores the key under `/usr/share/postgresql-common/pgdg/` and uses `Signed-By:` in a sources file, via `apt.postgresql.org.sh`. That script targets the rolling suite, so the house should write its own source line for the archive.

Two gaps in the house today:

- `house.packages.sh.tpl`'s `wanted()` rejects any token matching `*[!a-z0-9.+-]*`, so `name=version` is refused, house list included.
- `descriptor.ts` has no apt repository field. `ArchiveTool` is `.tar.gz` plus sha256, extracted to `/opt/bespunky/<id>/<version>`.

**Options** [R]:

| | How | For | Against |
|---|---|---|---|
| **A** | New fragment kind: fetch the closure's `.deb`s from the archive pool, check sha256 (the index has them), `apt-get install ./*.deb` | Matches the `ArchiveTool` philosophy: projected per arch and codename, no third-party repo left in the image, no 22 MB index to fetch, and Debian dependencies still resolve | New mechanism; six debs × arch × codename × major in the table |
| B | New fragment kind: add the archive repo, allow `=` in the installer | Least new code | Same-repo conflict in adopted images (`descriptor.ts` calls this out); a repo that serves prereleases stays configured in the image |
| C | `dpkg -x` into `/opt/bespunky/postgres/<ver>`, no maintainer scripts | **This is what actually ran in the spike**, with pgvector, as non-root. No `postgres` user, no auto-cluster | Needs `LD_LIBRARY_PATH` or wrappers for `libpq` and `liburing`; Debian dependencies listed by hand; unconventional |

**Recommendation: A.** Keep C as the fallback, because it is the only one observed end to end.

**Not run end to end:** an actual root `apt install` in an image, because I was told not to install system-wide. The dogfood rebuild has to cover this.

Install-time side effects to handle ([K], plus what I read in the `postgresql-common` package [I]):

- The postinst creates a `postgres` system user.
- `create_main_cluster` defaults to true (it appears commented out in `createcluster.conf`), so without `create_main_cluster = false` in `/etc/postgresql-common/createcluster.conf` **before** `postgresql-NN` is installed, it creates and tries to start `/var/lib/postgresql/NN/main`. Not observed; confirm in the rebuild.
- The binaries are in `/usr/lib/postgresql/NN/bin`, which is not on PATH (spike layout [M]), so the layer needs a `path` entry.

---

## 3. Running Postgres in a devcontainer without Docker

### The mechanism: verified [M]

As a non-root user, with no systemd:

| Step | Result |
|---|---|
| `initdb -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8` | 0.6 s, 39 MB |
| `pg_ctl -w start` | 0.1 s |
| `CREATE EXTENSION vector` | extversion 0.8.7, query correct |
| `uuidv7()` | works |
| Idle memory | One server about 33 MB PSS while freshly started. Six idle servers totalled about 126 MB PSS |
| Defaults | `max_connections=100`, `shared_buffers=128MB` |

### Where PGDATA goes

Under **`~/.local/share/...`, keyed by major** (for example `~/.local/share/bespunky/postgres/18/data`). No new mount is needed: `agent.ts` already persists `~/.local` as the project-scoped volume `${localWorkspaceFolderBasename}-local`, and `CLAUDE.md` prefers the fewest entrypoints. Three points:

- The handoff says "a named volume, like the Playwright cache". The Playwright cache is in `~/.cache`, and `agent.ts` states "what is not a cache never lives here". Do not put PGDATA there.
- That volume is **`onHouseImageOnly: true`**, so an adopted image has no `~/.local` volume. PGDATA is then lost on rebuild. That costs only a re-migrate and re-seed, but the layer should say so.
- Keying by major means a pin bump to a new major gets a fresh directory. Dev data is rebuilt from migrations and seed, not `pg_upgrade`d. The old directory should be removed by whatever moves the pin, or reported.

### Sockets: a real trap [M]

Unix-socket paths are limited to 107 bytes. With a deep `unix_socket_directories`, the server **fails to start**: `FATAL: could not create any Unix-domain sockets`. A path under a worktree or scratchpad hits this easily. Use a short fixed directory or, as the spike did, `unix_socket_directories=''` with `listen_addresses='127.0.0.1'`. Do not reuse `/var/run/postgresql`, which is owned by `postgres` [K].

### Shutdown [S, M]

- `pg_ctl stop` modes: `smart`, `fast` (default), `immediate` ([docs, S](https://www.postgresql.org/docs/18/app-pg-ctl.html)).
- Signals: SIGTERM is smart, SIGINT is fast, SIGQUIT is immediate. SIGKILL "will prevent the server from releasing shared memory and semaphores" and may need subprocesses killed by hand ([docs, S](https://www.postgresql.org/docs/18/server-shutdown.html)).
- Foreground `postgres` on SIGINT: clean exit in 14 ms, `postmaster.pid` removed [M]. A Ctrl+C reaching the process group is therefore safe.

### Orphans and crash recovery [M]

| Scenario | Observed |
|---|---|
| Parent killed with SIGKILL while `postgres` runs in the foreground | **Postgres survives**, reparented to PID 1, still accepting connections. So tying it to a dev-engine child does not stop it leaving an orphan |
| SIGKILL the postmaster alone | Children exited on their own within 1.5 s. `postmaster.pid` stays behind |
| Restart after that | `pg_ctl start` prints "another server might be running; trying to start server anyway", recovers, ready in about 0.2 s. All committed rows present (101,001 of 101,001) |
| SIGKILL postmaster and all children together | Same, about 0.2 s |
| Second `postgres` on a running data dir | Refused: `lock file "postmaster.pid" already exists`. So double-starting is safe, and it fails loudly |
| **Stale `postmaster.pid` naming a live, unrelated PID** | **Refuses to start**, with the same lock-file error, until the file is gone |

The last row matters most for containers. PIDs restart low after a rebuild, so a stale file is likely to name some live process [R]. The layer's `ensure` should check `/proc/<pid>/cmdline` before believing `postmaster.pid`, and remove a stale file only when that PID is not a `postgres`.

**Crash recovery:** a container that dies mid-write replays WAL on next start. With `fsync=on` it is safe. The docs warn only about the state left by `-m immediate`/SIGKILL, and the spike recovered every time. An abrupt kill at container stop is therefore normal, not an emergency.

### Lifecycle recommendation [R]

- A **container-scoped daemon**, started by an idempotent `ensure` (`pg_isready`, else clear a verified-stale pid file, else `pg_ctl -w start`). No stack owns it, and no reaper or stack lock is needed for it.
- Stacks attach by database name. This removes the failure class behind Firebase's emulator reaping: nothing depends on a per-stack process dying.
- Use a fixed non-default port stored in generated config, never 5432, in line with the local-server rule. An agent's throwaway server, if any, gets a random port.
- `/dev/shm` is 64 MB here, and Postgres uses `dynamic_shared_memory_type=posix` [M]. My parallel test did **not** reproduce a shm failure because the planner chose no parallel hash. Treat as an open risk [K]: known to bite parallel hash joins in small containers. If it shows up, the fix is `dynamic_shared_memory_type=mmap` or `--shm-size`.
- `synchronous_commit=off` is a safe speed-up for dev [K]. Do **not** use `fsync=off`: it trades away the crash recovery shown above.

### Alternatives

| Option | State today | Verdict |
|---|---|---|
| **Official devcontainer feature** | **None**: `devcontainers/features/src` has 28 entries, none matching "postgres" [I] | Not available |
| **Community feature** `the78mole/devcontainer-features/postgresql` | v0.8.0 notes say PG 11 to 17 ([release, S via search](https://github.com/the78mole/devcontainer-features/releases/tag/v0.8.0)), no 18 | Third party, no pgvector mention, against "never a version-less feature" spirit. Reject |
| **`embedded-postgres` npm** | `18.6.0-beta.19`, MIT, the `latest` tag is a beta. Binaries come from zonky. Needs postinstall symlinks ([README, S](https://github.com/leinelissen/embedded-postgres)). **No pgvector**: `@embedded-postgres/linux-x64` has no vector files [M] | Fails the consumer's pgvector need, and needs Node. Reject |
| **PGlite** `@electric-sql/pglite` 0.5.15 | Apache-2.0. `version()` is **18.6** on wasm32. **pgvector 0.8.7 works** via `@electric-sql/pglite-pgvector` 0.0.16, `uuidv7()` works [M]. Single-connection engine. No native wire: `pglite-socket` exposes one with a multiplexer ([README, I](https://www.npmjs.com/package/@electric-sql/pglite-socket)). Fixed `wal_level=replica`: **logical slot creation fails** [M]. Boot 0.9 s; process RSS **419 MB** against about 33 MB PSS for real Postgres [M]. Node or browser only | Excellent for in-process or browser tests. Not a dev server: no concurrency parity, no logical decoding, no stack neutrality |
| **Docker** | House has no Docker by design. The handoff's Supabase question is about this | Out of scope for the core |

**Production parity, honestly:** PGDG Postgres in the container is real Postgres at the host's major. It still differs from hosted Postgres in superuser access, roles, preloaded extensions, pooler behaviour (§7) and pgvector minor. Migrations should be tested against the pooler-free direct path, which is what they use in production anyway. Transaction-pooler behaviour cannot be reproduced locally without running PgBouncer [R].

---

## 4. Isolation per dev stack

### Measurements [M] (18.6, ext4, `fsync=on`)

| Template | `WAL_LOG` (default) | `FILE_COPY`, `copy` | `FILE_COPY`, `clone` |
|---|---|---|---|
| Small: 50 tables, pgvector, 10 MB | **35 to 46 ms**, 5 MB WAL | 164 to 178 ms, about 3 KB WAL | 172 ms |
| Large: 476 MB | 586 to 874 ms, **468 MB WAL** | **336 to 374 ms**, about 5 KB WAL | 327 to 355 ms |

Other results:

- **Six parallel `CREATE DATABASE` from one template: 77 ms total, all succeeded.**
- `DROP DATABASE`: 18 ms.
- `cp --reflink=always` fails on this filesystem. **`clone` gives no gain on ext4**, and the table shows it. It helps only on XFS, Btrfs or APFS-like filesystems, which a devcontainer volume usually is not [R].

### Semantics

- **Strategy** ([docs, S](https://www.postgresql.org/docs/18/sql-createdatabase.html)): `WAL_LOG` is the default, "most efficient … where the template database is small". `FILE_COPY` writes little WAL but "forces the system to perform a checkpoint both before and after", which explains its small-template floor of about 170 ms.
- **`file_copy_method`** (18+): `COPY` or `CLONE`, affects only `FILE_COPY` and `ALTER DATABASE … SET TABLESPACE`, uses `copy_file_range()` on Linux ([docs, S](https://www.postgresql.org/docs/18/runtime-config-resource.html)). So `clone` is not available with the default strategy.
- **Locks:** "no other sessions can be connected to the template database while it is being copied" ([docs, S](https://www.postgresql.org/docs/18/manage-ag-templatedbs.html)). In practice `CREATE DATABASE` **waits about 5 s, then fails** ("source database … is being accessed by other users"): 5,015 ms measured, and a 3 s connection got through by outwaiting it [M].
- **The clean fix:** `ALTER DATABASE tpl WITH is_template true allow_connections false`. Cloning still works and connections are refused [M]. Rebuilding the template means toggling that off, migrating and seeding, and toggling it back.

### One server with many databases, or one server per stack

| | One server, many databases | One server per stack |
|---|---|---|
| New stack | About 35 ms (clone) | About 700 ms (`initdb` + start) + migrate + seed; or a `cp -a` of a stopped master |
| Disk | Size of the data | 40 MB+ each, plus the data |
| Idle memory | One server | About 21 MB PSS each, cheap |
| Process lifecycle | One daemon | **N daemons to start, stop, reap and allocate ports for** |
| Failure | A crashing backend resets every connection on the server [K]. Shared WAL and `max_connections`. An abandoned slot retains WAL for everyone | Isolated |
| Cluster-global objects | Roles, `wal_level`, preload libraries shared | Separate |
| Config differences per stack | No | Yes |
| Port | Single; the stack differs by database name | Follows the stack offset |

### Recommendation: one server, one database per stack, cloned from a template

Memory is not the deciding factor; lifecycle is. Per-stack servers rebuild exactly the process-management burden the handoff §4 is pleased to lose. For parallel agents:

- The clone cost lets an agent have a database, or a database per test run, with no coordination beyond the server's own lock.
- Name databases from the stack identity (`<project>_<worktree-slug>_<offset>`, or a hash, since identifiers are limited to 63 bytes [K]). Pass the URL via `dev.json` env.
- A `sweep` step should drop databases whose stack no longer exists, and report them.
- **Raise `max_connections`** (for example to 300). At 100, a handful of agents with pools of 10 to 20 hits the limit; Electric alone defaults to 20 [S, §5]. Sizing is my estimate, not measured.
- **Roles:** create them idempotently in a server bootstrap, not in migrations that each stack would race on, since roles are cluster-global.
- Keep **`WAL_LOG`** (default) for ordinary templates. Use `FILE_COPY` only for a large seed world, and set a `max_wal_size` that fits the volume. Ignore `clone`.
- Set `max_slot_wal_keep_size` to a finite value so a forgotten slot cannot fill the volume [R].

---

## 5. `wal_level=logical`

**Restart:** "This parameter can only be set at server start" ([docs, S](https://www.postgresql.org/docs/19/runtime-config-wal.html)). In 18.6, `ALTER SYSTEM` + reload leaves `pending_restart=t` [M].

**Cost** [M]: 40,000 `pgbench` transactions at scale 5, two clients, `fsync=on`:

| Setting | WAL | Time |
|---|---|---|
| `replica` | 17 MB | 7.8 to 8.0 s |
| `logical` | 21 MB (**+24%**) | 7.9 s |
| `logical`, `REPLICA IDENTITY FULL` | 26 MB (+53%) | 8.0 s |

Throughput difference is within noise. No logical slot was present. The real cost is a **slot left behind**, which retains WAL without limit by default, not the setting.

**Do sync engines still need it today?** Yes:

| Engine | Postgres | Requirement | Connection | Source |
|---|---|---|---|---|
| **PowerSync** | 11+ | `wal_level=logical`, restart, role with `REPLICATION BYPASSRLS`, publication named `powersync` | Its replication connection keeps a Neon compute awake | [S](https://docs.powersync.com/configuration/source-db/setup) |
| **Electric** | 14+ | "Postgres must have logical replication enabled"; `REPLICATION` role; creates slot and publication; **clean them up if you stop using a database** | Direct, plus optional `ELECTRIC_POOLED_DATABASE_URL` | [S](https://electric.ax/docs/guides/deployment) |
| **Zero** | 15+ | `wal_level=logical`; event triggers recommended, else every schema change means a full reset | `ZERO_UPSTREAM_DB` must be direct | [S](https://zero.rocicorp.dev/docs/connecting-to-postgres) |

None of those pages discusses PG 19's automatic raise. It should satisfy them, since they use logical slots, but I did not test it.

**Hosted side:**

- Supabase: already on (PowerSync docs).
- Neon: console toggle that restarts computes and **cannot be undone** (PowerSync docs).
- Cloud SQL: flag `cloudsql.logical_decoding` ([S](https://docs.cloud.google.com/sql/docs/postgres/extensions)).
- RDS/Aurora: `rds.logical_replication`, with a reboot (PowerSync docs).

**Recommendation:** set `wal_level=logical` locally on 18 and 17, as the handoff proposes. It is cheap, and a logical slot then works first try. But correct the reasoning: it does not save a "config migration". The setting is an owned value, and changing it costs a 0.2 s restart. A local setting also says nothing about production, so the docs must state each host's own switch. Drop it for majors 19 and up, where `replica` raises itself.

---

## 6. Migration tooling

### Comparison

Versions and dates [I, 2026-11-04] unless marked.

| Tool | Version, date | Distribution | Plain SQL | Down | Tracking | Concurrency lock | Licence | Notes |
|---|---|---|---|---|---|---|---|---|
| **dbmate** | 2.37.0, 2026-10-18 | Single Go binary (`dbmate-linux-{amd64,arm64}`, `checksums.txt`), **also npm** with per-platform packages | Yes, `-- migrate:up` / `-- migrate:down` in one file | **Block required** by parser; may be empty | `public.schema_migrations` | **`--migration-lock`** (Postgres), verified: 4 parallel runs, no errors [M] | MIT | Atomic per file by default; `transaction:false` per block. `up --strict` refuses out-of-order [M]. **Loads `.env` by default** |
| **goose** | 3.29.0, 2026-10-11 | Go binary 43 MB, bare asset; `go install`, brew; no official npm found | Yes, `-- +goose Up`, Down optional | Optional | `goose_db_version` | **None in the CLI** ([library `SessionLocker` only, S](https://pressly.github.io/goose/blog/2023/goose-provider/)). 4 parallel runs: 3 errored [M] | MIT | Up-only files are valid. **Loads `.env` by default** ([S](https://raw.githubusercontent.com/pressly/goose/main/README.md)) |
| **Atlas** | 1.3.0, 2026-08-02 | Binary via `curl \| sh`, brew, Docker | Yes, plus `atlas.sum` | **Not in Community** | `atlas_schema_revisions` [K] | [K] | Community Apache-2.0; standard binary under a proprietary MSA | Community lacks `migrate down`, lint, and RLS/views/functions/triggers modelling ([S](https://atlasgo.io/community-edition)) |
| **Flyway** | 13.12.0, 2026-10-30 | Java CLI bundle [K] | Yes, `V1__x.sql` [K] | **Undo is Teams+** ([Redgate docs, S](https://documentation.red-gate.com/fd/feature-summary-165740620.html)) | `flyway_schema_history` [K] | Yes [K] | Community Apache-2.0 ([GitHub API, I](https://github.com/flyway/flyway)) | Heavy for this |
| **node-pg-migrate** | 9.0.0, 2026-07-17 (repo updated 2026-10-22) | npm, Node 22.12+, PG 14+ ([S](https://raw.githubusercontent.com/salsita/node-pg-migrate/main/README.md)) | Yes, `sql` file language ([docs, I](https://raw.githubusercontent.com/salsita/node-pg-migrate/main/docs/src/cli.md)) | Yes | `pgmigrations` | Yes, advisory; `--no-lock` to disable (same) | MIT | Ties the core to Node |
| **graphile-migrate** | 1.4.1 stable; `2.0.0-rc.6` | npm | Yes | **Forward only** by design | `graphile_migrate` schema | [K] | MIT | Needs a shadow DB for dev commands; `current.sql` watch flow is good but opinionated ([S](https://raw.githubusercontent.com/graphile/migrate/main/README.md)) |
| **Sqitch** | 1.6.1, 2026-01-06 | Perl: CPAN, Docker, Homebrew ([S](https://raw.githubusercontent.com/sqitchers/sqitch/develop/README.md)) | Yes | deploy/revert/verify, [K] | `sqitch` schema [K] | [K] | MIT | Plan file, no numbering ([S](https://sqitch.org/about/)). Heavy runtime; wrong folder shape for Supabase |
| **Supabase CLI** | 3.0.0, 2026-11-02 | npm `supabase` | Yes, `<timestamp>_<name>.sql` ([S](https://supabase.com/docs/guides/deployment/database-migrations)) | None | `supabase_migrations.schema_migrations` | **None**: docs say to coordinate so one person pushes at a time | MIT | **Works against plain Postgres with no Docker**: `db push --remote=<url>` [M]. Failed file rolls back, nothing recorded [M]. `--db-url` is deprecated, removed in v4 [M] |

### Typed layers

| Tool | Version [I] | Owns migrations? |
|---|---|---|
| **Drizzle** `drizzle-orm` 0.45.4, `drizzle-kit` 0.31.11 | Stable tags still 0.x; 1.0 betas in dist-tags | **Optional.** `drizzle-kit pull` builds TS from a database whose schema is managed "by external migration tools or by running SQL migrations directly", and `generate` can emit SQL for an external tool ([S](https://orm.drizzle.team/docs/migrations)) |
| **Kysely** 0.29.8 | | Has an optional TS `Migrator` with tables `kysely_migration` and `kysely_migration_lock` ([S](https://kysely.dev/docs/migrations), [code, I](https://github.com/kysely-org/kysely/blob/master/src/migration/migrator.ts)). Doesn't require it. Types can come from `kysely-codegen` [K] |
| **Prisma** `latest` is **`8.0.0-rc.30`**; `prev` 7.10.1 | **The `latest` dist-tag is an RC** [I]. A house pin must not read `latest` | **Yes, by default**: Migrate with `_prisma_migrations`, shadow DB for `migrate dev` ([S](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/shadow-database)). `db pull` for external migrations [K] |

**Fit:** Drizzle-pull or Kysely-with-codegen sit naturally on top of a neutral SQL folder. Prisma Migrate is a competing owner. As the handoff says, any of these belongs to a stack adapter, not the core.

### Can the same folder serve the Supabase CLI? Tested [M]

| Test | Result |
|---|---|
| dbmate, file with `-- migrate:up` only | **Fails**: "dbmate requires each migration to define a down block" |
| dbmate, `-- migrate:up` + empty `-- migrate:down` | Applies |
| Supabase `db push`, same file | Applies. dbmate's markers are SQL comments. `plpgsql` function with `$$` fine |
| Supabase `db push`, **non-empty** down block | **Runs the down too.** `create table withdown` followed by `drop table withdown`: exit success, table absent. **Silent data-destroying incompatibility** |
| `create index concurrently` with `-- migrate:up transaction:false` | Works in both |
| Failing statement mid-file | Atomic in both: nothing left, nothing recorded |
| Out-of-order file | dbmate `up --strict` refuses; Supabase refuses without `--include-all` |
| `dbmate rollback` with empty down | **Removes the history row but leaves the schema**; the next `up` then fails ("column already exists"). The house must not expose rollback |
| Supabase after dbmate on the same DB | Fails: `relation "notes" already exists`. **Trackers do not know about each other** |
| `supabase/migrations` as a symlink to `../db/migrations` | `db push` follows it. `migration new` through it not tested |

Also from the docs: `supabase migration repair --status applied <timestamp> --remote` writes the history without running SQL, which is how a dbmate-applied database could be adopted when `supabase` is added later. Not run.

### Recommendation

**dbmate as the core runner**, with a forward-only convention enforced by a house lint: a file is `<14 digits>_<name>.sql` with `-- migrate:up`, and a `-- migrate:down` block that must be **empty**.

- **Why dbmate over goose**, which has nicer up-only files: dbmate has a real CLI lock, npm *and* a bare binary with checksums, and is the only one whose lock I saw hold. With parallel agents and CI, the lock matters.
- **Why not hand-roll over `psql`:** it is tempting and small, but the lock, transaction control and tracking are exactly the things to not own [R].
- **Always invoke with** `--migration-lock --no-dump-schema`, `up --strict`, and an explicit URL. Neutralise `.env` loading (§8).
- **Distribution:** npm devDependency on the node host. On a wrapper host (no `package.json`), the binary in the image. The bare asset is not a `.tar.gz`, so the §2.5 fragment work should allow for it.
- **Folder:** one real folder (`db/migrations` or similar). When `supabase` is worn, `supabase/migrations` symlinks to it, or the folder is declared to be there; the designer should choose.
- **One tracker per database:** when `supabase` is worn, use the Supabase CLI for hosted Supabase. It works on local plain Postgres too, so the simplest rule is one tool per project: dbmate without the layer, Supabase CLI with it. The file format is the shared contract, so adding the layer later needs no rewrite.
- **Down migrations are not needed for local dev** because reset is a template clone, and they do not work with Supabase. The trade: no scripted rollback of a production deploy; roll forward.

---

## 7. Hosting

### What each offers today

| | **Supabase** | **Neon** | **Cloud SQL** | **RDS** |
|---|---|---|---|---|
| Majors | 15, 17 (14 ended 2026-07-01) ([changelog, S](https://supabase.com/changelog?tags=database)). **No 18 evidence** | 14 to 18, chosen per project; major move means new project ([S](https://neon.com/docs/postgresql/postgres-version-policy)) | 9.6 to 18, **default 18**, latest 18.6 ([S](https://docs.cloud.google.com/sql/docs/postgres/db-versions)) | 18.6, 17.11; 19 RC1 in Preview only ([S](https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-versions.html)) |
| pgvector | Up to **0.8.2** for 15 and 17, per `supabase/postgres` `versions.json` on `develop` ([I](https://github.com/supabase/postgres/blob/develop/nix/ext/versions.json)); deployed version not confirmed | **0.8.0** on 14 to 17, **0.8.6** on 18 ([S](https://neon.com/docs/extensions/pg-extensions)) | **0.8.5** ([S](https://docs.cloud.google.com/sql/docs/postgres/extensions)) | **0.8.2** on 18.6 and 17.11 ([S](https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-extensions.html)) |
| Runtime URL | Shared pooler `aws-[INDEX]-[REGION].pooler.supabase.com`, user `postgres.[REF]`: `:6543` transaction, `:5432` session. Dedicated PgBouncer on Pro at `db.[REF].supabase.co:6543` | `-pooler` added to the endpoint hostname | Port 6432 ([S](https://docs.cloud.google.com/sql/docs/postgres/managed-connection-pooling)), or Auth Proxy 3307 | RDS Proxy endpoint, 5432 |
| Pooler mode | Transaction or session | PgBouncer transaction only | `transaction` default, or `session`; **Enterprise Plus only** | Multiplexing with session pinning; **no streaming replication** ([S](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html)) |
| Direct URL | `db.[REF].supabase.co:5432`, **IPv6 only** without add-on; session pooler is the IPv4 alternative | Hostname without `-pooler` | 5432 | Instance endpoint |
| Migrations over | "Use the **direct connection** for migrations, `pg_dump`, backup and restore, and replication" ([S](https://supabase.com/docs/guides/database/connecting-to-postgres)) | "Use a direct (non-pooled) connection for schema migrations, `pg_dump`/`pg_restore`, and logical replication" ([S](https://neon.com/docs/connect/connection-pooling)) | Direct [R] | Direct [R]; a proxy pins or rejects much of what they do |

**Consequences for a toolkit:**

- **No host offers pgvector 0.8.7 by these listings.** Provider backports not checked. The local pgvector is therefore newer than production almost everywhere. Pin it for security, not for parity. Do not write `CREATE EXTENSION vector VERSION '0.8.7'` in a migration [R]. Neon's 17 is 0.8.0.
- **The IPv6-only Supabase direct URL** is a real gap: many CI runners and containers lack IPv6 [K]. Session mode (`:5432` on the pooler) is the documented IPv4 path, and it supports the session features migrations need. The Supabase CLI docs may handle this differently; the Supabase research owns the detail.
- **Transaction-mode behaviour** breaks session state. Supabase's shared pooler: no prepared statements, so `prepare: false` (Postgres.js, Drizzle), `pgbouncer=true` (Prisma), `statement_cache_size=0` (asyncpg). Neon: protocol prepared statements work (`max_prepared_statements=1000`), SQL-level `PREPARE` does not, nor session advisory locks. **So dbmate's `--migration-lock` over a transaction pooler is not safe**, one more reason for the direct URL [R; dbmate's lock type not read from source].
- **Modelled URLs:** `DATABASE_URL` (runtime, possibly pooled) and `DIRECT_DATABASE_URL` (migrations, replication). Locally they are the same value. Hosts then need no provider code, confirming the handoff's "hosting is a connection string", with this one correction: **a single string is not enough.**

### Neon status and pricing

- **Acquisition:** Databricks announced it on [2025-05-14, S](https://www.databricks.com/blog/databricks-neon) with "We are fully committed to the future of the Neon platform". That post predates closing, and I found no primary closing statement. Today's pricing page describes Neon as "a complete set of cloud backend primitives built around Lakebase Postgres", "from Databricks" ([S](https://neon.com/pricing)), so I read it as completed and operating under Neon's own site and plans. Secondary sources say Lakebase went GA on AWS in Feb 2026 and Azure in March 2026.
- **Pricing** ([pricing, S](https://neon.com/pricing); [plans, updated 2026-10-23, S](https://neon.com/docs/introduction/plans)):

| Plan | Compute | Storage | Scale to zero | Limits |
|---|---|---|---|---|
| Free | 100 CU-h per project per month | 1 GB per project | After 5 min, cannot disable | Up to 2 CU, 10 branches, 6-h history |
| Launch | **$0.106**/CU-h | **$0.35**/GB-month | After 5 min, can disable | Up to 16 CU, 7-day history |
| Scale | $0.222/CU-h | $0.35/GB-month | Configurable | Up to 16 CU autoscale or 56 CU fixed, 30-day history |

No monthly minimum on paid plans. The handoff's secondary-sourced numbers are **correct**, and its $19 a month figure checks out: 0.25 CU × 730 h × $0.106 = $19.35. PowerSync's docs confirm a replication connection prevents scale-to-zero.

**Roadmap risk** [R]: Neon is a sound target through a connection string precisely because the core has no Neon code. Do not build on Neon-only APIs.

---

## 8. Safety

### Findings from testing [M]

- **A host-string check is easily beaten.** These all connected, and the first and third have no host in the URL's authority:
  - `postgresql:///postgres?host=…&port=…`
  - `postgresql://localhost:P,prod.invalid:5432/…` (multi-host)
  - `postgresql:///postgres` with `PGHOST` in the environment
- **`localhost` is not local.** An SSH or `kubectl` tunnel to production listens on `127.0.0.1` [R]. String checks pass it.
- **`.env` is read silently.** With no `DATABASE_URL` set and a `.env` in the working directory naming another host, `dbmate status` dialled **that host** (`lookup prod.example.invalid`). Goose does the same by default.
- **`system_identifier` is a positive identity, readable by an unprivileged role.** `SELECT system_identifier FROM pg_control_system()` returned the same value as `pg_controldata $PGDATA`, as a plain non-superuser role. `current_setting('data_directory')` was refused for that role.

### Recommended pattern [R, built on the above]

1. **Local verbs take no URL.** `db:reset`, `db:seed` and `db:new` compute their target from the stack identity and always talk to the local server. A remote operation is a different verb, not a flag. This removes the question rather than guarding it.
2. **Identity check over the same connection** before anything destructive: `system_identifier` must equal the value from the local `PGDATA`. **Fail closed** on any error, because a host may restrict the function. A second connection could reach a different server behind a multi-host URL or load balancer.
3. **Scrub the environment** for local verbs: `PGHOST`, `PGHOSTADDR`, `PGPORT`, `PGSERVICE`, `PGSERVICEFILE`, `PGPASSFILE`, `PGOPTIONS`, `PGDATABASE`, `PGUSER`, `DATABASE_URL`. Set `--env-file` to an empty or generated file for dbmate; `-env=none` for goose.
4. **Deploy is explicit and human-gated:** an owned target reading the direct URL from the shell, never from a file in the tree, printing host and database, with an interactive confirmation that an agent cannot supply itself.
5. **Agent gate precedent:** Prisma has blocked `migrate reset`, `db push --force-reset` and `db push --accept-data-loss` for detected AI agents since 6.15.0 unless user consent is passed in `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` ([Prisma blog, S via search](https://www.prisma.io/blog/orm-6-15-0-ai-safety-guardrails-for-destructive-commands-and-more); [agent safety, S via search](https://raw.githubusercontent.com/prisma/skills/main/prisma-cli/references/agent-safety.md)). Supabase CLI: "hosted changes only accept this flag [`--yes`] or `SUPABASE_YES` exported in your shell, never supabase/.env or another .env file" [M, `--help` of 3.0.0]. Note the Supabase precedent: `.env` is deliberately not trusted to authorise anything.
6. **Least privilege on the host side:** a non-owner runtime role, with the migration role separate. Docs guidance, not toolkit code.

**Illustrative incident, secondary source:** a [DEV post](https://dev.to/gabrielanhaia/one-wrong-shadow-database-url-wiped-22-tables-4-guards-for-agent-run-migrations-4l2e) describes a production URL passed as `--shadow-database-url` to `prisma migrate diff`, wiping every table. Its fix is the same as point 2: compare database identity, not URL strings.

### Common leak paths [K, R: reasoned, not sourced]

| Path | Why it leaks | House counter |
|---|---|---|
| `.env` in the tree | Auto-loaded by tools, then committed or shared by a worktree | Local URLs generated per stack; production URL never in a file |
| `containerEnv` / `remoteEnv` in `devcontainer.json` | Committed, and inherited by every process | Forbid database URLs there; test for it in `tools/test-layers` |
| `~/.pgpass`, `pg_service.conf` | Persisted across rebuilds if placed under `~/.config` or `~/.local` | Local verbs ignore them (point 3) |
| `dev.json` env, Nx task hashing | A URL in a hashed input ends up in cache metadata or logs | Keep URLs out of task inputs; local URLs have no secrets anyway |
| Tool error output and CI logs | Connection failures can print the URL | Mask in CI; never echo the full URL |
| `PGPASSWORD` or a URL on a command line | Visible in `ps` and shell history | Use stdin or a file descriptor, like `push-secrets.sh` |
| Dumps of production restored locally | Real data with real emails in a dev volume | The seed world is the only data path |
| CLI state (`supabase/.temp`) | May hold project refs or pooler URLs; contents not checked | The Supabase research should confirm, and it should be gitignored |
| Agent transcripts | A URL pasted into chat stays there | Same stance as `set-npm-token`: the user runs it in their own terminal |

---

## 9. The inbound handoff, checked

| Claim | Verdict |
|---|---|
| Debian's pgvector "may be old", PGDG "may be needed" | **Correct, and understated.** Debian trixie: 17 only, pgvector 0.8.0. Bookworm: 15 only, none |
| "`os-packages` or a feature" as the install path | **Wrong.** `os-packages` refuses `name=version`. No official feature exists. The rolling PGDG window breaks a plain pin |
| "A named volume, like the Playwright cache" | **Wrong location.** That is `~/.cache`, where non-cache state is banned. `~/.local` is already persisted; no new mount needed |
| `wal_level=logical` "so a future sync layer works without a config migration" | **Fine to do, wrong reason.** It is one restart of an owned setting, costing about 0.2 s and +24% WAL. Unneeded from PG 19 on |
| `CREATE DATABASE … TEMPLATE` gives a fast reset and per-test isolation | **Correct** (35 ms), with the template-connection constraint: use `allow_connections false` |
| "Each stack gets its own database, or its own server" | **Decided: own database.** |
| "`postgres` requires `nx`, probably plus `node`" | **Not necessarily `node`.** dbmate is a bare binary, so the wrapper host can be served; that keeps the "Python or Go project" promise |
| "Don't create two folders" | **Achievable** with a format constraint, but with the non-empty-down trap and one tracker per database |
| "Hosting is just a connection string" | **Two strings:** runtime and direct |
| "Match the Postgres major to the production host" | **Correct, and it forces 17 for Supabase**, which loses `uuidv7()` and virtual generated columns. The consumer's design should know this |
| Neon pricing and the $19 figure | **Correct**, now from primary sources |
| Supabase CLI as npm `supabase` | **Correct:** 3.0.0, 2026-11-02; `latest` moved to a new major two days ago |
| `supabase start` needs Docker | **Not my remit, but a lead:** a sibling research process in this session was running a Supabase-CLI-managed Postgres from a `slim-services` cache with no Docker, and using `SUPABASE_EXPERIMENTAL_STACK`. Only seen in a process listing. Also Docker is not needed for `db push` to plain Postgres [M] |

Also stale, outside the handoff: **`CLAUDE.md`** says an `osPackages` group may name a third-party apt `repository` and cites the firebase layer's `google-cloud-cli`. The code has since moved to `ArchiveTool`.

---

## 10. Not verified

- A real root `apt install` of the pinned closure inside an image, the `postgres` user and `create_main_cluster=false` behaviour, and PATH. Simulated and extracted only. **The dogfood rebuild must cover it.**
- PGDATA on an actual `~/.local` volume after a real container rebuild. Crash and stale-pid behaviours were simulated by signals and an edited pid file, not by stopping a container.
- `io_uring` under Docker's seccomp profile.
- `/dev/shm` exhaustion: not reproduced, because the planner did not pick a parallel hash.
- `apt-archive` publish lag for a new minor, and any stated retention policy. Index retention of three versions is observed, and contradicts the FAQ's wording.
- PG 19 behaviours: read from draft docs, never run. Sync engines on 19 not tested.
- Which pgvector version hosted Supabase actually serves, and whether hosts backport the 0.8.7 fix. Also whether Supabase has an unannounced 18 path.
- Completion of the Databricks–Neon deal from a primary source.
- dbmate's lock mechanism (session advisory or otherwise), so its behaviour over a pooler is inferred.
- Flyway, Atlas, Sqitch and graphile-migrate lock behaviour and tracking names marked [K]. None was run. Only dbmate, goose and the Supabase CLI were.
- Prisma's own docs: `www.prisma.io` failed DNS from WebFetch for one fetch, so its guard is via search results. Shadow-database facts did come from a successful fetch.
- Leak paths in §8 are reasoning, not incident data. My search found little on host allowlists.
- arm64 was checked by index and pool only. Nothing was executed on arm64.

## Appendix: spike inventory

- All under the scratchpad, `pgresearch/`. `dpkg -x`, never installed.
- Started and stopped (all confirmed down, 0 processes left): Postgres on random loopback ports (`d1`, `d2`, six `m*`), TCP only. Bulk data deleted afterwards.
- Installed under the scratchpad only: `dbmate@2.37.0`, `supabase@3.0.0`, PGlite packages, goose binary.
- No subagents used.
