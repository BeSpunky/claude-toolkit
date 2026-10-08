# FF-D — `tools/dogfood-consumer/run.mjs`: the consumer dogfood, scripted

Written 2026-10-07 by the FF-D unit. R1-0 (`new --preset=angular --firebase` broken by the toolkit under test) reached
review because the hand consumer dogfood (DOGFOOD-CONSUMER.md, -2.md) only ever created its consumer with the
RELEASED toolkit. This tool walks both consumer roads every time, in one step.

## Design

- **One file, Node built-ins only** (`node:child_process`, `node:fs`). JSON edits and the seeds-as-data shape are
  simpler in Node than in bash.
- **Steps** (`--only=<csv>`; prerequisites are pulled in; aliases `consumer`, `new`):
  - `released` — a temporary **detached** worktree of `--released` (default `development`, the integration line,
    which is what consumers run today). From it: `house.sh new --preset=angular --firebase [--staging] <path>/coach web`.
  - `seed` — `SEEDS`: one entry per shape a reporting project grew, ONE COMMIT EACH on the integration line.
    - The list: the branch model (written with the released `branches.mjs`, string `deploys`, its lines created),
      hand `inputs` on `functions:deploy`, a hand `firebase:deploy`, root rules declared in `firebase.json`, a
      `defineSecret` trigger + its example key, a gitignored fake `.secret.local` (not committed), an edited
      `runConfig`, an untagged `brand` lib from `@nx/angular:library` imported by the app, and a compact-JSON `web-e2e`
      that depends on `web:serve`.
    - A seed's `apply` throws when the released scaffold no longer has what it edits, so a stale seed shows as a FAIL
      and is never a silent no-op. Its optional `survives` states what of the user's content the upgrade must keep.
    - A future reporting project's shape is one more entry.
    - Then a **baseline** `nx run-many -t build` / `-t lint`, so the upgrade's rows can say which failures it
      introduced.
  - `upgrade` — on `chore/house-upgrade`: `house.sh upgrade --local --yes .` with the toolkit under test.
    - Asserts: `UPGRADE_OK` and none of `UPGRADE_PARTIAL` / `_REFUSED` / `_FAILED`; the HOUSE.md stamp equals the
      toolkit's `nx-tools` version; every seed `survives`.
    - Commits the generator output, then upgrades **again**: `UPGRADE_OK`, `UPGRADE_NEXT: none`, HEAD unmoved, and an
      empty `git status`.
    - Then build + lint, each failure marked new or pre-existing against the baseline.
  - `new-agent`, `new-node`, `new-angular`, `new-angular-firebase` — a real `house.sh new --local` with the toolkit
    under test.
    - Asserts: `NEW_OK`; the stamp version; the expected layers; a clean git repo; the host shape (wrapper: `./nx` and
      no `package.json`; node: an exact `@bespunky/nx-tools` pin); `apps/web` on the angular presets; `firebase.json`
      and `apps/functions` on the firebase one.
    - Build + lint on the angular presets. Both are cheap (about 5 s and 3 s). A template that renders broken code is
      exactly what `NEW_OK` cannot see.
- **`--yes` is deliberate.** The target is a fixture the run created seconds earlier, and running the tool is the
  human's consent. The header says so.
- **Isolation and cleanup.**
  - Every `new` gets an explicit path. `PROJECTS_DIR` and `TMPDIR` point into the workdir. `NX_DAEMON=false`. Every
    child leads its own process group (timeouts and Ctrl+C kill the group).
  - On any exit: the released worktree is removed and pruned, every process whose cwd is under the workdir is killed
    (and reported as a FAIL row), and the scratch projects are deleted unless `--keep`. The logs are kept.
  - Two rows prove it: "no process left under the workdir" and "nothing written to ~/projects".
- **Reporting.** One row per check, PASS / FAIL / SKIP, time, and a detail. On failure the detail is the **cause** line
  (Nx's `NX   <message>`, a package manager's `error …`, `ERROR:`), not the consequence (`UPGRADE_FAILED`). For
  run-many, it is Nx's failed-task list. Exit 1 on any FAIL. Every command's full log is in
  `<workdir>/logs/NN-<check>.log`.
- **Not CI, not pre-push.** It needs the network and takes minutes. It refuses to run under `CI=true`, as house.sh's
  upgrade does.

## How to run

```bash
node tools/dogfood-consumer/run.mjs                                  # everything: this checkout vs development
node tools/dogfood-consumer/run.mjs --released=<ref> --toolkit=<path> --only=consumer --keep --workdir=<dir>
```

To test a tree that other agents are editing, take a stable snapshot first:
`git worktree add --detach <scratch>/snap HEAD`, pass `--toolkit=<scratch>/snap`, and remove the snapshot afterwards.

## End-to-end runs (snapshot of `feat/house-firebase-handoff--ff` @ cd45019, nx-tools 0.50.0; released `development` @ 4f01d00, 0.49.2)

### W4, as-is (what the tool reports today): FAIL, 20 passed / 3 failed / 2 skipped, 5m00s

| Step | Check | Result | Time | Detail |
| --- | --- | --- | --- | --- |
| released | `new --preset=angular --firebase --staging` (0.49.2) | **FAIL** | 1m01s | `error @firebase/ai@3.0.0: The engine "node" is incompatible … Expected ">=24.12.0". Got "22.23.2"` |
| seed, upgrade | (all) | SKIP | | no released consumer |
| new-agent | new + stamp + layers + clean repo + wrapper host | PASS ×5 | 37s | |
| new-node | new + stamp + layers + clean repo + node pin | PASS ×5 | 26s | |
| new-angular | new + stamp + layers + clean repo + pin + `apps/web` | PASS ×6 | 1m30s | |
| new-angular | build | PASS | 5.0s | 2 projects |
| new-angular | lint | **FAIL** | 2.2s | failed: `shared-browser:lint`, `design-system:lint` |
| new-angular-firebase | `new --local --preset=angular --firebase` | **FAIL** | 1m15s | `NX The "vitest-angular" unit test runner requires Angular v21 or higher. Detected Angular v20.3.0.` (R1-0, as expected) |
| run | no stray process · nothing in ~/projects | PASS ×2 | | |

