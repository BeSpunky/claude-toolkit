# Spike: parallel native Supabase stacks in one container

> 2026-11-04. Tests the open tension in `supabase.md` §3 and the *Must be proven first* row in `ARCHITECTURE.md`.
>
> **[O]** observed here. **[I]** inferred. **[SRC]** read in `supabase/cli` at tag `v3.0.0`.
>
> Setup: `supabase@3.0.0` exact, in scratch, on the Debian 13 amd64 devcontainer (24 cores, 62 GB, user `node`, no Docker). `SUPABASE_HOME` was a literal scratch path, and `SUPABASE_NO_KEYRING=1` and `DO_NOT_TRACK=1` were exported before the first CLI command. Every start passed `--runtime native`. Stacks: `a`, its git worktree `a-wt`, and separate projects `b` and `c`. Nothing hosted, no login, no `--remote`.

## Verdict

**Parallel native stacks are safe enough to be the default. The isolation Supabase warns about held. The real hazard is inside one stack: interrupting `db reset`.**

No limit on N is needed for correctness. Memory sets the practical limit, and it is modest unless services are eager. A layer must enforce these rules:

| # | Rule | Why |
|---|---|---|
| 1 | **Serialize `stop` and `db reset` per stack with an exclusive lock, and let a reset finish even if its caller is interrupted.** Every layer path that resets or stops takes the lock. | Any interruption from about 0.6 s to 2.5 s into a 3.4 s reset damages that stack (below). The prototype keeper waited out a reset, and the restart succeeded. |
| 2 | **After every `start`, assert the database is really there:** open a new connection and check `supabase_migrations.schema_migrations` exists. If it doesn't, run `db reset`. If `start` fails naming `.supabase-postgres-init-pending`, `postmaster.opts` or "partial lifecycle state", tell the user. | `start` returned 0 and `status` said healthy on a half-built database. Migrations and seed were silently missing. |
| 3 | **Only the launcher calls `start`, and it compares the reported ports with what it asked for.** | With `SUPABASE_*_PORT`, a `start` missing those variables moved every pinned port and exited 0. A `start` with new ports on a running stack exited 0 and kept the old ones. |
| 4 | **Pin ports with `SUPABASE_*_PORT`, not `env()` in `config.toml`,** or use automatic ports. Keep any offset block out of 20000–32767. | With `env()`, every later CLI command fails when the variable is unset. `pgmeta.http` and `realtime.rpc` can't be pinned and allocate from that range. |
| 5 | **Never `--eager`.** | About 7 GB PSS at N=4, against about 0.6 GB lazy. |
| 6 | **The launcher stays alive for the stack's lifetime.** It can't hand its lock to the stack (below). | The owner doesn't inherit file descriptors. |
| 7 | **Never treat `status` as proof of database health, and never sweep `/dev/shm/PostgreSQL.*`.** | See *The accident*. Removing one segment broke every new connection while `status` still said healthy. |
| 8 | **Warm the cache once before parallel first starts:** `supabase stack install --runtime native`. | Not a correctness issue. Concurrent cold starts succeed but take about 3x as long. |

## 1. Starts

| Scenario | Result | |
|---|---|---|
| 4 simultaneous cold starts, empty cache | All exit 0 in **189–204 s**, against 63 s for one in the earlier spike | [O] |
| Cold cache on disk | 2.6 GB at peak, 1.7 GB once finished. **Shared across stacks** | [O] |
| Do cold starts race? | No corruption, and ports were all distinct. Each process extracted into its own `.staging/<uuid>` | [O]. That each one also downloaded separately is [I] from the staging dirs and the time |
| New stack, warm cache | 2.5–3 s | [O] |
| Existing stack, 4 concurrent / sequential | 0.9–1.2 s / 0.8–0.9 s | [O] |
| 8 rounds of concurrent stop + start on all 4 | 0 failures, ports and data intact | [O] |
| `a` stopped and started 10 times while the others looped `db reset` | 0 failures | [O] |

Upstream's concern has a concrete shape. Each owner sweeps other stacks whose lease is free, and native processes are watched through `/bin/ps -axo pgid=,stat=` [SRC]. So `/bin/ps` (procps) is a runtime dependency of the layer [SRC].

Each Postgres listens only on its own Unix socket in `/tmp/supabase-<uid>/pg-<hash>/` with `listen_addresses` empty, and the owner proxies TCP [O]. That removes the shared-port and shared-socket collisions, and it means the database port dies with the owner.

