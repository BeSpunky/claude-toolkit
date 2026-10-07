# FA — serve as its own stack; one stack identity; the R3 findings

Fixer FA, branch `feat/house-firebase-handoff--fa`, worktree `hfh-fa`. Findings: `review/R3.md` (all), `review/R9.md`
R9-1. Decision (orchestrator, binding): adopt R3's D1 — `serve` IS the dev engine as a NON-continuous task; `dev-stack`
stays continuous only for e2e; retire serve-preflight, follow-stack, exit records, the follower registry and the /proc
postscript. Written as it happens. Scratch: `scratchpad/fa/`.

## Plan (written before any code)

Units, and who does them:

| id | unit | owner | re-runnable |
| --- | --- | --- | --- |
| A | Nx shape: retire the two executors + `_utils/invoker`/`run-records`; simplify `serve` executor (engine exit = task exit); generator + `_utils/dev-server` (serve = engine non-continuous, dev-stack = continuous mirror); explicit `continuous: false` on the leaf and emulator targets; reshape the two 0.50.0 rungs + their fixtures (inputs from git, `historicalShapes`); test-generators / test-layers expectations | fork (same tree, path boundary below) | yes |
| B | Dev engine: atomic claim (R3-1), `auto` skips claimed blocks, boot id (R3-7), blocking waits (R3-8), `--all-mine` scope (R3-9), `stop --abandon` (R3-3), one identity (D4) | FA | yes |
| C | emulators.sh / reaper: short hashed TMPDIR (R3-2), keeper deadline (R3-3), postscript removed (D2), direct run claims through the engine's record (D4), reaper decides by records (D4) | FA | yes |
| D | Real Nx 23 verification (concurrent serves, exit codes 0/1/130, e2e via dev-stack, agent-mode output); R3-2 two-function proof on a long path | FA, after A–C | yes |
| E | Docs: serve-related text in HOUSE.md.tpl, HOUSE.rules.md.tpl, local-server-isolation | FA | yes |

Path boundary for A: `src/executors/**`, `executors.json`, `src/generators/_utils/dev-server.ts`, `src/generators/serve/**`,
`src/adapters/**` (leaf `continuous`), the target-writing in `src/generators/firebase-emulators/generator.ts` (no `.tpl`),
`src/migrations/0.50.0/{split-serve-follower,stack-owned-dev-processes}*`, `migrations.json`, `tools/test-migrations/cases/0.50.0-{split-serve-follower,stack-owned-dev-processes,recompose-*,lint-house-apps}*`,
`tools/test-generators/**`, `tools/test-layers/**`. FA keeps `src/generators/dev/**`, every `.tpl`, `tools/test-scaffold/**`, docs.

## Ledger

- A: done (fork) — 8e18275, 2540755, 1094495.
- B: done — 772d709. C: done — 882b231. Merges of feat/house-firebase-handoff (FH, FC, FE; then FD) — see below.
- D: done (below). E: done — 084b662, 5dadb09. FH's historical shapes + the suite-name gap — be79b07.

## A — Nx shape (fork)

- **Retired:** executors `follow-stack`, `serve-preflight`, `executors/_utils/{invoker,run-records}.ts`. The `serve`
  executor spawns `tools/dev/dev.mjs`, keeps the SIGINT-waits / SIGTERM|SIGHUP-one-TERM rule, and resolves
  `{ success: code === 0 }`. No exit records, `DEV_NX_ROOT` or `NX_INVOCATION_ROOT_PID`.
- **Shape** (`_utils/dev-server.ts` `serveTargetsFor`): `serve` = `{ continuous: false, executor: @bespunky/nx-tools:serve,
  cache: false, <leaf mirror> }`; `dev-stack` = `{ continuous: true, executor, <leaf mirror> }`; no `dependsOn`.
  `serve-options` puts `host` on both. Leaf (Angular adapter) and every `tools/emulators.sh` launcher carry
  `continuous: false` explicitly — Nx 23 `target-normalization.js:52-58` fills an absent key from the executor schema,
  targetDefaults sit BELOW project.json in the merge (`target-defaults.js`), so an explicit value wins.