### W3, with the yarn engine check bypassed (`YARN_IGNORE_ENGINES=true` in the caller's env; this exercises the consumer road): FAIL, 45 passed / 4 failed, 7m36s

| Step | Check | Result | Time | Detail |
| --- | --- | --- | --- | --- |
| released | worktree + `new --preset=angular --firebase --staging` (0.49.2) | PASS ×2 | 1m48s | |
| seed | 9 seeds + clean tree | PASS ×10 | ~2s | |
| seed | baseline build | PASS | 4.9s | 3 projects |
| seed | baseline lint | **FAIL** | 2.1s | failed: `design-system:lint` (pre-existing in 0.49.2) |
| upgrade | `upgrade --local --yes` (0.50.0) | PASS | 49s | `UPGRADE_NEXT: rebuild-container`, 15 commits |
| upgrade | stamp + 9 × survives | PASS ×10 | | |
| upgrade | second upgrade is a no-op | PASS | 24s | `UPGRADE_NEXT: none`, no commit, clean tree |
| upgrade | build | PASS | 5.2s | 3 projects |
| upgrade | lint | **FAIL** | 3.0s | `design-system:lint`, `shared-browser:lint` (NEW since the baseline: `shared-browser:lint`) |
| new-agent / new-node / new-angular | as in W4 | same | | new-angular lint FAILs the same way |
| new-angular-firebase | new | **FAIL** | 1m39s | R1-0, as above |
| run | no stray process · nothing in ~/projects | PASS ×2 | | |

After the runs: the worktree list was identical to before (only other agents' HEADs had moved), no process had a cwd
under the scratch area, and `~/projects` did not exist.

## Toolkit failures found (none is the tool's)

1. **The released toolkit can no longer create a Firebase project on Node 22.**
   - `firebase` 13.0.0 was published at 2026-10-07T19:36Z. Its `@firebase/ai@3.0.0` declares `node >=24.12.0`.
   - The scaffold's `"firebase": "latest"` resolves to it, and yarn's engine check fails the install, so
     `new --firebase` dies mid-scaffold.
   - This hits 0.49.2 now, and 0.50.0's `new --preset=angular --firebase` will hit it as soon as R1-0 is fixed, since
     the run never got past the design-system step.
   - The house images are `typescript-node:22`. The floating `latest` pin is the root cause, and this is the A1 /
     pin-floating-dependencies territory.
2. **R1-0**, reproduced as expected: the design-system generator asks for `vitest-angular`, which needs Angular 21,
   on the Angular 20 pin.
3. **`shared-browser:lint` fails on the generator-owned `tools/shared-browser/*.mjs`.**
   - 8 × `@typescript-eslint/no-empty-function` in `attach.mjs`, `recorder.mjs` and `verify.mjs`.
   - New in 0.50.0: the project gains a lint target in this release, so every upgraded or new house web project fails
     `nx run-many -t lint` and `UPGRADE_VERIFY`'s suggested `affected -t build lint test`.
4. **`design-system:lint` fails**: `@nx/dependency-checks` reports "The `@angular/common` package is not used by the
   design-system project". This is pre-existing (it also fails in the 0.49.2 baseline) and persists on fresh
   `new --preset=angular`.
5. **Minor: a failed `new` reports in upgrade vocabulary.** It prints `UPGRADE_FAILED … restore: (--no-backup)`.

## Left open

- The consumer road cannot run green as-is until finding 1 is resolved (or the run uses Node 24). The tool reports
  this correctly as a FAIL on the `released` row.
- Seeds the tool does not carry from the hand recipes, because they are runtime observations rather than shapes:
  serve, `dev stop`, emulator export, Chromium. Those stay hand-run.

## Upstream breaks of the released baseline (2026-10-07)

firebase@13.0.0 (`@firebase/ai@3.0.0`, `engines.node >=24.12.0`) broke the RELEASED `new` (`"firebase": "latest"`), and
the tool reported it as a FAIL of the change under test, with seed/upgrade silently SKIPped. Now a released-side
failure (the released `new`, the baseline build/lint) is classified against `UPSTREAM_CAUSES` — recognisers for yarn's
`The engine "node" is incompatible`, npm's `EBADENGINE`, pnpm's `ERR_PNPM_UNSUPPORTED_ENGINE` — and a match is its own
status `UPSTREAM`; the dependent steps read `NOT COVERED — baseline broken upstream (…)`; the verdict is
`PASS (incomplete: …)` (never clean, never FAIL by itself) and the summary prints the engine workaround rerun with the
same args. The toolkit under test never gets the excuse: an engine break in `new --local` stays FAIL. Offline check:
`node tools/dogfood-consumer/run.mjs --self-test`. Observed for real with `--only=consumer`:

```
released  new --preset=angular --firebase --staging (nx-tools 0.49.2)  UPSTREAM  1m05s  baseline broken upstream: @firebase/ai@3.0.0 requires node >=24.12.0, this Node is 22.23.2
PASS (incomplete: baseline broken upstream — seed, upgrade not covered) — 3 passed, 0 failed, 0 skipped, 2 NOT COVERED (baseline broken upstream), 1 UPSTREAM (…) in 1m05s
  YARN_IGNORE_ENGINES=true node tools/dogfood-consumer/run.mjs --only=consumer
```
