# Spike: a Postgres server per dev stack, under the real engine

> 2026-11-04. Tests decisions 1, 2 and 7 and the *Dependency process* seam in `ARCHITECTURE.md`.
>
> **[O]** observed here. **[I]** inferred. **[R]** reported by others, not run here.
>
> Setup: the real dev engine, rendered by copying each `.tpl` as `writeEngine` does, into scratch git repos. Debian 13, amd64. PostgreSQL 18.6 from PGDG, pgvector 0.8.7 and dbmate 2.37.0, all sha256-checked and extracted to scratch, non-root. `CLAUDECODE=1`, so the engine put every stack on a shifted block. Single runs of each scenario on one machine: treat timings as orders of magnitude.

## Verdict

**Server-per-stack holds, against the shared server. The design as written does not.** Lifecycle was the shared-server research's deciding objection, and the engine answered it: the postmaster and all its children hold the stack's lock as fd 3, so `dev ps` and `dev stop` see and stop every orphan with no new engine code. Across 52 recorded stop scenarios, each committing a row first and then counting on the next start, no committed row was lost and no uncommitted row survived.

Five parts of the design must change:

| # | Design says | Evidence | Change |
|---|---|---|---|
| 1 | "Started in the foreground", read as `exec postgres` | The engine's SIGTERM is Postgres's **smart** mode, which waits for clients. With one open `psql`, `dev stop` blocks. A launcher that exec's also cannot run create, migrate and seed afterwards | The launcher **stays the parent** and translates TERM and HUP to SIGINT (fast). All stops then take 95–361 ms with a client open |
| 2 | Data dir per tree | A second stack in the same tree (an agent beside a developer's serve, e2e beside a serve, a second app) is refused by `postmaster.pid`, and **the whole stack FAILS** | Key the data dir by stack: `${TREE}/.postgres/${APP}@${OFFSET}/data`. Tested: two stacks in one tree, separate data, and the first block's data is back after a restart |
| 3 | Not addressed | `/dev/shm` segments leak on every SIGKILL (+2 files, about 1 MB, for the container's life). A lone server's parallel hash join fails at `work_mem=16MB` under Docker's 64 MB default | `dynamic_shared_memory_type=mmap`: no shm use, no leak, the query succeeds |
| 4 | Implicit `PG_VERSION` check | A SIGKILL during `initdb` leaves a directory that **starts** with only `template1` | `initdb` into a sibling, then rename |
| 5 | In-tree data is "untested on Docker Desktop" | Sound on Linux. Windows paths are broken by mechanism. macOS has repeated negative reports and no positive one on a current version | Decision 2 is **not proven for consumers** (§3) |

**How far the verdict reaches.** The shared server was never run. The comparison rests on `layer-infra.md` §4.5 plus what was seen here. It stands because the costs of N servers came out small and already handled: 30 servers took 571 MB PSS in total (19 MB each), 40 MB of disk each, a warm start of about 70 ms, and a cold start of about 0.9 s. Two findings also favour per-stack: `system_identifier` can only tell stacks apart if each has its own cluster (§5), and one SIGKILL costs one stack.

**What the shared server would still do better [I]:** no second-stack question and no 0.9 s cold start. Neither justifies S1–S9.

## 1. Stop paths

Each row: an open idle client holding an uncommitted row, unless noted. "Gone" is the time until no process has the data dir as its cwd. Fixture: an `app` primary plus a `db` process. Run under `dev serve`, 18.6, real `killProcessTreeGraceful` loaded from Nx 23.1.0's native binding.

| Stop | `exec postgres` | Launcher stays parent (bash and Node, same results) |
|---|---|---|
| Ctrl+C (SIGINT to the group) | 98–107 ms, fast | 121 ms, 361 ms, fast |
| `dev stop` | **Hangs while the client is open**, 103 ms without one | 104–143 ms, fast |
| SIGTERM to the launcher | **Hangs** | 106–145 ms, fast |
| SIGTERM to the serve | **Hangs** | 95–109 ms, fast |
| SIGHUP to the group (terminal closes) | **Hangs** | 132 ms, fast |
| Nx kill, leaf first | 134 ms; the client's backend dies first, so smart completes | 125–135 ms, fast |
| SIGKILL the serve | Orphan; `dev ps` says ORPHANED; `dev stop` clears it in 108 ms | Orphan; `dev stop` 127–159 ms |
| SIGKILL the launcher | 110 ms; it *is* the postmaster, pid file stale; next start recovers | Orphan; `dev stop` 133–156 ms. With `setpriv --pdeathsig INT`: gone by itself in 139–421 ms, clean |

**Road `dev claim`, script as claimer, same matrix:**

| Stop | `exec` | Stays parent |
|---|---|---|
| Ctrl+C | 140 ms | 128 ms |
| `dev stop` | Hangs | 202 ms |
| SIGTERM | Hangs | 116 ms |
| Nx kill | **5.3 s, SIGKILLed, stale pid file** | **5.2 s, the same** |
| SIGKILL | 215 ms, stale pid file | Orphan, then `dev stop` 114–121 ms |

### Answers

- **Does `dev stop` find the orphan through the lock fd? Yes.** Postmaster, io workers, checkpointer, bgwriter, walwriter and both launchers all hold fd 3 [O]. A **Node** launcher must pass it explicitly (`stdio: [..., 3]`), or Node closes it; passing it worked [O].
- **`dev ps` tells the truth.** `ORPHANED … holds the stack (pid …)` with the exact stop command while orphaned, `No running stacks` afterwards [O].
- **`lockHolders` signal:** SIGTERM to the holders and their descendants. The postmaster logs smart; every backend is SIGTERMed directly, so smart cannot hang on this path. 0 crash lines in the logs, and no recovery on the next start [O].
- **The smart hang, in full:** `dev stop` with an open client printed `…waiting for its processes to stop`, then `still shutting down after 61s — nothing was killed`, rc 1, at `DEV_STOP_TIMEOUT=1`. The default is 240 s [O for 61 s; I for 240 s, from `dev.mjs`]. `dev ps` still says "up" during it, new connections get `the database system is shutting down`, and the moment the client closes the server exits in about 110 ms [O].
- **Nx leaf-first under `dev serve`:** clean, but by luck of the fixture. The app leaf dies, so the serve stops the stack before Nx's grace ends. The postmaster's leaves also got SIGTERM with no crash [O]. Nx then reports `the stack FAILED: app exited on SIGTERM` when the app has no handler [O]. That is the engine's existing reading of a leaf-first kill, not a Postgres matter.
- **Nx kill with Postgres alone** (claim road): no shutdown request logged, SIGKILL at about 5 s, next start recovers, every committed row present. The likely cause is that the checkpointer ignores SIGTERM, so a leaf never exits and Nx waits out its grace [I]. So `nx run postgres:start` stopped by Nx is always a crash stop. Safe, slower, and `mmap` is what stops it leaking shm.
- **Next start, unaided:** succeeds in about 220 ms after every clean or crash stop (stale pid file included). It does **not** succeed while an orphan lives:
  - Orphan alive: `lock file "postmaster.pid" already exists`; the new stack lands on the next block and FAILS [O].
  - Postmaster SIGKILLed under a **long query**: the backend and its parallel workers survive it (still running 30 s later in the bare test), and the next start fails `pre-existing shared memory block … is still in use` [O]. They hold fd 3, so `dev stop` clears them in 138 ms [O].
  - Both are refused loudly and cleared by one command, but neither heals itself. The launcher must name the stop command.
- **Stale `postmaster.pid`:** raw Postgres refuses when it names any live PID [O], confirming the earlier finding, but tolerates its own PID [O]. The launcher's test is `readlink /proc/<pid>/cwd == realpath(PGDATA)`. It removed the file when the PID was an unrelated process **or another stack's live postmaster**, and refused correctly (rc 3) when a server of that data dir really ran [O]. Across PID namespaces this test cannot see the other server [I]; the engine's `foreign` check covers that if flock reaches across containers. Not tested on a Docker Desktop mount.
- **An orphan keeps stdout open:** with the serve piped into a reader, the reader did not end after SIGKILL of the serve, and ended after `dev stop` [O]. A caller reading the output through a pipe stays blocked until then. Not specific to Postgres.

## 2. Two stacks, two worktrees

Real git worktrees at a 137-byte path, on the ext4 bind mount.

- **Simultaneous cold start of three stacks:** all up in 726 ms, on their own blocks, data isolated [O].
- **Stopped in both orders:** the other stack is untouched, and A came back on the same port [O].
- **Sockets:** an in-tree socket would be 159+ bytes, which is fatal. `DEV_STACK_TMP` gives **41 bytes** (`/tmp/bespunky-<12 hex>/.s.PGSQL.39101`), is 0700, private, exists before the launcher runs and goes with the stack; connecting through it worked [O]. It needs no new mechanism. TCP alone also works; the socket is still useful for `psql`.
- **`/dev/shm`:** idle servers use about 1 MB each with `posix`. 30 servers: 26 MB of 64 MB. N is not the real problem; a parallel hash join is, even on a lone server:

  | `work_mem` | Result on a lone server |
  |---|---|
  | 4 MB, stock | Succeeds |
  | 16 MB, 64 MB | `could not resize shared memory segment … No space left on device` |

  A shared server would hit the same limit [I]. With `mmap`: zero shm, a query that failed now succeeds in 279 ms, `pg_dynshmem` 1.1 MB, and a SIGKILL leaks nothing [O]. Chromium in the web layer competes for the same tmpfs [I]. `mmap` puts those files in PGDATA, which is one more reason to care where PGDATA lives.
- **Memory:** 31–32 MB PSS per server with three running, 19 MB per server with thirty. The `21 MB` in decision 1 is plausible but depends on how many share pages [O].

## 3. Data in the tree

**Linux, ext4 bind mount [O]:**

- 0700 is set by `initdb`, and 0755 is refused at start with the right message. The launcher can repair it.
- `git status` stays clean with `.postgres/` ignored and a live server.
- `git worktree remove` with 47 MB of ignored data succeeds without `--force`.
- **`git worktree remove` under a running server also succeeds.** The record goes with the tree, so `dev ps` no longer shows that stack, while the port still listens and connections fail with `could not open file "global/pg_filenode.map"`. Postgres's lock-file recheck then shut it down by itself after 57 s, and the serve exited, logging `stopped cleanly`. The in-tree location is what makes this heal. An out-of-tree data dir would not self-destruct, leaving a server with no handle [I].
- pgbench, fsync on, scale 20, 4 clients: **ext4 8865 tps, overlay 8903 tps**. No difference worth noting.

**Docker Desktop.** Not runnable here; all [R], gathered by a research subagent through a summarising fetcher, so recheck quotes before citing.

| Platform | State | Confidence |
|---|---|---|
| **Linux native Docker** | Works when the uid matches ([docker-library docs](https://github.com/docker-library/docs/blob/master/postgres/content.md), [#1010](https://github.com/docker-library/postgres/issues/1010), `updateRemoteUserUID`) | Direct support; also what ran here |
| **macOS bind mount** | **Unknown today, negative history.** Closest match to our shape: non-root owner, `stat` shows correct owner and 0700, Postgres still says "wrong ownership" ([for-mac#7415](https://github.com/docker/for-mac/issues/7415), open, 2024). Mounts flapped to 0:0 for about a second on 4.88–4.95, fixed in 4.96 per [release notes](https://docs.docker.com/desktop/release-notes/) and [desktop-feedback#628](https://github.com/docker/desktop-feedback/issues/628). 4.80 stopped persisting faked ownership changes on the host, so whether a chmod survives a restart is unknown. On Docker VMM, acknowledged SQLite rows were lost on bind mounts ([#765](https://github.com/docker/desktop-feedback/issues/765), unverified fix) | Issues, mostly not about Postgres. **No report either way on >=4.96**, and no fsync or corruption report for Postgres found; absence is not safety |
| **Windows path (C:, /mnt/c)** | **Broken by mechanism:** "we expose everything to Linux as 777" ([for-win#4824](https://github.com/docker/for-win/issues/4824)); VS Code says files appear root-owned. Root plus 777 fails both Postgres checks for any user [I, strong] | Staff comment and docs |
| **Windows, tree in WSL ext4** | Should work if the uid matches; `updateRemoteUserUID` is documented for Linux only | Inferred; no direct report |
| **Clone in container volume** | Should work: the tree is on the VM's Linux filesystem | Inferred |
| **Precedents** | Named volume everywhere confirmed: DDEV ("no end of trouble bind-mounting the database… especially Windows", [PR 987](https://github.com/ddev/ddev/pull/987), 2018), the devcontainers Postgres template, Supabase CLI. **No bind-mount precedent found** | Docs |

**In-tree verdict.** Sane on Linux native, WSL ext4 and a container volume. Not defensible as an unconditional default on macOS or a Windows path. Windows users can land on the broken case without choosing it, since Open Folder in Container bind-mounts the Windows folder [R].

**Recommendation for the caller to decide:** make the data home one launcher function, gated on the filesystem the tree actually sits on. A local Linux filesystem means in-tree; anything else (VirtioFS and fakeowner, 9p, drvfs) means `~/.local/share/bespunky/postgres/<tree hash>/<stack key>` plus a sweep. A write-and-chmod probe alone is not enough: the 0:0 flapping was transient, and fsync cannot be probed [I]. The alternative is one road, always out of tree: simpler, works everywhere, but loses the worktree-death cleanup and the 60 s self-heal above, and an adopted image loses data on rebuild. The fstype names on Docker Desktop are unverified. A macOS run on >=4.96 remains the only way to settle this.

## 4. Create, migrate, seed before ready

Prototype launcher, Node built-ins only, 69 lines. Fixture: 50 tables with indexes, pgvector, two migrations, 50,000 seed rows, 22 MB.

| Step | Elapsed (cold, one run) |
|---|---|
| `initdb` + identifier recorded | 602 ms |
| Accepting connections | 636 ms |
| Identity check | 645 ms |
| Database created | 689 ms |
| dbmate migrated | 779 ms |
| Seeded | 892 ms |

**Nothing to ready, three runs: 848–978 ms. Warm, nothing to migrate: about 45 ms inside the launcher, about 70 ms from outside [O].**

**Template reset inside a stack's server:** drop 15–19 ms plus clone 43–48 ms, including a psql spawn each; the first clone took 129 ms. `DROP DATABASE … WITH (FORCE)` with a connection open: 123 ms. The 35 ms claim is about right [O].

### dbmate and `.env`

A decoy server stood in for production, with a real write as the test [O]:

| Case | Reached |
|---|---|
| `.env` in cwd, no flags, no env | **Decoy** |
| `.env`, `--url real` | Real |
| `.env`, `DATABASE_URL=real` in env | Real |
| `.env`, `--env-file <empty>`, no URL | Refused: `invalid url` |
| `.env`, `--env-file /nonexistent`, no URL | Refused, no complaint about the file |
| Clean cwd, no flags | Refused |
| `.env` with `DBMATE_MIGRATIONS_DIR`, `--url real`, no `-d` | **The `.env` value is honoured**, even with a URL given |
| `--url` with **no host**, `PGHOST`/`PGPORT` in `.env` | **Decoy** |
| The launcher's form, same hostile `.env` | Real |

**So `--env-file` does replace the default `.env` load, and `--url` alone does not shut the door**, since `.env` still sets other `DBMATE_*` and `PG*` values. The launcher's form: a generated empty `--env-file`, a complete `--url` with a host, explicit `-d`, `--migrations-table` and `--no-dump-schema`, cwd outside the tree, and `PG*`, `DATABASE_URL` and `DBMATE_*` scrubbed from its environment.

## 5. `system_identifier`

- **Readable as a plain role:** equals `pg_controldata` [O].
- **Revoked on a hardened server:** `permission denied`, so a check must fail closed [O].
- **TCP tunnel on a local port to another server:** the identifier differs, and the check refuses it [O]. A string check would have passed it.
- **A copied data dir shares the identifier** [O]. PG 18's `pg_resetwal --help` lists no way to change it [O], so a copy keeps it for life.
- **Does the copy matter?** Not for production safety: the failure is local-to-local, and local verbs take no URL, so they never choose among copies [I]. A production clone has production's identifier, not the recorded one, so it is refused [I]. Only one route defeats the check: restoring *this stack's own* data dir on a remote host and pointing a verb there, which needs a URL that local verbs do not accept [I].
- **Multi-host URLs:** `postgresql://…:P1,…:P2/` connected to the first [O]. A check on one connection and an action on another (dbmate) can reach different servers [I]. The launcher must build the single-host URL itself, which it does; a remote path must not reuse this check as if it were atomic.
- **For decision 1:** identity is per cluster. On a shared server every stack has the same identifier, so a wrong name could drop another stack's database and the check would pass [I]. Server-per-stack makes the check mean what decision 7 says.

Record the value beside the data dir, written during `initdb` before the rename, and rewrite it only there.

## 6. The dependency-process seam

Prototyped on a scratch copy of the rendered engine, not the repo.

| File | Lines |
|---|---|
| `lib/stack.mjs` (188 lines) | +32 −3: start dependencies first, poll `ready.cmd`, then start the rest |
| `lib/declaration.mjs` (294 lines) | +9 −2: `dependency`, `ready.cmd`, exports reach siblings |
| `dev.mjs`, `lib/stacks.mjs`, others | **0** |

**Total: 41 added, 5 removed. `stacks.mjs` and the stop and orphan logic were not touched.** Full diff at `/tmp/claude-1000/-workspaces-claude-toolkit/0bf80dcc-918b-416c-bc7b-ad1b50711a79/scratchpad/spike-lifecycle/results/seam.diff`.

**Observed on it:**

- The app starts after `db is ready`, with `DATABASE_URL` in its environment.
- `--skip=db`: the sibling gets no URL.
- A bad migration: the stack FAILS, the app never starts, no record or server left.
- A dependency that never turns ready: the stack FAILS at the timeout.
- `dev stop`, Ctrl+C and SIGKILL during the wait all end correctly; the SIGKILL leaves a true ORPHANED, cleared by `dev stop`.
- The stop matrix re-run on it with a client open: Ctrl+C 289 ms, `dev stop` 108 ms, SIGTERM to the serve 110 ms, Nx 234 ms, SIGKILL of the serve or launcher orphans cleared in 231–237 ms. Rows 7/7.

**One trap, caught by a test.** My first version let siblings start after a dependency failed. The dependency is then the only spawned child, so `remaining > 1` is false, nothing sets `stopping`, and the wait ends as if ready. The real seam needs that case in `tools/test-*`. `ready.cmd` must be stricter than `pg_isready`, which turns true before migrations finish [I]; the prototype used a file the launcher writes in the stack's state dir, which dies with the stack, so it cannot go stale. Not prototyped: `tcp` readiness, a configurable timeout, and a two-dependency stack.

## Launcher requirements learned

1. Stay the parent; never `exec` the server. Translate TERM, HUP and INT to SIGINT; exit with the server's status.
2. Node: pass fd 3 to the server explicitly. Consider `setpriv --pdeathsig INT` (util-linux): it self-cleans a killed launcher, leaving only a killed serve as the orphan case [O].
3. Data dir keyed by stack and, per `postgres.md`, by major. Say so when a stack lands on a new block, since it will be a fresh database.
4. `initdb` into a sibling, record the identifier, then rename. Sweep leftover `.init-*`. Enforce 0700 at start.
5. `postmaster.pid`: believe it only if `/proc/<pid>/cwd` is this data dir. A live one means refuse, naming `dev ps` and the stop command. Same for `pre-existing shared memory block`: that error should be rewritten to say which command clears it.
6. `unix_socket_directories=$DEV_STACK_TMP`, `listen_addresses=127.0.0.1`.
7. `dynamic_shared_memory_type=mmap`.
8. The dbmate form in §4, and the scrub.
9. Write the ready marker only after identity, migrate and seed. On failure, stop the server, then exit non-zero.
10. An exit of 0 when no stop was asked is still a failure to the stack: the self-shutdown after a worktree removal read as `stopped cleanly`.

## Unproven

- **Docker Desktop, all of it.** Decision 2 stays open until a macOS run on >=4.96 and a WSL run, each with a rebuild.
- **Real `nx serve`.** I used Nx's real kill function with its real binding, but not its task runner, so grace-period and output behaviour under `nx serve` were not observed.
- **A container rebuild** with in-tree data, including a stale `postmaster.pid` naming a low PID. Only simulated by writing the PID.
- **`arm64`**, a `.deb` closure installed as root, and paths other than `dpkg -x` with `LD_LIBRARY_PATH`.
- **Sustained load**, replication slots and walsenders on shutdown; `fast` should handle them [I].
- **File watchers:** WAL writes inside a watched tree could churn VS Code or Nx watchers [I]. Not measured. `.gitignore` covers Nx's; VS Code's needs `files.watcherExclude`.
- **A major bump** with in-tree data: refusal is expected, not run.
- **The shared server itself:** compared by reasoning, never run.

## Spike inventory

- **Agents:** 1 extra, for the Docker Desktop web research. No others.
- **Started and stopped by handle:** Postgres under `dev serve` and `dev claim` in about 10 scratch workspaces and a scratch repo with two worktrees, bare servers on random ports (43000–48000), up to 30 at once, and fixture Node apps. Port blocks 39100–54101, never 5432 or a base block; `DEV_OWNER=spike-lifecycle` throughout. **At the end: 0 Postgres processes, no serves, every workspace's `dev ps` empty.** One psql to an empty port during a harness bug tried 5432 and was refused; nothing listens there.
- **Removed:** `.claude/worktrees/spike-lifecycle-tmp/` (its worktrees were its own, `git worktree prune` never run, none registered on this repo); 8 `/dev/shm/PostgreSQL.*` segments leaked by these kills, each checked as mapped by no process.
- **Left alone:** 2 `/dev/shm/PostgreSQL.*` from 05:42–05:43, before this spike; apparently the previous researcher's SIGKILL tests, about 1 MB, gone at the next container restart.
- **Kept in the scratchpad:** the harness, launcher prototypes and raw results, under `/tmp/claude-1000/-workspaces-claude-toolkit/0bf80dcc-918b-416c-bc7b-ad1b50711a79/scratchpad/spike-lifecycle/`. Nothing installed system-wide. `yarn install` was not needed.
