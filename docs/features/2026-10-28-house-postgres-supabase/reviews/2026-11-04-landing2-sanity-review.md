# Sanity review — Landing 2, `postgres` (fix mode)
Opened 2026-11-04 · branch feat/house-postgres-supabase vs origin/development · HEAD 8eab5af2 · reviewer applies fixes to the working tree, commits nothing.

## Frame
Goal: the `postgres` house layer with the native provider, plus Landing 1 debts (E1, E6, F4, F5, F7, F8, F14). Decisions (not findings): research/ARCHITECTURE.md; DECISION.md; handoffs/2026-11-04T1648Z-fanout-landing2.md — one server per stack, data under ~/.local/share, major 18 in .bespunky/postgres.json, pinned closure + dbmate 2.37.0, forward-only migrations, safety by system_identifier, launcher owns addressing via `dev ps --json`, targeted provider unnamed on a line stays blocked, human deploy prompt + refused under CLAUDECODE=1, sweep needs proof the tree is gone, heartbeat owner file, dbmate --strict locally, local verbs don't check stack owner, no new skill.
Verification: test-layers, test-generators, test-migrations, test-scaffold (CI=true), test-postgres, check-runner-image/test.sh, check-descriptions, check-script-modes. check-release-invariants red until bumps (expected).

## Lenses (budget 5 agents: 4 reviewers + 1 verifier)
| id | lens | status |
|---|---|---|
| L1 | Launcher correctness and data loss (stop, kill, failed migration, sweep, heartbeat, reset) | returned |
| L2 | Security and safety bypasses (URL, identity, deploy gates, env/.env, CI provider, shell) | returned |
| L3 | Architecture and completeness (A/B/C ownership, idempotence, add-layer, wrapper vs node, yaml caret, F4, 0.35.0 rung, migrations owed, docs vs code, HOUSE.md) | returned |
| L4 | Tests and CI actually running (image job, tripwire workflow, upstream-tables, fixtures vs reality, tests that pass on broken code) | returned |
| V1 | Adversarial verifier over high/medium | dispatched |

## Findings
(filled as reports land)

Raw reports landed (ids used below): L1.1-11 launcher, L2.1-12 safety, L3.1-10 architecture, L4.1-14 CI and tests. Duplicates: L2.3 = L3.1 = L4.1 (no dbmate in CI); L1.1 = L3.3 (no recovery road); L1.2 = L2.10 (sweep proof); L1.5 = L3.5 (major); L1.11a = L2.5 (psql -X); L1.11b = L2.4 (CI from file); L2.9 + L3.2 (foreign pipeline both ways).
Process notes to report: L1 bound 127.0.0.1:5432 for seconds in a linked worktree by accident (stopped, no leftovers); L3 left fixture /home/node/projects/pgw.

## Verification of findings
V1 ran over a HEAD snapshot: B (L3.2), C (L2.9), D (L3.4), E (L1.6), F (L1.4), G (L3.7, L3.8), H (L3.9), I (L2.8), K (L3.6) stand; A (L1.9) stands in part (no automatic loop; long recovery not produced); J (L2.11) in part (bind is true, forward is deliberate); L (L4.5, L4.6, L4.10) in part (claims true, delayed detection only). Everything else at high or medium was reproduced by its reviewer with real binaries, except L2.8 and L2.10's second container, which are reasoned.