### Memory and disk at N=4

| State | PSS | RSS | Processes |
|---|---|---|---|
| Lazy, idle | **570–660 MB** (about 145 MB each) | 1.2 GB | 44 |
| 18-minute stress, median / peak | **1.9 GB / 2.3 GB** | 4.0 GB peak | up to 88 |
| Stress plus 3 more stacks starting and stopping | 2.5 GB peak | 4.6 GB | 112 |
| `--eager`, settled | **7.0 GB** (about 1.75 GB each) | 11.3 GB | 208 |

Eager by service, PSS across 4 stacks: analytics 2.0 GB, supabase owner and launchers 1.0 GB, studio 0.95 GB, storage 0.84 GB, realtime 0.83 GB, pgmeta 0.48 GB, edge-runtime 0.36 GB, postgres 0.33 GB [O].

CPU: the host was a median 22% busy across 24 cores during stress (about 5 cores), against a load average of 2.5–3 beforehand. That includes the harness and other agents, so I did not isolate the stacks' share.

Disk: 1.7 GB of shared artifacts plus about 66–75 MB per stack after the run, so about 2 GB in all.

## 2. Stress, 18 minutes

Four stacks ran concurrently and each stack had its own loop:

- `migration up`, `db push`, every third cycle `db diff`, then `db reset`. Every other reset was released by a barrier so all four ran at once; the others were jittered so that a sibling was at steady state.
- 4 Postgres writes a second, a sign-up and an upload about every 3 s through the stack's own URL, and an 80 s pause now and then to let lazy services sleep.
- A positive check every 5 s, 25 s and 20 s (below).

**Volume:** 217 resets, 434 migration runs, 72 diffs, 0 CLI failures. 14,621 writes, 915 sign-ups, 910 uploads, 908 read-backs.

| Assertion, each recording a violation | Checks | Violations |
|---|---|---|
| Another stack's marker row or migration table is absent from this stack | 553 pairs × 2 | **0** |
| Another stack's object can't be read through this stack's URL | 553 | **0** |
| Only this stack's users and objects exist here | 700+ | **0** after first reset (see note) |
| Sibling's reset takes no row from this stack: every write acknowledged since its own last reset is still present | 696 checks over 27,917 rows | **0** |
| `system_identifier`, `data_directory` and postmaster start time change only on own reset | 700+ | **0** |
| Ports and `DB_URL` from `status` stay put | 138 | **0** |
| Sibling's markers appear anywhere in this stack's directory on disk (12 pairs, 3 marker kinds) | 36 greps | **0**. Positive control found own objects in 226–230 files per stack, so the scan can see them |
| Writes fail, or sign-ups, uploads or read-backs fail, outside a 5 s / 20 s window around own reset | 0 outside | **0** |
| `stack list` owners stay reachable, no member failed | 138 | **0** |
| Object content matches, and sign-up returns the right user | 908, 915 | **0** |

During 3 minutes of this run I also started, stopped and destroyed three further stacks (section 4), which caused nothing.

Notes on what the raw counters said:

- **12 flagged rows at t=6.3 s are harness artefacts:** own-stack rows left by my 60 s smoke run under an older run id, gone at the first reset. An earlier smoke-run alarm of "foreign marker" was also my bug: `M-a-%` matches `M-a-wt-…`, and `_` in `LIKE` is a wildcard. Both were fixed or discounted by reading the data, not by loosening the check.
- **4 `lifecycle: starting` readings** came up to 2.7 s after that stack's own `db reset` returned. During a reset, `status` reports `stopping` and only the database endpoint. So a reader must treat these as transient.
- Reset times: median 3.4 s, max 7.3 s. Migration 0.3 s. Diff 1.2 s.
- Lazy wakes after sleep: 636 ms median.

**What isolation does not cover.** All stacks get identical credentials [O]: the same publishable key, service-role key and S3 keys. A user token from `a` was accepted on `c`: `/rest/v1/` returned 200, and only `/auth/v1/user` returned 403 for the missing user. So **the URL is the entire isolation**, and a wrong URL fails as a wrong-data bug rather than an auth error.

## 3. Stop, kill, destroy

