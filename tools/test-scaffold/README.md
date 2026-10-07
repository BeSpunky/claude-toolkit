# `tools/test-scaffold` — behaviour tests for the scaffolder

```bash
bash tools/test-scaffold/run.sh
```

Runs in about a second, needs nothing installed (bash + git), and is safe to run anywhere — every fixture is
a throwaway repository under `mktemp -d`, and nothing touches this workspace.

## Why this exists

`house.sh` is the one piece of this repo that **runs inside other people's projects and writes to them**.
Most of what it does announces its own failure: a generator that throws stops the run, a bad install fails
loudly. Its **guards** do not. A guard that stops guarding looks exactly like a guard with nothing to catch —
the run goes green, and the damage lands on someone else's repository, later, with nothing in the output to
suggest anything was skipped.

That is not hypothetical. The preflight gate exists because an upgrade committed a project's in-flight libraries,
its functions app and its docs into a commit named after a devcontainer marker file, and reported `UPGRADE_OK`
while doing it. A test suite is the difference between that being a bug we fixed and a bug we can re-ship.

So the rule for this directory: **it covers the behaviour whose regression would be silent** — refusals,
guards, gates, ordering. Not everything the scaffolder does.

## What is covered

| File | Covers |
| --- | --- |
| `cli.test.sh` | The command line: `house.sh new \| upgrade \| add-layer \| help` — the command first, `upgrade` refusing every layer-bringing flag (`--add-layer`, `--preset`, `--firebase`) by naming `add-layer`, `add-layer` always requiring its `<layers>` positional (even with `--preset`), `--add-layer` on `new`, `add-layer --staging firebase` |
| `render.test.sh` | That `house.sh` can **assemble its program at all**, in every mode — the one failure that precedes all the others. |
| `preflight-gate.test.sh` | The pre-write gate: dirty tree, detached HEAD, the protected branches of a DECLARED model (names + release globs) and of an undeclared one, the `branch-model: undeclared` signal, an unknown projection schema, `--staging` without a pre-production stage, per-file untracked counting, and that several blockers are reported in one pass. |
| `emulators-only.test.sh` | What `tools/emulators.sh` hands `firebase emulators:start` — the derived `--only`, and that passing it does not silently disable export-on-exit. |
| `emulators-stop.test.sh` | That a STOP always saves the emulator data, however it arrives: Nx's leaf-first tree kill + SIGKILL after the grace, a terminal's group Ctrl+C, a plain `kill`, the script vanishing (SIGKILL), a restart while the previous suite still saves, and a crash (non-zero, log named). A fake firebase-tools whose "JVM" records any signal that reaches it before the export — the exact failure that lost every `dev stop`/Ctrl+C. |
| `emulator-seeds.test.sh` | The seed cascade: seeds shared from the main worktree, data isolated per stack, and a worktree never writing back into main's. |
| `reap-ownership.test.sh` | That the reaper kills orphans and not a second, legitimately-running suite. |
| `machine-output.test.sh` | That what a shell script parses from a generated tool stays plain text under `FORCE_COLOR` (which Nx sets for every task): `emulator-ports.mjs` `ports` / `free-offset` piped into `shift` exactly as `build-seeds.sh` does, plus a static guard over every generator template against `console.log(<bare value>)`. Regressed silently once: `seed:build` died on coloured digits and the reaper matched no port. |
| `dev-engine.test.sh` | The stack-free dev engine: port-block sizing and offset resolution, declaration validation and planning (substitution, URL switches, skips), argv parsing — and a real `dev serve --dry-run` in a throwaway repo — including a workspace in a subdirectory of its repository, a symlinked invocation, the IPv6-aware free-port probe, and a SIGKILLed child failing the serve (assertions in the sibling `dev-engine.checks.mjs`). |
| `workspace-shape.test.sh` | `--layout` / `--linking`: an upgrade REFUSES both (the shape of an existing workspace is detected, never chosen), unknown ids and `workspaces` without a package.json are refused, the defaults still render today's bootstrap, and `--linking=workspaces` / `--layout` render the TS-solution preset, the declared layout and the first app in its appsDir. |
| `pm-add-dev.test.sh` | That adding a dev dependency is decided IN the program, at call time: `_pm_add_dev` is rendered before its first call and every add goes through it (scaffold and upgrade), and the shipped function — run against stub package managers — passes yarn 1's `-W` only at a `workspaces` root, never to berry, pnpm's `-w` only beside `pnpm-workspace.yaml`, and pins exactly in every arm. |
| `project-identity.test.sh` | That an upgrade names the project, not its directory: inside a linked worktree `house-sync-<date>` of `myrepo` the program says `myrepo` everywhere a name is passed and reaches its directory only through the environment; and the identity rule for the main worktree, a linked one, a subdirectory workspace and a non-git directory. |
| `writes-nothing.test.sh` | That a REFUSED upgrade and a `--print-inner` write nothing (no tag, no deleted lockfile), print no failure/restore advice over the verdict, and that a parent directory with a quote reaches the program as environment, never as code. |
| `worktree-domains.test.sh` | The route registry: 12 concurrent registers keep 12 routes, and `reconcile` keeps exactly the slugs the dev engine registers (one shared rule) while dropping a dead one. |
| `port-claim.test.sh` | Runs the shipped `tools/port-claim` suite: real multi-process races on one registry (allocation, and the takeover of an expired claim), and out-of-range ports refused. |
| `firebase-banner.test.sh` | The `/etc/profile.d` hook for the Firebase banner: written POSIX and quoted, sourced by dash and bash from a path with a space and a quote. |

