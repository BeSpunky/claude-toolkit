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

**Decided by the orchestrator (2026-10-07): "build it"** — the design proposed above. Done:
- `dev-stack` is the composer, unchanged (@bespunky/nx-tools:serve, continuous, depends on serve-preflight, mirrors
  the leaf) — the running stack Nx shares, what an e2e target depends on.
- `serve` is `@bespunky/nx-tools:follow-stack`: NOT continuous, depends on `dev-stack` (flags forwarded), mirrors its
  configuration names. While it runs, a dying stack is a crashed dependency (the run fails). It ends with the stack's
  own status, from the engine's EXIT RECORD (`<nx root>/.bespunky/run/exits/<invocation>@<app>.json`, written on
  every end incl. refusals and dry runs; found by NX_INVOCATION_ROOT_PID; records of dead invocations pruned). An
  attached run (Nx shared another invocation's `dev-stack`) follows that stack.
- The composer ends a CLEAN stop as 143 (one of Nx's intended-stop codes): exit 0 from a continuous dependency whose
  dependent still runs is read as a crash, so a `dev stop` would have failed the run.
- Item 3: the composer's stream already prints the full FAILED block in every mode (agent summary included —
  observed), so the follower relays a one-line headline to the invoker (shared `executors/_utils/invoker.ts`, the
  preflight's channel): `[serve] web's dev stack FAILED (exit 1): emulators exited with code 1; emulators: Error:
  Could not spawn \`java -version\` … (log …)` — printed right above Nx's summary.
- Migration `0.50.0/split-serve-follower` (last 0.50.0 rung): splits every house composer; retargets every
  unambiguous reference to a split project's `serve` — `dependsOn` in every project.json (`serve`, `<p>:serve`,
  `{ target: 'serve' }` with no/own/split projects) and option values (`devServerTarget: "web:serve[:cfg]"`); reports
  `^serve`, pattern/mixed `projects`, nx.json targetDefaults, and a project's own `dev-stack` (not split). Four
  fixture cases (stock; own e2e with object/string/devServerTarget forms; the reported ones; the collision).
- Swept: HOUSE.md (depend on `dev-stack`, never `serve`), the new skill, local-server-isolation, executor/schema
  docs, comments. The preflight now speaks of `<app>:dev-stack`.

**Observed, real install path.** A clone of DF2's fixture at its 0.49.2 commit plus a project-written `web-e2e:e2e`
with `dependsOn: [{ projects: ['web'], target: 'serve' }]` → `house.sh upgrade --local`: the rung ran as migration
17/17, logged `web-e2e:e2e: dependsOn { target: "serve", projects: ["web"] } → "dev-stack"`; `nx show project
web-e2e` confirms; a second upgrade left project.json unchanged. Then: no Java → `nx serve` **exit 1** (`3 tasks: 1
succeeded, 2 failed`), the headline above Nx's summary; with Java + `dev stop` → **exit 0**, data exported, `3 tasks:
3 succeeded`; Ctrl+C → **exit 130**, data exported, and the only line printed after Nx muted itself:
`[emulators] saving emulator data in the background — \`tools/dev/dev ps\` shows it FINISHING`.

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

## D9 — the Firestore websocket stayed on 9150 in shifted suites

**Root cause:** `suite-ports.json` declared nested ports "occupied and shifted only when declared (undeclared,
firebase-tools lets them float)". False: undeclared, firebase-tools opens its default 9150. W3's shift therefore moved
`websocketPort` only when firebase.json named it, which the house block never does — and the generator kept a second
copy of 9150 of its own. **Fix, in the one table:** each nested port carries its default
(`{ "as": "firestore-websocket", "default": 9150 }`); `suitePorts`/`shiftConfig` list and pin it shifted whether or not
declared; the generator reads the same default (its constant is gone). Observed: a stack at offset 24067 →
`Firestore Emulator UI websocket is running on 33217`. (Eventarc/Cloud Tasks, started implicitly with functions, do
float — "unable to start on port 9299, starting on 9300" — so they are left floating.)

## Ctrl+C (item 4)

On a stop, `emulators.sh` writes one line to the invoking nx's stderr (NX_INVOCATION_ROOT_PID, appended; own stderr
without one): `saving emulator data in the background — \`tools/dev/dev ps\` shows it FINISHING`. It is written by
another process, so Nx muting its own output after SIGINT does not swallow it (observed above). Tested in
`emulators-stop.test.sh` with a stand-in invoker.

## Release notes for the orchestrator

- **Migrations:** `0.50.0/split-serve-follower` (D3) is owed and written. Everything else is owned template artifacts
  regenerated by every upgrade (`tools/emulators.sh`, `tools/emulator-ports.mjs`, `tools/dev/**`, `tools/shared-browser/runtime.mjs`,
  `HOUSE.md`) or the payload's executor; the new `.bespunky/run/logs/` and `<state dir>/detached/` live under the
  self-ignoring `.bespunky/run/`.
- Bumps owed (not done here, by instruction): `@bespunky/nx-tools` (payload), `bespunky-workflow`
  (`local-server-isolation/SKILL.md`). `check-release-invariants` reports them.
- Tests: test-generators 165 ok / 22 skip; test-migrations 210 ok; test-layers 100 ok; test-scaffold 22 files ok
  (new: `machine-output`, `emulators-stop`; `dev-engine` gained the detached-work cases).

## Left open
- In agent mode the inner `nx run firebase:emulators` / `web:dev-server` output is summarised away inside `nx serve`
  (pre-existing; the engine reports the export result and failures itself).
- `dev-stack` is listed as succeeded in `3 tasks: 2 succeeded, 1 failed` when the follower finished first — the run's
  exit and the failed `serve` line are what count; cosmetic.