| Action | The stack | Siblings |
|---|---|---|
| `supabase stop` | Gone in 0.3–1 s, no processes, data and ports kept, restart 0.85 s | Unaffected [O] |
| `kill -9` owner | Children gone in under 0.5 s through the launcher's parent-loss handling, TCP refused, `status` says `unavailable`. **No orphans.** `start` recovers in 1.1 s with data and ports | Unaffected: postmaster start times unchanged [O] |
| SIGTERM owner | Clean fast shutdown, gone in 52 ms | [O] |
| `kill -9` postmaster or launcher | **Restarted by the owner within 3 s**, data kept, `status` healthy. Only the postmaster time shows it happened | Unaffected [O] |
| `kill -9` auth | Next request wakes it, 200 in 0.35 s | [O] |
| `stack destroy` on a running stack | 0.37 s, no processes left. An empty `stacks/<id>/data` dir stays. Same stack id if restarted, **new ports** | Unaffected, cache kept [O] |

### Interrupting `db reset` is the real failure

A reset rebuilds the cluster (`system_identifier` changes). I tried 5 interruptions at 7 delays each on a fresh stack: 36 trials, counting one uninterrupted reset as the control. Each cell is one trial per delay and action.

| Interrupted at | `stop` / SIGTERM owner | SIGKILL every process (a container stop) | Ctrl+C or SIGKILL of the CLI only |
|---|---|---|---|
| 0.2 s | `stop`: the reset completes first. SIGTERM: reset rc 1, data **kept** | Data kept | Data kept |
| 0.6–1.0 s | **WEDGED** | **`start` fails** (`init-pending`, or "no recorded identity") | **`start` rc 1** "partial lifecycle state" |
| 1.5 s | **SILENT half-state** | **WEDGED** | Partial |
| 2.0–2.5 s | **SILENT half-state** | **SILENT half-state** | Partial |
| 3.0 s | Finished | Finished | Finished |

- **Wedged:** `start` and `stack restart` fail naming `.supabase-postgres-init-pending`. Removing that file only moves the error to "no postmaster.opts". **Only `stack destroy` recovers, and automatic ports change.** Loud.
- **Silent half-state:** `start` exits 0, `status` says running and healthy, auth health is 200, and `public` is empty with no `supabase_migrations` schema. **`db reset` repairs it.** This is the worst case because nothing reports it. An agent would chase missing tables.
- **Partial:** `db reset` repairs it. `stop` + `start` exits 0 but lands in the silent half-state, so that path is a trap.
- Killing the CLI mid-reset also leaves `/tmp/supabase-pg.*`, `/tmp/supabase-stack-catalog-storage-*` and about 1 MB in `/dev/shm`.
- Siblings were unaffected in every trial [O]. The damage is one stack's, and its data is already gone by then, since it was a reset.

The docs say roughly this about first bootstraps ("there is no recovery journal") [SRC]. Reset behaving the same way is what this spike adds. A container restart during a reset can't be prevented, so rule 2 is what catches it.

### The accident: `/dev/shm`

At 06:39:45 UTC, every sibling stack began failing new connections with `FATAL: could not open shared memory segment "/PostgreSQL.…"`, while `status` still said `reachable / running / healthy` and auth returned 502.

I first blamed my `kill -9` of `b`'s owner, which ran at about the same moment. **That was wrong:** with a watcher on `/dev/shm`, the same kill removed only `b`'s own segments. The cause was the concurrent `spike-lifecycle` agent's cleanup, issued at 06:39:45.058, which removed segments dated after 06:05 that its `grep` over `/proc/*/maps` found unmapped. It reported "8 segments… mapped by no process". Those 8 included my live stacks' [I, from timing, the count, and failing first ticks at 45.6–50.4 s].

The controlled repeat is the useful part [O]:

- Postgres's 1 MB `/dev/shm` segment is **in use by name even when no process maps it**, so "mapped by nobody" does not mean dead. **`spike-lifecycle.md` should not keep that check as advice.**
- Removing it: a held connection kept working, and every new connection got FATAL. `status` reported healthy.
- Removing only the control segment caused no failure.
- `db reset` or `stop` + `start` repairs it.
- The stacks use `dynamic_shared_memory_type=posix`, and I found no reason it would differ across stacks. A `SIGKILL`ed stack's two segments stay until it next starts [O]. Then they are cleaned, so repeated kill-and-start didn't accumulate: 10 files before and after.

The 18-minute stress ran before this, so its results are unaffected.

## 4. Ports for the offset model

