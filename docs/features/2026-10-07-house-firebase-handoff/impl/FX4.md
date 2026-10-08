# FX4 — the serve/stack split's regressions from DF2b: NB1, NB2, NB3, the refusal's 130, D6 under `>`, the leftover run dir

Branch `feat/house-firebase-handoff--fx4`, worktree `hfh-fx4`. Commits `03b013b` and `8e45613`. Fixture: a private copy of
DF2b's upgraded consumer (`scratchpad/fx4/coach`), brought onto this payload with `house.sh upgrade --local --yes .`.
Each upgrade's whole diff was the owned files changed here, plus the `--local` lockfile.

## The mechanism, read in Nx 23.3 (`task-orchestrator.js`, `run-command.js`)

- `handleContinuousTaskExit`: a continuous task that ends while an incomplete task depends on it is read as follows.
  - Code 0 means **crashed** ("continuous but exited with code 0").
  - 129/130/131/143 means **interrupted**, which becomes `stopped` and "Stopped before finishing".
  - Only once nothing depends on it, or when Nx itself kills it in `cleanUpUnneededContinuousTasks` (`stoppingReason:
    'fulfilled'`), is it a **success**, whatever its code.
- `didCommandComplete`: if any `stopped` result, or any discrete task with **no result**, the run exits **130**.
  - A skipped task gets no result, because `completeTasks` never reports skips to `endTasks`.
  - So a failed preflight (which skips `serve`) always gave 130.
- `SharedRunningTask`, the attached run: it polls the owner's running-task record, and its exit is **always 0**. The owner
  removes that record when its dev-stack completes.
- `summary` renderer with `> file`: Nx's file description is not O_APPEND. Our appended bytes sit past Nx's offset, and
  its summary is written over them.

## Fixes

- **NB1:** dev-stack no longer exits 143. When the stack ends cleanly and a task of this run depends on it
  (`dependedOnHere(context.taskGraph)`), dev-stack stays until Nx releases it. The follower reads the exit record and
  succeeds, then Nx stops dev-stack as "fulfilled". A stack that fails still exits 1 at once (D3).
  - If the engine left no exit record, dev-stack writes a fallback `{code:0}`, so the follower cannot hang.
- **NB2:** the attached follower registers itself in `.bespunky/run/followers/<inv>@<app>.json`.
  - The stack's own follower, and dev-stack when nothing in its run follows it, wait (bounded at 10 s) until those
    invocations have exited. Only then can the owner's Nx drop the shared task.
  - First try: only dev-stack waited. The owner's Nx still exited first, and the attached run read a crash. Fixed in
    `8e45613`.
  - `dev stop` leaves `stop-request.json` in the state dir. The engine records `stoppedBy` (the request, else the
    signal) in the exit record.
  - The attached run prints: `[serve] web@X — the stack this run was following (owner …) — was stopped by …, with
    tools/dev/dev stop; it ended cleanly, so this run did too.`
- **NB3:** the attach notice offers `--port-offset=auto`.
- **Refusal exits 1:** serve-preflight never fails now. It writes the refusal as this invocation's exit record and clears
  any stale record left under a reused PID.
  - The follower prints the refusal and fails the run.
  - If dev-stack does start (it was not shared), it starts nothing and waits.
- **D6:** when the invoker's stderr is a regular file without O_APPEND, `tellInvoker` queues the messages. One detached
  helper holds the file open and appends them, in order, after the invoking nx exits.
  - In 3 of 3 tight `nx … > log; grep` reads, the text was already there.
- **Run dir:** the keeper waits (bounded) for its whole process group to finish. It then prunes its own stack through the
  engine's `readStacks`, so it never removes a live stack or one that restarted on the same key.
  - `unfinished` now treats an `exited` entry as done.
