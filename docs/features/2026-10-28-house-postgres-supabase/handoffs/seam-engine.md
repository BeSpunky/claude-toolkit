# seam-engine: what was built (branch feat/hps-engine)

**Declaration (`.bespunky/dev.json`).** `dev.mjs` and `lib/declaration.mjs` are the authority; `generators/dev/declaration.ts` is the type copy.

| Field | Meaning | Refused when |
|---|---|---|
| `dependency: true` | Starts first, in declaration order, each behind the one before it. Nothing else starts until the last is ready | Not a boolean; also `primary`; the app has no other process with a port |
| `ready.http` | `<path>`: the process's first port answers, any status | Dependency with no port |
| `ready.tcp` | `<port name>`: that port accepts a connection on localhost | Not one of this process's own ports |
| `ready.cmd` | `<shell>`: exits 0, in the process's env, substitutes like `cmd` | Empty |
| `ready.timeout` | Seconds, default 120 | Not on a dependency; not positive; `ready` with zero, two or unknown keys is refused too |
| `exports` on a dependency | Reach every sibling's env, and `dev with` as before | Two dependencies export one name; the name is one the engine sets (`PORT_*`, `DEV_STACK_*`, …) |

A process's own `env` beats an export. A `--skip`ped dependency exports nothing, so a sibling sees whatever its environment holds.

**Verbs.** `dev run <app> --ports=<name=port,…> [--label=] [--port-offset=] [--shifted] [--owner=] -- <command…>`, and `dev claim … --label=`.

**Engine.** New `lib/ready.mjs` holds the one probe, used by the dependency wait, `serve`'s `Up:` and `dev with`. `readyUrl` on the plan and record became `ready` (a resolved probe), plus `readyEnv` for a `cmd`. The record gains `waitingFor`; `ps` shows `STARTING — waiting for db`. The `Up:` probe and the shared browser now begin after every process has started, through `runStack`'s new `onUp`, so the browser never lands on a stack still waiting.

**Generator.** The gate asks `LAYERS` which layers list the `dev` step, and refuses only if none is present, naming them. With nothing served, the engine is written, nothing is seeded, and one line says so. `.bespunky/dev.json` is not created, because it is `web`'s evidence.

## What a launcher should know

- **`dev run`'s claimer is the engine, not the script.** A launcher re-executes itself under it, as `emulators.sh` does, and from then on has one contract whether a serve or `dev run` started it: `DEV_STACK_DIR`, `DEV_STACK_TMP`, `DEV_STACK_LOCK`, `PORT_OFFSET`, `PORT_<NAME>`, fd 3. `DEV_RUN=<name>` is set only under `dev run`.
- **Fd 3 and what you start.** A shell script that holds the lock through its own descriptor should close fd 3, as `emulators.sh` now does. Otherwise a keeper that lets go still holds it.
- **A probe is not a stack member:** it holds no lock, runs in its own process group, and is killed when the wait ends.
- **Dependents and dependencies stop together.** A stop signals all at once; there is no reverse order. Each process gets one signal, as before. A server with a client open must handle that itself (`ARCHITECTURE.md` 6a).
- **`tcp` turns true when the port binds.** A launcher that migrates and seeds wants `cmd` on a marker in `${STACK_DIR}`, written last.

## Decisions to check

1. **`dev run` is a wrapper process, not a sourced shell function.** The next launcher is Node, per `ARCHITECTURE.md` 6a, so a bash helper could not serve it. Cost: a direct run has one more process, and its claimer is the engine.
2. **`seed-build-seeds.sh.tpl` moved to `dev run` too.** The brief named only `emulators.sh`, but "one copy" was false while the seed build kept its own.
3. **`dev claim` now has no generated caller.** Asked for by the brief, so it stays, with `--label`, and the engine's lock and stale-release tests still use it. It can go in a later release if nothing needs it; `dev release` is still used by the keeper.
4. **A dependency's exit of 0 after ready fails the stack.** A self-shutdown after a worktree removal read as "stopped cleanly" in the spike.
5. **`ready` refuses unknown keys**, so a mistyped `timeout` cannot silently mean 120 s. This is stricter than the file's general rule that unknown keys are ignored, and is the only place an old declaration could newly fail. No toolkit path writes one.
6. **The fd 3 fix changes a real-serve outcome.** The keeper as last one out now removes the record itself. Before, a dead record waited for the next `ps` or claim to prune it.

## Migration finding

**Nothing to migrate.** `tools/dev/**`, `tools/emulators.sh`, `tools/seed/build-seeds.sh` and `HOUSE.md` are owned and regenerated. `.bespunky/dev.json` is unchanged and every new field is opt-in. The engine still accepts an old `tools/emulators.sh` because `claim` stayed. A stack left running across an upgrade has a record with `readyUrl`, which `dev with` no longer reads, so `dev with` against it waits out its timeout; restarting the stack clears it. No fallback was added, per the backwards-compat rule.

## Evidence

- `tools/test-scaffold/dev-engine.checks.mjs`: real-process cases for each readiness kind, ready-before-siblings, exports received, exit 0 and non-zero before ready, never ready, hung probe, exit after ready, two dependencies, `--skip`, stop and Ctrl+C during the wait, SIGKILL orphans during the wait and when up, `dev with`, `dev run`.
- Mutation checks: dropping the rule that a dependency's exit is a failure, and removing the post-wait guard, each turn the suite red.
- `tools/test-generators/cases/dev-gate.mjs`: a real layer given a `dev` step and a `devFragment` for the length of a case.
- By hand with real firebase-tools 15.32.1 and a real Firestore JVM: a direct run with `dev stop` exported a signed-up user; a second direct run imported it and took a Ctrl+C with exit 0; a `dev serve` with its session SIGKILLed left the keeper to save and remove the record, with no process left.

## Not verified

- A real `nx serve` or `nx run firebase:emulators` above the wrapper: Nx's kill sequence is simulated by `emulators-stop.test.sh`.
- `dogfood-consumer` and `house.sh upgrade --local`: the landing gate.
- A real launcher: the dependency cases use a fixture process.
- `CLAUDE.md` still describes `dev claim`-era wording in its dev-loop paragraph only by implication. It is the docs unit's, so it was left alone.
