# `tools/test-scaffold` — behaviour tests for the scaffolder

```bash
bash tools/test-scaffold/run.sh
```

Runs in about a second, needs nothing installed (bash + git), and is safe to run anywhere — every fixture is
a throwaway repository under `mktemp -d`, and nothing touches this workspace.

## Why this exists

`scaffold.sh` is the one piece of this repo that **runs inside other people's projects and writes to them**.
Most of what it does announces its own failure: a generator that throws stops the run, a bad install fails
loudly. Its **guards** do not. A guard that stops guarding looks exactly like a guard with nothing to catch —
the run goes green, and the damage lands on someone else's repository, later, with nothing in the output to
suggest anything was skipped.

That is not hypothetical. The preflight gate exists because a sync committed a project's in-flight libraries,
its functions app and its docs into a commit named after a devcontainer marker file, and reported `SYNC_OK`
while doing it. A test suite is the difference between that being a bug we fixed and a bug we can re-ship.

So the rule for this directory: **it covers the behaviour whose regression would be silent** — refusals,
guards, gates, ordering. Not everything the scaffolder does.

## What is covered

| File | Covers |
| --- | --- |
| `render.test.sh` | That `scaffold.sh` can **assemble its program at all**, in every mode — the one failure that precedes all the others. |
| `preflight-gate.test.sh` | The pre-write gate: dirty tree, protected branch, detached HEAD, the no-branch-model ask, per-file untracked counting, and that several blockers are reported in one pass. |
| `emulators-only.test.sh` | What `tools/emulators.sh` hands `firebase emulators:start` — the derived `--only`, and that passing it does not silently disable export-on-exit. |
| `emulator-seeds.test.sh` | The seed cascade: seeds shared from the main worktree, data isolated per stack, and a worktree never writing back into main's. |
| `reap-ownership.test.sh` | That the reaper kills orphans and not a second, legitimately-running suite. |
| `port-offset.test.sh` | Port-block derivation and isolation (assertions live in the sibling `port-offset.checks.mjs`). |

**`render.test.sh` is the one that runs before the subject of every other test exists.** `scaffold.sh`'s
product is a shell program assembled out of nested double-quoted strings, where a backtick — *including one
inside a `#` comment* — is live command substitution at render time. That shipped: four backticked words in
a prose comment made the render exit 127 on `--sync` and on a fresh scaffold, so no consumer's scaffolder
could run at all. It reached users as *"after the sync, nx-tools doesn't install the latest version"* — true,
and pointing at everything except a comment four hundred lines from the install. The script had documented
the hazard and named the check (`--print-inner`) for a long time; what it did not have was anything that ran
it. Now every mode is rendered, parsed, and inspected on each CI run.

One thing it now makes possible but does not yet do: the rendered program is a first-class artifact in this
suite, so the **ordering** caveat below — that preflight runs before the first write — could finally be
asserted rather than read.

## Adding a test

Drop a `*.test.sh` file in this directory. `run.sh` globs them, so there is no list to update and no way to
add a test that silently never runs. Exit non-zero to fail.

Two conventions worth keeping, both learned the hard way here:

- **Never pass vacuously.** If a test cannot reach the thing it tests, it must exit **2** and say so — not
  report success. `run.sh` applies the same rule to itself: an empty glob is a fatal error, not a green run.
- **Prove the guard, not just the happy path.** `preflight-gate.test.sh` asserts that its own extraction
  aborts when the markers move. Writing that assertion is what revealed the first version *didn't* abort —
  `exit` inside `$( )` leaves only the subshell, so it printed its fatal message and carried on with an empty
  block. A guard nobody tested is a guard nobody has.

## How the preflight test reaches the code, and what it does not cover

The gate ships as shell **rendered into a string** inside `scaffold.sh` and executed in the target project,
sometimes inside Docker. Running the whole scaffolder in CI to reach it would pull in argument parsing,
runtime selection, Docker and a real install — slow, environment-dependent, and mostly testing other things.

So the test extracts the `PREFLIGHT_CHECKS` and `PREFLIGHT_VERDICT` blocks by their markers and evaluates
them directly against real git fixtures. Be clear about the trade: this tests the **shipped text of the
gate** and its verdicts, **not its wiring** into the run sequence. That the gate runs *before*
`ENSURE_NX_BLOCK` — the whole basis of the claim that nothing has been written — is still guaranteed only by
reading the rendered order in `scaffold.sh`. If that ordering ever gains a second reader, it deserves its own
test.

## Relationship to the other checks

- `tools/check-release-invariants/` — guards whether a change **reaches** consumers (versions, the derived
  marketplace, the migration ceiling). Run in CI and by the pre-push hook.
- **This directory** — guards whether the scaffolder **behaves** once it gets there.

The pre-push hook deliberately does not run these: it guards pushes to `main`/`development`/`staging` for
release bookkeeping, and widening its remit is a separate decision. CI runs them at those same integration
points; locally, run `run.sh` — it is fast enough that there is no reason not to.
