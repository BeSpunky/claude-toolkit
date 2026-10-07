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
