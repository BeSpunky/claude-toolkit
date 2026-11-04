# seam2-engine: what was paid (branch feat/hps2-engine)

## E1: a failed shutdown is reported
Reproduced first: a dependent exiting 3 on the stop printed "stopped cleanly", `dev stop` exited 0, the serve 0.

A process told to stop has shut down cleanly when it ends on 0, on SIGTERM/SIGINT/SIGHUP, or on 128 + one of them. Anything else lands in `runStack`'s new `unclean` list (`{ id, code, signal }`), whichever road brought the stack down. `success` does not change: the stack did not fail, its stop did.

- The serve names it, skips "stopped cleanly", and exits 1 (the precedent: detached work that did not finish).
- `dev stop` cannot see exit statuses, so the claimer leaves `<run>/<key>.stop-report`, only when a stop request exists and something went wrong. The stop takes it, prints it, and exits 1 with "stopped and its ports are free, but not cleanly".
- `dev run` does the same, and still exits with the command's status.
- An orphaned stack has no claimer to ask, so its stop cannot report this. Stated, not solved.

Observed on real Nx (`nx run` of a continuous `nx:run-commands` target): `dev stop` exit 0, serve exit 0, Ctrl+C exit 130, "stopped cleanly" each time. Nx exits 128 + signal.

**Launcher consequence:** on a stop, exit 0 (or die on the signal). `exit 1` after a stop reads as a failed shutdown.

**Test changed on purpose:** the `dev run` case whose launcher exits 5 on SIGTERM used to expect `dev stop` 0.

## F5: a bare directory in `watches`
`deployTarget` is now `deployTarget(tree, projectRoot, spec)` and throws naming the glob. Syntax alone cannot tell `db/migrations` from `Dockerfile`, hence the Tree.

Refused: an existing directory, a trailing slash, `.`, and a missing path with no extension (a directory not seeded yet, or a file its name cannot vouch for; the message names both fixes). Passes: a glob, an existing file with or without an extension, a missing path with an extension.

**Every new caller passes `tree` first.** The postgres generator on feat/hps2-core needs this if it calls the old signature.

## E6 support: `dev ps --json`
Was the raw record. Two gaps: a `dev run` stack had no `exports`, and nothing marked the output as a contract. Now `publicStack` in `lib/stacks.mjs`, documented there, exact keys tested. No `--export` flag. A JSON array:

```
{ key, app, tree, treeLabel, offset, state, pid, owner, host, startedAt,
  ports: { name: port }, portStates: [{ name, port, listening }],
  exports: { NAME: "value" }, tmp,
  processes: [{ id, pid }], detached: [{ id, pid, status, doing?, log? }],
  label?, task?, url?, waitingFor? }
```

- `tree`: as git spells it. Compare by real path.
- `state`: `live | finishing | orphaned | foreign`. Filter it: an orphaned stack still appears.
- `exports` of a serve: `BASE_URL, DEV_URL, DEV_URL_QUERY?, PORT_OFFSET, PORT_<NAME>`, what the declaration exports, `DEV_STACK`.
- `exports` of a `dev run`: only `PORT_OFFSET, PORT_<NAME>, DEV_STACK`. It has no declaration, so **a declared `DATABASE_URL` appears only for a serve. A launcher addressing either must build its URL from `ports`.**
- `{}` in the moment between a serve's claim and its plan.

Exposure narrowed, not widened: `lock, machine, procStart, version, ready, readyEnv` are gone from the output (they stay in the record). The one generated reader, `emulator-data.sh`, uses `app, tree, offset, key, processes[].id`, all kept. A project's hand-written script reading a dropped key would break.

## 6a stop rules: tested, engine unchanged
Fake dependency: a launcher that stays the parent of a server with a 2.5 s shutdown.

- The engine waited out the bound on `dev stop`, on SIGTERM to the serve and on Ctrl+C. The engine has no kill on a stop road; `dev stop` gives up waiting after 240 s without killing, and only `--abandon` kills (detached work).
- Launcher killed outright, under a serve and under `dev run`: the server holding fd 3 keeps the stack `orphaned`, `dev ps` shows the port, `dev stop` delivers one SIGTERM, honours the bound, frees the port.
- Without fd 3: `dev ps` is empty while the port listens. A test states this, as the reason 6a requires the fd.
- Node launcher spelling: `spawn(cmd, args, { stdio: [..., ..., ..., 3] })`.

## Migrations
Nothing to migrate. Every engine change is an owned template regenerated on upgrade. `deployTarget` is internal to generators, and the shipped Firebase `watches` are all files, so no project's inputs change.

## For the docs unit
HOUSE.md and CLAUDE.md do not mention `ps --json` as public, or that `dev stop` now exits 1 on a failed shutdown. Outside this unit's boundary.