- **Misleading "Stopped before finishing":** the outer summary is now `3 tasks: 3 succeeded`.
  - The stack's inner `nx run` parts still print their own "Stopped before finishing". Changing that would mean a
    migration of the seeded `dev.json`.
  - Instead the engine now announces `stopping the stack (asked by …) — each process reports its own stop below … not a
    failure` and ends with `web@X stopped cleanly (asked by …)`.

## Proven on the fixture, before and after

| Item | Before | After |
| --- | --- | --- |
| NB1 `dev stop` | EXIT 130, "Stopped before finishing: web:dev-stack" | EXIT 0, `3 tasks: 3 succeeded`, in 5 of 5 runs |
| NB2 attached | `continuous but exited with code 0`, 1 failed | EXIT 0, `3 succeeded`, with the "was stopped by" line (2 of 2) |
| NB3 | `--port-offset=<running offset>` | `--port-offset=auto` |
| Refusal | EXIT 130; `> file` kept the last 3 lines | EXIT 1 through `> file` and through a pipe; full text after the summary |
| D3 no Java | — | EXIT 1, `1 succeeded, 2 failed`, Java named |
| Slow Ctrl+C (suite SIGSTOPped 10 s) | record and `web@<off>/` left behind | both gone once the keeper finished; data exported; EXIT 130 |

- `node_modules` contained no `enableCompileCache` in firebase-tools. `npm` (Node 22's bundled npm) does write
  `$TMPDIR/node-compile-cache`.
  - That fits DF2b's leftover: a straggler wrote into the stack's TMPDIR after the dir was pruned. The group wait closes
    this.

## Tests

- test-generators: 177 ok, 23 skipped.
  - `stack-identity` gained cases for NB3, the refusal and attached verdicts, `dependedOnHere`, and `eatenByInvoker`.
- test-migrations: 220 ok.
- test-layers: 100 ok.
- test-scaffold: 22 files ok.
  - `emulators-stop` gained two cases: prune when the serve is gone (fails on the old template), and spare a live one.
  - `dev-engine` checks that the exit record carries `stoppedBy`.

## For the orchestrator

- Nothing to migrate: every change is in an owned artifact or the executor.
- Nothing left open from this round (both former leftovers are closed below).

## Follow-up: the two leftovers, closed (same branch)

- **Direct `nx run firebase:emulators` keeps no run dir.** Run without the engine, the state dir
  (`.bespunky/run/firebase@<off>/`) has no run record, so each `emulators.sh` CLAIMS it (`claims/<pid>`). The last one
  out removes it, holding a `flock` on `.bespunky/run` (which is never removed). That is the script's EXIT trap, or the
  keeper when the script was killed first.
  - It never removes the dir while the suite is still running (keeper alive and its entry not `exited`).
  - It never removes the dir while another live script claims it. A start waiting on the previous suite's save is
    inside it.
  - A waiting start re-claims and re-creates its dirs after the wait.
  - Without `flock(1)` it does nothing, as before.
  - Fixture, `PORT_OFFSET=<n> nx run firebase:emulators` + Ctrl+C: **before**, `detached/` and `tmp/` were left;
    **after**, the dir is gone and the data was exported.
- **The emulators' stop line under `> file`.** `say_to_invoker` uses the same postscript as the executors: the same
  queue file and lock in the invoker's own TMPDIR, so one waiter prints both kinds of message in order. It applies
  because the waiter is detached (`set -m`, reparented), so it outlives Nx's tree kill.
  - Fixture, `nx serve > log 2>&1` + `dev stop`: **before**, the line was gone entirely (Nx's summary wrote over it);
    **after**, it follows the summary.
  - On the Ctrl+C path the line already survived before, because Nx prints nothing after a SIGINT.
- Tests (`emulators-stop`):
  - the dir is released after a supervisor SIGKILL and after a Ctrl+C;
  - the dir is kept for a waiting restart;
  - nothing is appended while a `>` invoker lives, and the line follows its exit.
  - Three of these checks fail on the previous template.
- Suites: 177 / 220 / 100 / 22 files, all ok.