- **Rungs:** `split-serve-follower` renamed `serve-runs-its-own-stack`: the shipped composer (4f01d00: continuous, no
  dependsOn) → the pair; an app already in the current shape (recompose's live generator) is completed, not rebuilt;
  every house app done by the rung alone (R9-1). Reports: `^serve`, pattern/mixed `projects`, targetDefaults depending on
  `serve`, an own `dev-stack`. A targetDefaults `continuous` is deliberately not reported (explicit wins).
  `stack-owned-dev-processes` writes `false` (in place) and now also reports an own leaf with NO key (schema-filled).
- **Fixtures:** shipped shapes — 0.49.2 (4f01d00), 0.3.0 composer (60bd79f) as a `historicalShapes` entry (diverges:
  no leaf mirror to carry), e76c12a through 0.24.0 → 0.24.1 → stack-owned → recompose → this rung beside a 0.49.2 app
  and a two-app e2e; multi-app; current shape. first-050-upgrade expects `false`.
- Suites: test-migrations 228 ok · test-generators 177 ok / 23 skipped · test-layers 100 ok. Commits 8e18275, 2540755.

## Findings — verdict and evidence (FA)

Each reproduced before it was fixed. Scratch: `scratchpad/fa/` (`r1` engine repo, `nxws` a real Nx workspace on the
compiled payload, the long-path functions workspace).

| id | verdict | evidence |
| --- | --- | --- |
| R3-1 | **fixed** (772d709) | Before: five concurrent `tools/dev/dev serve web` → two refused "…serve another stack beside it (--port-offset=auto)" although they passed auto. After: a claim under one lock (`<main tree>/.bespunky/run/claim.lock`, mkdir-atomic, a dead holder taken over by rename) picks the block and writes the record (`open wx`) before anything spawns; `auto` skips every block a live/orphaned/finishing/foreign record holds; a pinned offset is refused naming the holder and its stop command. Five at once → five stacks, five handles (also a dev-engine check). A preferred block held only by THIS stack's previous run while it is saving is waited for, so a Ctrl+C-and-restart lands back on its ports. |
| R3-2 | **fixed** (772d709, 882b231) | Before: a 183-char tree, firebase-tools 15.32.1, functions `a`/`b` called at once → `a` failed, `EADDRINUSE …/tmp/fire_emu_86d16e96c4f1331d.sock` (the cut name). After: the stack's TMPDIR is `/tmp/bespunky-<12 hex of tree+key>` (DEV_STACK_TMP, in the record, removed with it) → `a=[A] b=[B]`, no EADDRINUSE. Budget asserted (≤ 60) in dev-engine and emulators-stop. |
| R3-3 | **fixed** (882b231, 772d709) | Before: a fake firebase whose export never ends wedged the stack. After: the keeper owns `EMULATORS_STOP_TIMEOUT`; past it, it SIGKILLs its own group, records `ABANDONED after Ns — …` code 1, and the script exits non-zero saying so; SIGUSR1 does the same at once, which is `tools/dev/dev stop --abandon` (a deaf one gets its verified group SIGKILLed after 10 s). The keeper also ends its group's stragglers after the suite (a JVM outliving a crashed firebase-tools). Tests: emulators-stop §8–9, dev-engine abandon cases. |
| R3-4 | **retired with D1** | No exit records exist any more. |
| R3-5 | **fixed** (fork, A) | Explicit `continuous: false` on serve, the leaf and every suite launcher; rung writes `false`. |
| R3-6 | **retired with D1** | No preflight/follower; every `nx serve` is its own stack. |
| R3-7 | **fixed** (772d709) | Records carry `machine` = boot id + PID namespace. Note: the boot id alone is the KERNEL's — every container shares it and keeps it across a rebuild — so the namespace is what tells a rebuilt container. Another boot → dead at once; same kernel, other namespace → `foreign` only while its claimer heartbeats the record (15 s; stale after 60 s) → then pruned. A foreign record's ports block a claim. A zombie claimer counts as dead. |
| R3-8 | **fixed by deletion** | The 20 ms postscript waiters (bash and TS) are gone with D2. What polls remains: the keeper's 0.2 s loop (it owns the stop and must notice a vanished script) and the engine's 250 ms waits on detached work; the claim lock backs off 5→100 ms and is held for milliseconds. |
| R3-9 | **fixed** (772d709) | `ownerIsShared`: a Claude session id is shared by every subagent, so under it `stop` refuses to SELECT (no `--offset`, or `--all-mine`) and says to name the stack or use `DEV_OWNER`. Ancestry was rejected: subagents run in-process, their shells share the claude ancestor. |
| D1 | **adopted** (fork + engine) | see A; the engine exits 0 on a clean stop, 1 on a failure, 130 on Ctrl+C. |
| D2 | **removed** | `executors/_utils/invoker.ts` and emulators.sh `say_to_invoker`/postscript gone; the save notice is on the suite's own stderr. |
| D4 | **one identity** (772d709, 882b231) | Engine serve, direct `nx run firebase:emulators` (`firebase@N`) and a seed build (`seed-build@N`, `--shifted`) all claim through `tools/dev/dev claim/release`. Retired: the direct run's `claims/` + run lock + previous-suite wait, `emulator-ports.mjs free-offset`, and `tools/reap-emulators.sh` with its PPID==1 test (rung `0.50.0/retire-reap-emulators` deletes the owned file, reports any caller; fixture). Because a backend-only Firebase workspace has no `web` layer, the `firebase` layer now writes the engine too (`dev` step; the planner runs a workspace step two layers share once; test-layers case). |
| R9-1 | **fixed** (fork, A) | The rung completes every app alone; fixtures from shipped shapes. FH's audit added 5607eb3 / 296d706 as historicalShapes and exposed a gap I fixed: from 5a05026 the suite may live in a project of another name — stack-owned now finds launchers by command. |

Orchestrator asks handled: rules paragraph keeps only the rule, how-to in HOUSE.md *Running stacks* (+ the skill);
"instead of killing it" / "watch it in the shared browser" gone; firebase-emulators.md matches; stack-owned's header
states record-house-targets runs first and why the record need not change (three-way merge: theirs == ours → silent,
`_utils/house-targets.ts:170`); FD's `DEV_URL_QUERY` and advice change kept through the merge; the restart case waits
on conditions (FINISHING via `dev ps`, the keeper's exit), 6/6 green runs.

## D — verified on real Nx (scratch `nxws`, the compiled payload, `serve` non-continuous + `dev-stack` continuous)

| check | Nx 23.1.0 | Nx 23.3.0 |
| --- | --- | --- |
| two concurrent `nx serve web` in one tree | `web@0` + `web@14000`, both answer | same |
| clean `tools/dev/dev stop` | exit 0, "Successfully ran target serve" | exit 0 (both) |
| Ctrl+C (SIGINT to the group) | exit 130, stack gone, port free | exit 130, stack gone |
| crash (a process exits 3) | exit 1; FAILED block + the cause inline (agent env, non-TTY) | exit 1; **summary renderer**: only `✖ nx run web:serve` + `full log:` |
| e2e depending on `web:dev-stack` | exit 0, reached the server, stack stopped after | exit 0 |

**Found on 23.3:** Nx's agent `summary` output prints nothing of a NON-continuous task while it runs (no URL, no stop
handle) and only a log path when it fails (`task-orchestrator.js` `runTaskDirectly`: summary never streams; continuous
tasks are the exception). `--output-style=stream` shows everything. Not worked around through /proc (that was D2's
boundary violation): HOUSE.md and the always-on rule now tell Claude to serve with `tools/dev/dev serve` (same engine,
no renderer), which local-server-isolation already preferred.

## For the orchestrator

- Migrations owed and written: `serve-runs-its-own-stack`, `stack-owned-dev-processes` (reshaped), `retire-reap-emulators` (new, last).
- Owned artifacts changed (no migration): tools/dev/**, tools/emulators.sh, tools/emulator-ports.mjs, tools/seed/build-seeds.sh, HOUSE.md / HOUSE.rules.md. Plugin text: `bespunky-workflow` (local-server-isolation, delegate-and-parallelize), `bespunky-house` (new skill). Bumps not done.
- Not mine, seen: `src/migrations/0.50.0/lint-house-apps` cannot be `require`d ALONE (an import cycle adapters/angular → … → platform/classify → layers/registry → layers/js calls `adapter('js')` while adapters/registry is half-loaded); the full ladder loads fine (every other 0.50.0 rung loads alone). A filtered `test-migrations` run shows it.
- Not mine, seen: a functions-only firebase.json (no exportable emulator) makes the keeper report "NO EXPORT was written" on a stop — house firebase.json always declares auth/firestore, so only hand-made suites hit it.
- Not run: the full consumer dogfood (`house.sh upgrade --local` on a real 0.49.2 consumer + a container rebuild) — the release gate's.

Suites (after the last merge): test-generators 190 ok / 23 skipped · test-migrations 251 ok · test-layers 101 ok · test-scaffold 22 files ok · check-descriptions ok · check-script-modes ok.

## Merge with FB, FG, FF (and FB's push-secrets fix)

- Conflicts resolved with both intents: emulators.sh = FB's offline `demo-` project id + the stack claim; HOUSE.rules =
  the claim wording + FB's never-arm rule; lint-house-apps = FG's snapshot; the new skill = FB/FG text + the claim
  launch path. Tests moved to FB's `emulator-tools.mjs`.
- `reap-ownership.test.sh` stays retired; its two guarantees are carried to the stack identity in emulators-stop §6b:
  a JVM left by a crashed firebase-tools is ended by the keeper (log says so); a keeper killed outright leaves the stack
  ORPHANED and `dev stop` ends exactly what it left; a live suite is never touched (the claim refuses — "twice").
  `removeRecord` now keeps a record while its keeper's leftovers live.
- The dev engine: ONE artifact, ONE owner — the `dev` generator; `web` and `firebase` list its step, the planner runs it
  once. Said in the registry, the `brings` text (layers.sh regenerated) and HOUSE.md (Running stacks; the no-web
  Firebase paragraph).
- The lint-house-apps load cycle: FG's fix covers it — every 0.50.0 rung now `require`s alone (checked on the compiled payload).
- Found on the merged branch (not from this merge): `preflight-gate.test.sh` failed (`ENSURE_LAYERS: unbound`, then a
  silent exit) — FF's probe block ended the gate with `[ -n … ] && _refuse` as a loop's last command, which makes an
  `eval` of the block return 1 under `set -e`. Fixed in house.sh (`if … fi`) and the test now supplies the render inputs.
- Suites: generators 202 ok / 25 skipped · migrations 268 · layers 102 · scaffold 23 files ok.
