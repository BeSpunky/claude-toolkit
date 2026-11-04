# Worked example — Postgres

> Applies to projects wearing the `postgres` layer (their `HOUSE.md` stamp lists it in `layers=`). The generic fixed-port-backend rules live in the SKILL; this is them applied to Postgres.

In a house project a Postgres server is part of a dev stack: it binds that stack's block (`5432` plus the offset), on loopback only.

- **Never shift it by hand.** A serve (`tools/dev/dev serve <app>`) claims a block for every declared port, the server included, and hands its siblings `DATABASE_URL` and `DIRECT_DATABASE_URL` at that port. With nothing served, `node tools/postgres/postgres.mjs start` is a stack of its own; under an agent it never takes the base port, and `--port-offset=0` is refused.
- **Never start a server of your own with `postgres -p` or `pg_ctl`.** A local verb compares the server's `system_identifier` with the one recorded when its stack created it, so it refuses a server the launcher did not create.
- **A verb means this tree's running server, and it does not ask whose.** `postgres:migrate`, `seed`, `reset` and `psql` take no URL: with one stack running in the tree they act on it, so a `reset` would drop the user's data if that stack is theirs. Look first with `tools/dev/dev ps`, and if yours is not the only one, pass `--offset=<yours>`. With several running, the verbs require it and list them.
- **Another block is another database.** Data is kept by tree, stack and offset, so a new block starts empty, then is migrated and seeded. To test against the user's rows, ask them; never borrow their stack by stopping it.
- **Stop it by the handle it prints**, `tools/dev/dev stop <app> --offset=<n>` (`postgres` for a stack of its own). An open client does not hang it: a smart shutdown turns fast after 2 s. A launcher killed outright leaves an orphan that `tools/dev/dev ps` shows and `tools/dev/dev stop` clears. Exit 1 from the stop means the stack is down and its ports are free, but something shut down uncleanly.
- **`postgres:deploy` is not a local verb.** It reaches a real database, and it refuses to run under Claude Code, with `CI` set or not. Hand it to the user.
- **Under an agent, run the launcher itself** (`node tools/postgres/postgres.mjs <verb>`), not the Nx target: current Nx shows an agent nothing of a task until it ends, so `postgres:start` would give no port or handle, and it refuses.
