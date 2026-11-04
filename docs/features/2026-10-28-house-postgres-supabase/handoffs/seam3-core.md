# seam3-core — Landing 3, the `supabase` layer's core
Branch feat/hps3-core. Written as it goes; newest at the bottom.

## Observed on the real CLI (3.0.0, still npm `latest` on 2026-11-04; 3.1.0 is beta only)
- Tarball `supabase_3.0.0_linux_<arch>.tar.gz` holds one 140 MB standalone binary at its root. No change from the researched 3.0.0.
- `system_identifier` CHANGES on every `db reset`, `data_directory` does not (`$SUPABASE_HOME/stacks/<id>/data/<member>/data`).
- `../postgres/seed/world/*.sql` works as `[db.seed] sql_paths`, for `start` and `db reset`.
- A migration carrying `-- migrate:up` and an empty `-- migrate:down` runs under the CLI: `migration up`, `db reset`.
- `start` with a pin missing on a running stack: exit 0, the old ports, the fact only in `message`.
- Official plugin (supabase-community/supabase-plugin 0.1.17; marketplace pin 2c6d02d): `agents/claude/.mcp.json` is `https://mcp.supabase.com/mcp` with no project ref and no read_only. So it is unscoped hosted write access: the layer must not enable it.
- Outside SUPABASE_HOME, in the passwd home: `~/.supabase/cli-latest` and `~/.supabase/ports.sqlite` only.

## Log
- Engine: `avoidPorts` (process field) and `dev run --avoid-ports`. Why the engine changes: `auto` picks a block by hash, so a keeper's refusal alone would refuse the same tree forever.
- Generator + provider seam + keeper written; generator cases green. Evidence is a tag on the postgres project: the verbs stay postgres:*, so no second project.
- FOUND, real runs: the native runtime refuses any public port in 10000-19999 ("reserved for native service backends"), which the research did not know (its block was 41000). The avoided block is 10000-32767, not the design's 20000-32767. A departure the design owes a note.
- FOUND: a project with no migrations has no ledger at all, so "no ledger: reset" (rule 2 read literally) would reset every start, and one writing its first migration would lose its rows. The rule is now: migrations exist, no ledger, AND no table in public.

## Layout
- `layers/supabase.ts`; `layers/postgres.ts` drops the server when supabase is active (`devcontainer(tree, active)`, a new optional second argument, because the composer runs before the generators).
- `generators/postgres/provider.ts`, `files/provider.mjs.tpl`, `files/native.mjs.tpl`: the port. `postgres.mjs` keeps the verbs and the deploy's gates.
- `generators/supabase/`: `generator.ts`, `dev-fragment.ts`, `dev-merge.ts`, `toml-lines.ts` (pure, the probe loads it), `ci-provider.ts`, `seed/` (real `init` + first-start output; the tripwire compares), `files/supabase-{cli,keeper,provider,reset}.mjs.tpl`.
- `engine/house-probe.mts`: `supabase-major-mismatch`, `supabase-config-outdated`, `supabase-migrations-twice`.
- `dev` engine: `avoidPorts`.
- Tests: `tools/test-supabase/run.mjs`, `tools/test-scaffold/supabase-launcher.*`, `tools/test-generators/cases/supabase.mjs`, a `tools/test-layers` case, dev-engine checks.

## Departures from the design, and why
1. Blocks stay out of 10000-32767, not 20000-32767: the native runtime refuses a public port in 10000-19999. Observed.
2. Identity on Supabase is `data_directory` inside this stack's directory plus the CLI answering on the stack's port, not `system_identifier`: every `db reset`, a hand's included, changes the identifier.
3. Rule 2 narrowed: reset only with migrations present, no ledger AND no table in public. No ledger alone is normal for a project with no migrations.
4. One stack per tree, the CLI's model, against decision 2's "keyed by tree and stack": a second dev stack in a tree is refused.
5. Data of a gone tree is named by a start, never removed: a `supabase stack destroy` is not reversible the way the native sweep's set-aside is.
6. "Polls the owner": the keeper polls the Supabase owner by `owner.json` + its process name, not by `dev ps --json`, which has no view of it. `dev ps --json` answers the other question (another live claim in this tree), and the engine's own liveness is fd 3.
7. `postgres:psql`/`seed` need a client: Debian's `postgresql-client` stays, floating by name like Debian's libraries. The CLI has no interactive client, and its own psql sits at an internal hashed path.
8. MCP: no `.mcp.json`. The URL moves with the block and one committed file cannot name each tree's. A start prints `claude mcp add --scope local`; docs give the hosted `read_only` form. Official plugin not enabled (its MCP is hosted, unscoped, writes).
9. Not built, per PLAN Landing 3 but named in ARCHITECTURE's shape: types, secrets, functions targets. `deploy` ships migrations only.

## Decision: the folder move is a generator step of the ensure run, not a migration
A migration carries every project across a version unasked; this happens because one project chose the layer, and a project that never does keeps postgres/migrations. No shape an existing project has changes by this work: **nothing to migrate** (`avoidPorts` optional; native provider's owned launcher regenerates; the targets unchanged on native).

## Accepted gap, as designed
`kill -9` of the keeper: the stack runs on, `dev ps` no longer shows it; proved real; the next start adopts it, on the same block or moved to another; proved real.

## Unproven
Needs a rebuild: the installer as root in a real image, SUPABASE_HOME on the real volume, `postgresql-client` and `procps` from the image. Needs arm64 or a non-Linux host: the arm64 sha256 is the release's checksums.txt, not checked against a download. Needs a real account: login, link, `db push --remote` to hosted, the session pooler from an IPv4 runner, `migration repair` on a dbmate-tracked host, the deploy workflow on real GitHub. Real wedge states come by timing: the tripwire proves that `postgres:reset` recovers from what a stop mid-reset left, whichever state that was; the named WEDGED strings are matched against fakes.

## Owed by wire/docs
README row and layer list, CLAUDE.md engine section (layer list, the port), `new` skill, a skill if wanted, tips, `.github` workflow for the tripwire and image job, dogfood-consumer road, `tools/check-runner-image` case; `tools/test-supabase` row in CLAUDE.md; `upstream-tables` check for the CLI release.

## To weigh
With 10000-32767 out, every block but 2000-4000 is above 32767, so inside Linux's ephemeral range. `auto` probes every port and a clash is loud ("Cannot bind"), seen once with a hand-picked offset, so nothing is silent; a stack can still lose a port to an outgoing connection between probe and start, and the next start picks again.