- **Pinning works.** `SUPABASE_API_PORT`, `DB_PORT`, `STUDIO_PORT`, `ANALYTICS_PORT`, `LOCAL_SMTP_PORT`, `LOCAL_SMTP_SMTP_PORT`, `LOCAL_SMTP_POP3_PORT` and `EDGE_RUNTIME_INSPECTOR_PORT`, from base 41000, all appeared in `status` with no conflict between keys [O]. `DB_SHADOW_PORT` and `DB_POOLER_PORT` were set without complaint; neither endpoint is listed, since the shadow runs only during a diff and the pooler was disabled, so those two aren't confirmed.
- **Not pinnable:** `pgmeta.http` and `realtime.rpc` stayed automatic, in 20000–32767 [O].
- **Feeding `DATABASE_URL`:** read `env.DB_URL` from `start` or `status --output-format json`, or `status --env --output-format text`. Validate a loopback host and a non-empty port. A plain `db query` then needs no pin variables, because it finds the stack [O].

| Clash or mistake | Exit | Loud? |
|---|---|---|
| Port held by a running sibling | 1, names the project and stack id | **Loud**, and leaves an `unavailable` registration |
| Port held by a non-Supabase listener | 1, "Cannot bind api at…" with the fix | **Loud** |
| `env()` variable unset or empty | 1, "is not a port" | **Loud**, and every later command in that project fails the same way |
| A stopped sibling's saved port | 0, new stack takes it | Allowed |
| **`start` without the pin variables on a stopped pinned stack** | **0, every pinned port moves to automatic.** Text on stderr, `endpoint_changes` in JSON | **Silent to anything reading the exit code** |
| **`start` with changed ports on a running stack** | **0, keeps old ports.** Only `message` says so | **Silent** |

## 5. Foreground and lifetime

**No foreground mode exists.** `start` has no such flag, and `owner.json` says `"lifetime":"detached"` [O]. A `session` lifetime exists in the package, where the owner shuts down when its creator exits, but the CLI uses it only internally, such as for shadow stacks [SRC]. It is what the house would want, so it's worth asking upstream to expose.

Observed [O]:

- The owner is reparented to PID 1, in its own session and group, with stdin `/dev/null` and stdout and stderr on `owner.log`. So `start | cat` returns at once, and terminal Ctrl+C or a group kill never reaches it.
- **Nothing inherits descriptors.** I started a stack with fds 3 and 9 flocked. Once the launcher exited, both locks were free, and no process of the stack held them.

That inverts the Firebase shape. `generators/firebase-emulators/emulators.sh.tpl` has a detached keeper that *is the parent* of the suite and holds the lock through inheritance. Here the owner already exists and can't be a child, so the keeper is a **foreground `dev.json` process that holds fd 3 and watches the owner**. The tested prototype, about 15 lines of Node and 48 MB RSS:

1. Run `supabase start --runtime native --output-format json`, validate `DB_URL`, compare ports.
2. Read the pid from `$SUPABASE_HOME/stacks/<id>/owner.json`, with the kernel start time. There is **no pid in `status` JSON**, so this internal file is the one read, and the tripwire checks it.
3. Poll every 250 ms. Owner gone: exit non-zero.
4. On TERM, INT or HUP: take the per-stack lock, run `supabase stop`, exit.

| Event | Result |
|---|---|
| External `supabase stop` | Lock free in 57 ms |
| `kill -9` owner | Lock free in 276 ms, keeper exits 3 |
| TERM keeper during a reset | Keeper waits, reset rc 0, lock free in 2.5 s, restart OK. **Rule 1 works** |
| `db reset` | Owner pid unchanged, keeper and lock unaffected |
| `kill -9` keeper | **Lock free while the stack keeps running and holding its ports.** `dev ps` will call it dead |
| New keeper on that stack | `start` adopts it, owner unchanged, stop works |

The last two rows are the one known gap. Unlike the Postgres launcher, whose children hold fd 3, an orphan here is invisible to the engine's kernel-lock liveness. Adoption is idempotent, so a new serve in that tree recovers it, but a tree nobody serves again stays running until `supabase stop --all`. That's a design decision for the layer. I didn't run this under the real dev engine.

## 6. Disk, logs, restart

- **Growth during 18 minutes:** data dir flat at about 65 MB, because a reset rebuilds it. Logs 0.4 → 5.8 MB per stack, under the 10 MiB per-instance cap [SRC], which wasn't reached. Logs are at `$SUPABASE_HOME/stacks/<id>/logs/<service>/<instance>/NNNN.log`, and `owner.log` stayed empty.
- **Two slow leaks** [O]:
  - `db reset` never clears `uploads/`: 247 files on disk against 2 rows. About 3 MB here; larger with real files.
  - An empty `stacks/<id>/data` directory stays behind per destroyed stack and per `db diff` shadow: 75 after 72 diffs. Harmless but unbounded.