## Outcomes
### Fixed (working tree, uncommitted)
L2.3/L3.1/L4.1 CI dbmate step + tools never from node_modules/.bin. L2.1/L2.6 URL parameter allowlist, `@` in path, `%` in host, whole-URL masking. L2.7 cleartext sslmode refused off loopback, sslmode shown (verify-full not required). L2.2 dotenv colon form. L2.4/L1.11b CI only true/1, CI in a file refused. L2.5/L1.11a psql -X for --sql/--file. L2.9 Nx target-list forms, `nx deploy`, launcher, dbmate image and binary names. L3.2 (part) pull-request-only workflows deploy nothing. L1.3 lost ownership stops by SIGQUIT alone. L1.4 realpath in serverOf. L1.5/L3.5 start refuses a major mismatch; docs say upgrade, then rebuild. L1.6 starting until the ready mark (`stateDir` added to `ps --json`). L1.7 per-entry sweep guard, record removed last. L1.9 pg_isready 1 extends the bound. L1.10 message reworded. L1.11c aborted pg_controldata. L3.6 start refuses a silent Nx under an agent; messages and docs name the launcher. L3.8 and L3.7 docs. L3.9 project rules paths warn. L3.10 stale text. L4.2 pgvector asserted as a version; L4.3 bring-up identity scenario; L4.5 paths; L4.6 (part) image job asserts pg_isready, pg_controldata and the launcher's settings; L4.7 sweep-with-running scenario (the `holder` guard still unmutated); L4.8 pty prompt check; L4.9 masking check; L4.10 test-layers ties CASES to the pins; L4.11 (part) dpkg-architecture is could-not-run; L4.12 timeouts and no-scenario fails; L4.13 (part) retry.
Interim for L1.1/L3.3: failure names the road (remove the stack's data dir) with a test; HOUSE.md corrected. The shape of a real road is below.

### Needs decision
L1.1/L3.3 reset with no running stack; L1.2/L2.10 sweep (challenge); L3.4 evidence; L4.4 CI run before landing; L3.2 remainder and unread `uses:`; L2.8 repo-level secret fallback; L2.3b prepare job's node_modules beside a secret; L4.6 launcher on the image matrix; L3.7 seed or report; L1.8 auto moving blocks; L1.11d offset of a human's start; L2.11 auto-forward; L2.5b `\connect` in --file and seeds; L2.7b verify-full.

### Rejected
L2.12: parseProjection already refuses it (the fix's own test threw there). L1.10's refusal of BEGIN: plpgsql bodies start lines with BEGIN and END, so the message was reworded instead. Q4 yaml caret, Q6 rung 0.35.0, Q7 migrations: nothing owed.

### Not done
L4.11 apt-get transitive dependencies (not observable here); L4.12 pooler assertion left weak; L4.13 exit 2 split; L4.14 Angular consumer serve with Postgres; L4.7 `holder` guard test.

## Process
L1 bound 127.0.0.1:5432 for seconds by accident (stopped; nothing left). L3 ran deploy-path checks with CLAUDECODE unset against db.invalid and left /home/node/projects/pgw. Budget spent, so no second-round reviewer over the fix diff.

## Decisions applied (uncommitted, on top of 122f2e9d and cbfa12b1)
D1 reset boots through `dev run` (`serve-reset`), resets, stops; a failed start names it. D2 sweep moves to `.swept-<ms>-<hash>`, prints the restoring `mv`, a start deletes after 7 days; `origin` records host and parent device, a mismatch or no record is unknown and kept. D3 evidence is the tag `type:postgres`, resolved by `postgres/home.ts`; a foreign holder is refused with the way out; note appended to research/ARCHITECTURE.md. D5 `credentialedDeploySignals`, counted only with `secrets.` in the parsed workflow; `uses:` unread. D6 `POSTGRES_DEPLOY_URL_<ENV>` through `needs.resolve.outputs.environment_token` and `secrets[format(...)]`; HUMAN_STEP and docs. D7, D13, D14 in HOUSE.md. D8 `postgres-image.launcher.sh` on node-preset cases, fed by tar over stdin. D9 each hand-declared app is printed its snippet. D10 a start names where this tree last ran. D11 `auto` from a linked worktree. D12 `onAutoForward: ignore`, see the departure below. Leftovers: pooler assertion tightened; `holder` scenario added, and a mutant removing the guard fails it.

Departure on D12: asked for a port range, applied a command-line regex (`bespunky/postgres/.+/data`) plus the base port. Offsets step by the stack's span up to 65535, so a range would also catch every other service's shifted port. portsAttributes takes a regex over the process's command line; the tripwire asserts the real postmaster's command line matches it.

Unproven: `secrets[format(...)]` and the setup step on real GitHub; the regex key in real VS Code; the launcher probe in real images (run here only, directly on trixie with real binaries, it passed).

Consequence of D2 worth weighing: a rebuild changes the container's hostname, so a worktree removed before a rebuild is never proven gone: its data is kept and reported on every start until removed by hand.

## Correctness pass over 33eb05eb (uncommitted)
All eight anchors checked before fixing. 1 and 5: reset finds the tree's cluster (`stacksWithData`), boots under that key, asks with `--stack=<key>` if several; failure advice names `--stack`; the moved-block warning names `tools/dev/dev serve <app> --port-offset=N` for a serve's data. 2: a start creating a cluster names the tree's `.swept-*-<hash>` and a command that works; `mv -T` everywhere; the tripwire runs each printed command. 3: `pull_request` with `types` holding `closed` is not pull-request-only. 4: `secrets` read from `${{ }}` only, string literals stripped, `toJSON(secrets)` counts; per job. Narrower than asked: a `uses:` step's expressions do not count, since a coverage token handed to an action is the same job and would still have deleted deploy.yml; a secret reached only through an action's output goes unseen. 6: not reproducible through the generator: `parseProjection`'s TOKEN refuses it, and only `. _ : -` beyond alphanumerics pass; tested through the generator, with `bash -n` on what does pass. 7: `deployEnv` may be a function of the environments; static `secrets.POSTGRES_DEPLOY_URL_<ENV>` chain selected by `needs.resolve.outputs.environment`; `environment_token` removed. 8: a worktree's natural block is hashed from its branch, so the fixed `linked` name meant port 7432 for every run at once, and half the blocks sit in the ephemeral range. Holding 7432 moved the stack (observed); the exact two FAILs were not reproduced in 4 loaded sequential runs. The branch name is now the run's own, chosen with a free natural block below the ephemeral range. Also found: a synchronous `dev stop` of a serve waits out its timeout on a zombie; the new scenario stops asynchronously.
