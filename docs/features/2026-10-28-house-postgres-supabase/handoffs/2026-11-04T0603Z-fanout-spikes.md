# Fan-out ledger — spikes that can kill the design
As-of: 2026-11-04T0603Z · branch feat/house-postgres-supabase

## Goal
Run the items in research/ARCHITECTURE.md *Must be proven first* that this container can run, before asking the user to confirm the architecture. No layer or generator code.

## Shape and budget
No edges, then the orchestrator reconciles. Budget 12 (default); 3 leaves, none may need more. Isolation: each unit owns its own scratchpad subdir and report file; random ports; owner label per unit. All re-runnable.

## Units
| id | scope | output | status |
|---|---|---|---|
| spike-install | pinned .deb closure, unprivileged (first version using sudo and chroot was denied by the permission check) | research/spike-install.md | returned |
| spike-lifecycle | foreground Postgres under the real dev engine; in-tree data | research/spike-lifecycle.md | returned |
| spike-native-concurrency | concurrent native Supabase stacks under stress | research/spike-native-concurrency.md | returned |

## Cannot run here
- A real root install of the closure, and a real container rebuild: need the user, once a branch has a fragment to rebuild from.
- Docker Desktop bind mounts: this host is Linux. arm64. A real hosted project: needs the user's account.

## Results

### spike-install (returned; unprivileged; 4 postmasters started and stopped; scratch 1.1 GB disposable)
Full: research/spike-install.md, closure script research/spike-install-closure.mjs. PGDG side pins and sha256-verifies from <codename>-pgdg-archive, nothing floats; 190 debs passed. Debian side cannot be pinned durably (superseded libssl3t64 is 404), floats by name.
Reverses decision 4's install form: extract to a versioned directory, not `apt-get install ./*.deb`, which removes libpq-dev here and blocks Debian's libpq-dev after; an archive repo left configured floats libpq5 to 19~rc1. Select libpq5 by major, not "no tilde" (stops working at 19 GA).
Descriptor: extend `archives` (closures by codename x arch, format deb, libraryPaths with generated wrappers, systemDepends via satisfy --no-install-recommends, optional prune). Weekly HEAD check, since a vanished pin fails cache-miss builds and repair needs a release.
Unproven until a rebuild: root dpkg -x plus satisfy in a real build, running as the remote user, real bookworm (harness invalid), arm64, satisfy on real devcontainers/base:debian. Maintainer scripts read, not run; not needed if extraction wins.

### spike-lifecycle (returned; spent 1 of 1; 0 Postgres or serves left, 2 pre-existing shm files left)
Full: research/spike-lifecycle.md. Server per stack holds (shared server never run, so that comparison is reasoned): postmaster and children hold fd 3, dev ps and dev stop clear every orphan with no engine change; 52 stop scenarios, rows intact; 19 MB PSS and 40 MB disk each; warm ~70 ms, cold ~900 ms.
Design changes: no exec (launcher stays parent, TERM/HUP to SIGINT; exec hangs on smart shutdown with a client open, 61 s observed); data keyed per stack (.postgres/${APP}@${OFFSET}); dynamic_shared_memory_type=mmap; initdb to a sibling then rename; socket in DEV_STACK_TMP. dbmate: generated empty --env-file, full-host --url, explicit -d, scrubbed PG*/DBMATE_*.
In-tree data: sound on Linux. Docker Desktop by web research only: Windows path broken by mechanism, macOS no report either way on >=4.96 with negative history. Agent recommends gating the data home on the tree's fstype, else ~/.local plus a sweep. Seam prototype +41/-5 lines on a scratch copy; the first version wrongly started siblings after a dependency failed, so the real seam needs that test.
Unproven: Docker Desktop, real nx serve runner, real rebuild, arm64, deb closure together with this, walsenders, file watchers, major bump.

### spike-native-concurrency (returned; spent 0 of 1; stacks destroyed, 0 listeners)
Full: research/spike-native-concurrency.md, tripwire research/spike-native-tripwire.mjs (PASS, 43 s). Safe as default, no limit on N, 0 isolation violations in 18 min. Rules and keeper shape: ARCHITECTURE.md 6b.
Interference: spike-lifecycle's /dev/shm cleanup very likely deleted live stacks' segments at 06:39:45 (inferred, not reproduced); stress had finished, results stand. Its "mapped by no process" check is unsafe. Never sweep those.
Incidents: a grep over /proc/*/fd/* hung ~3 min and may have consumed data from other processes' pipes; pkill -f killed 3 of its own shells. Left: up to 6 /dev/shm/PostgreSQL.* and up to 4 SysV segments (cleared at container restart; the permission check denied a timestamp sweep, not worked around), ~/.npm cache.

## Synthesis
ARCHITECTURE.md amended: decision 2 reversed by the orchestrator to ~/.local with a sweep (rejecting the spike's filesystem gate), decision 4 to extraction, launcher rules 6a and 6b added. Budget 4 of 12 plus the denied dispatch.