**`render.test.sh` is the one that runs before the subject of every other test exists.** `house.sh`'s
product is a shell program assembled out of nested double-quoted strings, where a backtick — *including one
inside a `#` comment* — is live command substitution at render time. That shipped: four backticked words in
a prose comment made the render exit 127 on an upgrade and on a fresh scaffold, so no consumer's scaffolder
could run at all. It reached users as *"after the upgrade, nx-tools doesn't install the latest version"* — true,
and pointing at everything except a comment four hundred lines from the install. The script had documented
the hazard and named the check (`--print-inner`) for a long time; what it did not have was anything that ran
it. Now every mode is rendered, parsed, and inspected on each CI run.

One thing it now makes possible but does not yet do: the rendered program is a first-class artifact in this
suite, so the **ordering** caveat below — that preflight runs before the first write — could finally be
asserted rather than read.

## Adding a test

Drop a `*.test.sh` file in this directory. `run.sh` globs them, so there is no list to update and no way to
add a test that silently never runs. Exit non-zero to fail.

Three conventions worth keeping, all learned the hard way here:

- **Never pass vacuously.** If a test cannot reach the thing it tests, it must exit **2** and say so — not
  report success. `run.sh` applies the same rule to itself: an empty glob is a fatal error, not a green run.
- **Prove the guard, not just the happy path.** `preflight-gate.test.sh` asserts that its own extraction
  aborts when the markers move. Writing that assertion is what revealed the first version *didn't* abort —
  `exit` inside `$( )` leaves only the subshell, so it printed its fatal message and carried on with an empty
  block. A guard nobody tested is a guard nobody has.
- **Search captured output with `in_text`, never `printf … | grep -q`.** Source `text.sh` and write
  `in_text "$out" -q 'pattern'`. `grep -q` quits at its first match and closes the pipe; a `printf` still writing
  dies of SIGPIPE, and under `pipefail` a check whose text *matched* reads as failed — at random, by output size
  and scheduling. It failed CI on `main` once (`d5f4a72`) before every check moved to the helper.

## How the preflight test reaches the code, and what it does not cover

The gate ships as shell **rendered into a string** inside `house.sh` and executed in the target project,
sometimes inside Docker. Running the whole scaffolder in CI to reach it would pull in argument parsing,
runtime selection, Docker and a real install — slow, environment-dependent, and mostly testing other things.

So the test extracts the `PREFLIGHT_CHECKS` and `PREFLIGHT_VERDICT` blocks by their markers and evaluates
them directly against real git fixtures. Be clear about the trade: this tests the **shipped text of the
gate** and its verdicts, **not its wiring** into the run sequence. That the gate runs *before*
`ENSURE_NX_BLOCK` — the whole basis of the claim that nothing has been written — is still guaranteed only by
reading the rendered order in `house.sh`. If that ordering ever gains a second reader, it deserves its own
test.

## Relationship to the other checks

- `tools/check-release-invariants/` — guards whether a change **reaches** consumers (versions, the derived
  marketplace, the migration ceiling). Run in CI and by the pre-push hook.
- **This directory** — guards whether the scaffolder **behaves** once it gets there.

The pre-push hook deliberately does not run these: it guards pushes to the declared protected lines (`main`/`development`) for
release bookkeeping, and widening its remit is a separate decision. CI runs them at those same integration
points; locally, run `run.sh` — it is fast enough that there is no reason not to.
