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
| spike-lifecycle | foreground Postgres under the real dev engine; in-tree data | research/spike-lifecycle.md | dispatched |
| spike-native-concurrency | concurrent native Supabase stacks under stress | research/spike-native-concurrency.md | dispatched |

## Cannot run here
- A real root install of the closure, and a real container rebuild: need the user, once a branch has a fragment to rebuild from.
- Docker Desktop bind mounts: this host is Linux. arm64. A real hosted project: needs the user's account.

## Results

### spike-install (returned; unprivileged; 4 postmasters started and stopped; scratch 1.1 GB disposable)
Full: research/spike-install.md, closure script research/spike-install-closure.mjs. PGDG side pins and sha256-verifies from <codename>-pgdg-archive, nothing floats; 190 debs passed. Debian side cannot be pinned durably (superseded libssl3t64 is 404), floats by name.
Reverses decision 4's install form: extract to a versioned directory, not `apt-get install ./*.deb`, which removes libpq-dev here and blocks Debian's libpq-dev after; an archive repo left configured floats libpq5 to 19~rc1. Select libpq5 by major, not "no tilde" (stops working at 19 GA).
Descriptor: extend `archives` (closures by codename x arch, format deb, libraryPaths with generated wrappers, systemDepends via satisfy --no-install-recommends, optional prune). Weekly HEAD check, since a vanished pin fails cache-miss builds and repair needs a release.
Unproven until a rebuild: root dpkg -x plus satisfy in a real build, running as the remote user, real bookworm (harness invalid), arm64, satisfy on real devcontainers/base:debian. Maintainer scripts read, not run; not needed if extraction wins.
