# Fan-out ledger — spikes that can kill the design
As-of: 2026-11-04T0603Z · branch feat/house-postgres-supabase

## Goal
Run the items in research/ARCHITECTURE.md *Must be proven first* that this container can run, before asking the user to confirm the architecture. No layer or generator code.

## Shape and budget
No edges, then the orchestrator reconciles. Budget 12 (default); 3 leaves, none may need more. Isolation: each unit owns its own scratchpad subdir and report file; random ports; owner label per unit. All re-runnable.

## Units
| id | scope | output | status |
|---|---|---|---|
| spike-install | pinned .deb closure, real root install in an isolated root | research/spike-install.md | dispatched |
| spike-lifecycle | foreground Postgres under the real dev engine; in-tree data | research/spike-lifecycle.md | dispatched |
| spike-native-concurrency | concurrent native Supabase stacks under stress | research/spike-native-concurrency.md | dispatched |

## Cannot run here
- A real container rebuild: needs the user, once a branch has a fragment to rebuild from.
- Docker Desktop bind mounts: this host is Linux. arm64. A real hosted project: needs the user's account.

## Results
