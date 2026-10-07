# FX1 — the consumer dogfood's bugs: B1 (seed:build), B2 (stop loses data), D3 (serve "succeeds"), D6 (hidden refusal)

Fix round after `DOGFOOD-CONSUMER.md`. Branch `feat/house-firebase-handoff--fx1`, worktree `hfh-fx1`. Written as it
happens. Fixture: a private copy of DF2's upgraded consumer (`scratchpad/fx1/coach`, Nx 23.3.0, firebase-tools
15.32.1, DF2's scratch JRE on PATH for my processes only).

## B1 — `nx run firebase:seed:build` always fails

**Reproduced before the fix:** exit 1 in 89 ms; `FORCE_COLOR=true node tools/emulator-ports.mjs ports firebase.json | od -c`
shows `033 [ 3 3 m 9 0 9 9 033 [ 3 9 m`.

**Root cause.** `console.log(<number>)` formats through `util.inspect`, which colours under `FORCE_COLOR` — and Nx's
run-commands sets it for every task. `emulator-ports.mjs` printed its two machine outputs (`ports`, `free-offset`) that
way; `build-seeds.sh` fed the coloured offset to `shift` ("usage: …"), and `reap-emulators.sh`'s `mapfile` of `ports`
matched no port (silently).

**Fix.** Machine output is written as strings (`emit()` → `process.stdout.write`). Swept every generator template
for the same pattern: the only other bare-value prints were `shared-browser/runtime.mjs`'s path outputs (strings,
so harmless, but changed to the same rule). New `tools/test-scaffold/machine-output.test.sh`: runs `ports` and
`free-offset → shift` exactly as `build-seeds.sh` does, under `FORCE_COLOR=1`, plus a static guard over every template
(`console.log(<identifier|call>)`; SCREAMING_CASE string constants allowed). Proven to fail on the old template.

## B2 — a stop loses the emulator data

**Reproduced before the fix** (`scratchpad/fx1/b2.sh`): `nx serve web --port-offset=26037`, an Auth signUp through
the emulator, `tools/dev/dev stop web --offset=26037` → "stopped — ports free" after **1 s**; `.emulator-data-26037`
held only the primed seed, not the user. The emulator task's Nx log:
`Firestore Emulator has exited with code: 143, stopping all running emulators` — no export.

**The mechanism (read in `node_modules/nx`, measured).** Nx stops a task with `killProcessTreeGraceful(pid, SIGTERM)`
(native): "signals LEAF processes first, waits for them to exit, then signals their parents … then force-kills
survivors". The grace is `NX_PROCESS_KILL_GRACE_PERIOD`; measured here: a TERM-trapping task was SIGKILLed **~5 s**
after nx got SIGTERM. The leaves of `bash tools/emulators.sh` (exec'd into firebase-tools) are the emulator JVMs: they
get SIGTERM first, exit 143, firebase-tools calls that fatal and stops everything without exporting — and anything
still alive at 5 s is SIGKILLed. Run-commands children are spawned detached (own session), so a terminal Ctrl+C never
reaches them: the stop is always Nx's tree kill. Same code in Nx 23.1.0 (this repo's), so W3's premise ("SIGTERM to
the nx child — it stops its own tree gracefully") never held; 0.49.2 projects run the suite through the same Nx path,
so they lose data the same way (not re-run on a 0.49.2 fixture: the mechanism is in Nx, not in what 0.50.0 changed).
Restoring `continuous` did nothing (DF2) because it is not the cause. `dev stop` then reported "ports free" because
the force-kill had already freed them.

**Fix — the suite runs OUTSIDE every supervisor's tree, and its one stop is delivered by the only thing that should.**
- `emulators.sh` starts firebase-tools under a **keeper**: its own code, detached with `set -m` (own process group:
  no terminal signal) and reparented away (no tree walk finds it). The keeper is the only thing that ever signals
  firebase-tools, exactly once: when the script asks (any TERM/INT/HUP to it), or when it finds the script gone (a
  supervisor's SIGKILL, a closed terminal). Whatever stops the stack, the export completes.
- The script streams the suite's log (now a file, `.bespunky/run/logs/<stack>.emulators.log`, outside the state dir so
  it outlives a crash), and on a stop prints `stopping — exporting emulator data to … (about half a minute)`, progress
  every 5 s, `done in Ns — exported to …`. The wait is bounded (`EMULATORS_STOP_TIMEOUT`, 120 s) and says what
  continues if exceeded. The keeper verifies the export was written after the stop; if not: `NO EXPORT was written …
  its log: …`, non-zero. A suite that dies on its own: `CRASHED — … its log: …`, non-zero.
- A restart of the same stack while the previous suite is still saving waits for it (instead of the reaper refusing
  its live ports or a second suite importing a half-written export); a genuinely running duplicate is refused.
- **Dev engine: detached work.** The keeper registers in `<state dir>/detached/emulators.json`. A generic engine
  concept (stack-free — any process may register): `serve` waits for it after its processes stop (bounded,
  `DEV_STOP_TIMEOUT`, 180 s), reports its result, and keeps the record + state dir while it runs (state `finishing`
  in `dev ps`, never pruned). `dev stop` waits with progress lines, and on a finishing stack signals nothing.
- Under `nx serve` + Ctrl+C the outer Nx still SIGKILLs the engine after its ~5 s grace; the export then finishes in
  the background — announced by the script, shown by `dev ps`, waited for by the next start. Not lost.

Tests: `tools/test-scaffold/emulators-stop.test.sh` (fake firebase-tools whose "JVM" records any signal that reaches
it before the export; Nx's leaf-first kill + SIGKILL after 1 s, group Ctrl+C, plain kill, SIGKILL of the script,
restart mid-save, crash) — fails 5 checks on the old template. `dev-engine.checks.mjs` gained the detached-work cases.