- **Simulated container restart.** I `SIGKILL`ed all 49 processes of all stacks, deleted `/tmp/supabase-1000`, and moved `ports.sqlite` away. Four concurrent `start`s then recovered in **1.1–1.7 s**, with Postgres crash recovery, data and every port kept, no `endpoint_changes` [O]. It can't simulate a real rebuild.
- **`~/.supabase/ports.sqlite` still appears** regardless of `SUPABASE_HOME` [O]. This spike caused it (it was absent at the start) and removed it. Telemetry stayed off and nothing else leaked there, because the variables were exported first.

## 7. Tripwire

`research/spike-native-tripwire.mjs`, node built-ins only. **PASS in 43 s from nothing** (real npm install, empty cache, database artifact only) and 14 s with a warm cache. It proves by value:

`start --runtime native` · status JSON shape · `owner.json` · `migration up` · `db diff` names a drifted table · `SUPABASE_DB_PORT` honoured · a git worktree gets its own stack · a sibling's row survives a reset, and doesn't leak · reset drops drift, reapplies, seeds, keeps ports · `stop` keeps data, `start` resumes on the same port · `destroy` leaves no process.

One thing it taught: **`db query --output-format json` has a different shape under an AI agent.** With `AI_AGENT` or `CLAUDECODE` set it returns `{ advisory, boundary, rows, warning }`. With `--agent no` it returns a bare array. The `advisory` text addresses the agent directly (it told the reader to surface missing row-level security to the user), so the parser must pin `--agent no`, and a generated agent workflow should expect that text in tool output and treat it as data. I did not act on it: the tables were throwaway fixtures.

It doesn't test the reset-interruption behaviour, because the layer's design avoids that rather than relying on it. Add that if rule 2's recovery messages ever get parsed.

## Not proven

- A real rebuild or container restart. Hours or days of uptime: this was 18 minutes.
- Load heavier than this harness. Realtime, Functions, Studio, Analytics and the pooler were started (eager) but never exercised under load.
- `stop` during a long-running migration, and a new stack pinned onto a stopped automatic-port stack's saved port. My runs of both were void because that stack was already wedged.
- Whether automatic ports avoid the dev engine's claimed port blocks. A collision with a live listener should fail loudly (observed for pinned ports only).
- More than 7 stacks. A small `/dev/shm` under load: each stack uses about 1 MB of Docker's default 64 MB, and `spike-lifecycle.md` reports parallel hash joins failing there. Not retested on this stack.
- The keeper under the real dev engine. arm64. Low-memory hosts.

## Process roster

- **Stopped and destroyed:** stacks `a`, `a-wt`, `b`, `c`, `p`, `q`, `r`, `x1`–`x3`, plus tripwire stacks. At the end: 0 stack processes, 0 listeners, `stack list` empty.
- **Removed outside scratch:** `~/.supabase/`, `/tmp/supabase-1000/`, `/tmp/supabase-pg.lQ0Mjm`, three `/tmp/supabase-stack-catalog-storage-*`.
- **Left, not removed:** four `/dev/shm/PostgreSQL.*` dated 06:50–06:53 (about 2.1 MB). They very likely came from my interrupted resets, but a timestamp sweep there is what broke my stacks, and the auto-mode check also denied one, so I'm not deleting them on inference. They go at the next container restart. Two more from 05:42–05:43 predate this spike. Up to 4 SysV segments of 56 bytes with no attachments were left too, which I couldn't attribute. `~/.npm` gained cache entries for the CLI.
- **Left in scratch:** harness, logs and raw results in `/tmp/claude-1000/-workspaces-claude-toolkit/0bf80dcc-918b-416c-bc7b-ad1b50711a79/scratchpad/spike-native/`. Stacks, cache and CLI were deleted, so re-running needs an install.
- **Two mistakes of mine, for the record:**
  - `grep -l … /proc/[0-9]*/fd/*` read through descriptors until it hung on one for about 3 minutes. Reading a pipe can consume its data, so another process in the container could have lost input.
  - `pkill -f` on that pattern also matched and killed my own shells. I confirmed the 3 PIDs were mine, and then used exact PIDs.
- **Agents:** none spawned (budget was 1).
