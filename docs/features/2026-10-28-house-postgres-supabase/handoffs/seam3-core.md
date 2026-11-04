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