**Observed after the fix, on the fixture, through the real install path** (`house.sh upgrade --local --yes .` →
the whole diff was exactly the owned files changed here; a second upgrade: empty diff):
- `nx serve` + an Auth signUp + `dev stop` → user in `.emulator-data-42037/auth_export/accounts.json`.
- `nx serve` + SIGINT to its process group (Ctrl+C) → exported. `tools/dev/dev serve` + Ctrl+C → exported, and the
  serve said `[serve] emulators: exported to …`.
- **Past Nx's 5 s grace with the real firebase-tools:** the suite's process group SIGSTOPped for 12 s right after
  the stop was asked for → `dev stop` printed `…emulators: exporting emulator data to … (5s)`, `(10s)`, returned after
  13 s with ports free; the user was in the export; the serve reported `exported to`.
- 20 000 Firestore docs + 400 × 2 MB Storage objects → `dev stop` → full 842 MB export (export is fast on this disk;
  DF2's 26 s was not reproducible, hence the SIGSTOP run above for the slow path).

## D3 — `nx serve` exits 0 / "succeeded" when the stack died

**Root cause, in Nx (23.1 and 23.3 alike):** `task-orchestrator.handleContinuousTaskExit` — a continuous task that
exits while no incomplete task depends on it is completed as `'fulfilled'` → status `success`, whatever its exit code.
`nx serve <app>` makes the continuous `serve` the initiating task, so nothing ever depends on it: an engine exit of 1
can never become a failed Nx run. No option, env or executor result changes that (checked: `completeContinuousTask`,
`runCommand`'s exit code = failure|skipped only).

**Done here (the engine's half):** `runStack` reports which child failed; the serve prints, on stderr, a block that
every output mode shows (the continuous serve's stream is the one channel Nx's agent `summary` renderer does not
swallow): `✖ the stack FAILED and was stopped: emulators exited with code 1 — it ran: …`, the detached work's log
path and its last lines, and a note that Nx will still list `serve` as succeeded. Observed (no Java):
`| Error: Could not spawn \`java -version\`. Please make sure Java is installed …` now reaches an agent's `nx serve`.
The engine itself exits 1 (direct `tools/dev/dev serve` is correct).

**Not done — needs a design decision (a project-state change, so a migration):** the only way Nx itself fails the run
is for an INCOMPLETE task to depend on the continuous one (then it is `'crashed'` → failure → exit 1). Proposal:
`nx serve <app>` runs a non-continuous watcher target that `dependsOn` the continuous stack composer (renamed, e.g.
`<app>:stack`) and waits on the stack's run record; the composer keeps streaming (continuous) and stays the thing e2e
targets depend on and Nx shares. Cost: a 0.50.0 rung renaming the composer and retargeting `dependsOn`, preflight
rewiring, docs. Making `serve` simply non-continuous is worse: the agent renderer then shows nothing while it runs.

## D6 — the preflight's refusal is hidden from an agent

**Reproduced:** agent shell (Claude Code env), non-TTY: only `✖ nx run web:serve-preflight` + `full log: …`. The same
command with the agent variables unset (CI-like non-TTY): the refusal printed in full. So the hider is Nx's `summary`
renderer — its default for an AI agent without a terminal, which addresses a failed task's log instead of printing it.

**Fix:** the preflight also writes its verdict to the invoking nx process's stderr — `NX_INVOCATION_ROOT_PID`, which
Nx hands every task — exactly when Nx will hide it (summary named via `--output-style`/`NX_DEFAULT_OUTPUT_STYLE`, or
unnamed with Nx's own `isAiAgent()` and no terminal). No duplicate where Nx prints it, no write into a TUI, append-only
open (a redirected stderr file is never truncated), Linux /proc, best effort. **Observed after:** the agent run prints
`[serve] REFUSED — web is already served … Start the stack you asked for beside it: tools/dev/dev serve web
--port-offset=35047 …` above Nx's summary; the non-agent run prints it once. Pure decision tested in
`test-generators` (`stack-identity`).

## Release notes for the orchestrator

- **Migrations: nothing to migrate** — deliberately: every file changed is an owned template artifact regenerated by
  every upgrade (`tools/emulators.sh`, `tools/emulator-ports.mjs`, `tools/dev/**`, `tools/shared-browser/runtime.mjs`,
  `HOUSE.md`) or the payload's executor; the new `.bespunky/run/logs/` and `<state dir>/detached/` live under the
  self-ignoring `.bespunky/run/`.
- Bumps owed (not done here, by instruction): `@bespunky/nx-tools` (payload), `bespunky-workflow`
  (`local-server-isolation/SKILL.md`). `check-release-invariants` reports them.
- Tests: test-generators 164 ok / 22 skip; test-migrations 206 ok; test-layers 100 ok; test-scaffold 22 files ok
  (new: `machine-output`, `emulators-stop`; `dev-engine` gained the detached-work cases).

## Left open
- D3's Nx exit code (above) — awaits the design decision.
- Ctrl+C on `nx serve`: the outer Nx returns ~5 s later (its own grace, `NX_PROCESS_KILL_GRACE_PERIOD`) and, on SIGINT
  without a TUI, mutes its own output — so `done` is not seen there; the save completes regardless (`dev ps` shows
  FINISHING, the next serve waits). Raising the grace would need a project `.env` entry — not done.
- In agent mode the inner `nx run firebase:emulators` / `web:dev-server` output is summarised away inside `nx serve`
  (pre-existing; the engine now reports the export result and failures itself).
- D9 confirmed in the seed build (`UI websocket is running on 9150` in a shifted suite) — not in this round's scope.
