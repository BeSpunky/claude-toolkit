# DF2b — consumer dogfood, round 2 (after FX1–FX3)

Release gate, consumer side, re-run from scratch on 2026-10-07. The fix notes were not trusted: every item was
observed again. Nothing in the toolkit was changed. The fixture is throwaway: `…/scratchpad/df2b/coach`.

## Verdict: two new bugs in the D3 follower design; every run-1 item now holds

- **NB1:** after a clean `dev stop`, `nx serve` exits **130** (4 of 4 runs). It should exit 0.
- **NB2:** an attached `nx serve` reports **failure** when the stack it follows is stopped cleanly.

Both are in the `serve` / `follow-stack` split. The data is always saved.

## How the fixture was built

1. The released toolkit (a `development` worktree at 4f01d00, nx-tools 0.49.2) ran
   `house.sh new --preset=angular --firebase coach web`.
   - Recipe note: `new` with a bare name creates the project in **`~/projects/coach`**, not in the current directory.
     I moved it into `df2b/` and removed the `~/projects` directory I had created.
   - It produced Angular 22.1.8, Nx 23.3.0, `"firebase": "latest"` and `"@angular/fire": "latest"`.
   - The scaffold already had `proxied: true` on auth and functions, in `environment.ts` and in the interface.
2. Hand-applied shapes, one commit each, on `development`:
   - a two-line model (released `branches.mjs write`) with a **string** `deploys` on `main`;
   - hand `inputs` on `functions:deploy`;
   - a hand `firebase:deploy` target with its own command;
   - a `defineSecret('TELEGRAM_BOT_TOKEN')` trigger, with the key added to the example;
   - an edited `runConfig` in the root `apphosting.yaml`;
   - a hand `web-e2e:e2e` with `dependsOn: [{ projects: ['web'], target: 'serve' }]` and
     `devServerTarget: "web:serve"`, written in compact JSON;
   - a gitignored `.secret.local` holding a fake production token (not committed).
3. On `chore/house-upgrade`: `house.sh upgrade --local --yes .` with the feature toolkit (0.50.0).
   - It ran 18 rungs and 14 commits, then the generators.

## The upgrade, read whole

- **Override reports:** exactly **one**, for the real hand edit: the `firebase:deploy` command, "no record … re-apply
  if it was yours".
  - No false report for `functions:deploy`'s house-changed command. The frozen 0.49.2 evidence works.
  - The hand `inputs` on both deploy targets were kept, and the house inputs were merged in.
- **split-serve-follower:** retargeted both `web-e2e` references to `dev-stack` and logged each one.
- **Angular advice:** one text, from the rung and from `firebase-client`. Both floating entries are named, with three
  choices.
  - After choice 1 (`@angular/fire 20.1.0` + `firebase ^11.8.0`), the generator prints a single info line, "no stable
    @angular/fire for Angular 22 … every upgrade checks again". **Consistent. PASS.**
- **lint-house-apps:** `web` gained `lint` and `eslint.config.mjs`. Nothing needed installing, because
  `angular-eslint` was already present.
  - It emits the deprecated `@nx/eslint:lint` executor, so Nx prints a deprecation warning on every lint.
- **Platform tags:**
  - `shared-browser`, `worktree-domains` and `web-e2e` became `platform:shared`, each reported with its re-classify
    command.
  - **The root `@coach/source` is untagged. PASS.**
- **Dependency order:** `firebase-tools 15.32.1` landed in sorted position. Both blocks are sorted. **PASS.**
- **Formatting churn:**
  - `forwardPorts` stayed on one line, and the firebase targets were not reordered. **PASS.**
  - **Residual:** `close-the-platform-firewall` (adding the tag) re-serialised the hand-written compact
    `apps/web-e2e/project.json` whole, including the untouched `implicitDependencies` (devkit
    `updateProjectConfiguration` in the platform tagger).
- **Stale comments:** the `.gitignore` and devcontainer texts were retold. A `git grep` for proxied, portOffset,
  `--environment staging`, GitHub-driven, predeploy and `continuous` finds nothing stale. **PASS.**
- **Second upgrade:** **empty diff**, `UPGRADE_NEXT: none`, and no "Rewrote" claims.
  - Pre-existing (unchanged since run 1): Nx still prints `UPDATE apps/web/project.json` twice, from the `serve` and
    `serve-options` generators, on a no-op.

## Run-1 items, re-verified one by one

| Item | Result |
| --- | --- |
| B1 `nx run firebase:seed:build` | **PASS.** Exit 0 under Nx, in agent mode and with static output. The world was exported, on its own suite at offset 6000. |
| B2 `dev stop` saves | **PASS.** The user and the Firestore doc were in `.emulator-data-<off>` (twice). Slow path, with the suite SIGSTOPped for 12 s: `dev stop` printed `…exporting … (5s)`, `(10s)`, then "ports free"; the data was there. The `stopping — exporting…` / `done in 1s` lines appear in the emulators task log. |
| B2 Ctrl+C saves | **PASS.** SIGINT to the serve's process group: nx exited 130 in 1 s, printed `[emulators] saving emulator data in the background — dev ps shows it FINISHING`, `dev ps` showed `exporting`, and the data was saved. Direct `tools/dev/dev serve` + Ctrl+C printed `[serve] emulators: exported to …`, and the data was saved. |
| D3 dead stack | **PASS.** No Java: `nx serve` exit **1**, `3 tasks: 1 succeeded, 2 failed`. The FAILED block names Java. (The banner still printed `[serve] Up:` before the crash.) |
| D6 preflight non-TTY | **PASS through a pipe and through `>>`.** **FAIL through a plain `> file 2>&1`**: the refusal's first lines are overwritten by Nx's summary, and only the last 3 lines survive. Cause: the verdict is written to the invoker's stderr opened `O_APPEND`, but Nx's own fd is not append, so Nx writes over it at its own offset (`executors/_utils/invoker.ts`). |
| D9 Firestore websocket | **PASS.** 44737 at offset 35587, and 15150 for the seed suite. |
| Angular advice and floating entries | **PASS** (see above). |
| Lint and firewall | **PASS.** `nx lint web` is clean. Adding `import 'firebase-admin/app'` to the web app fails with `A project tagged with "platform:web" is not allowed to import "firebase-admin/app"`. |
| Root project not tagged | **PASS** |
| Churn and sorted dependencies | **PASS**, apart from the compact project.json re-serialisation above. |
| Stale comments | **PASS** |
| `deploys` notice | **PASS.** On the work branch: "…this branch's copy already has the object form…; it resolves when this branch lands on development. Nothing else to do", and `describe` refuses the same way. On `development`: "replace it … Run the house upgrade". |
| Deploy road | **PASS.** `nx run-many -t deploy --project=x` with no login: Firebase's error, then "This machine has no Firebase login: step 1", then the six-step road. `firebase:deploy` with no rules declared says so and points at `firebase init`. Step 2 is ticked whenever `--project` is passed, even with no `.firebaserc` (arguable: the value may be a project id). |

## Everything else

- **Offset serve:** fully shifted. Auth signUp and Firestore REST writes work through the app origin.
- **Second serve:** a second `nx serve --port-offset=<other>` is refused by the preflight. The exit is **130**, not 1.
- **Attach:** a plain second `nx serve` at the same offset attaches with a clear notice.
- **`dev ps` / `dev stop`:** correct handles and port states. `dev stop` never returned before the export finished.
- **Secrets banner:** `INERT — 1 declared (TELEGRAM_BOT_TOKEN)`. The production token value appears nowhere under
  `dist/`, `.emulator-data-*` or `.bespunky/`.
- **Seed applier:**
  - `node tools/seed/build.mjs default` refuses with exit 1 and names the three paths.
  - `apply.mjs` run directly is silent with exit 0, which is fine for a library.
- **Headless Chromium** (after choice 1, with anonymous sign-in added): a UID was returned. `accounts:signUp` and
  `accounts:lookup` went to the app's own origin, with **zero off-origin requests**.

## New bugs

- **NB1 — a clean `dev stop` makes `nx serve` exit 130, and Nx says `dev-stack` was "Stopped before finishing".**
  - Seen 4 of 4 times.
  - The exit record says `code: 0`.
  - Nx 23.3's `handleContinuousTaskExit`: the composer's deliberate **143** is in `EXPECTED_TERMINATION_SIGNALS` with
    no `stoppingReason`, so it becomes `interrupted` → `stopped`, and `didCommandComplete` returns false → 130.
  - Only the order where the follower ends first, and Nx then stops `dev-stack` as `fulfilled`, gives 0. Here, the
    composer's exit wins the race.
  - Expected: exit 0, all tasks succeeded, as FX1 reports. Files: `executors/serve` (the 143) and
    `executors/follow-stack`.
- **NB2 — an attached `nx serve` fails when the stack it follows stops cleanly.**
  - It printed `Task "web:dev-stack:development" is continuous but exited with code 0`, `3 tasks: 2 succeeded,
    1 failed`, `✖ web:dev-stack`.
  - Expected: it ends with that stack's status, which is 0.
- **NB3 (minor) — the attach notice suggests a colliding command.** Asked with `--port-offset=36781` (the running
  stack's offset), it suggests "A second, isolated stack instead: `tools/dev/dev serve web --port-offset=36781`".
  - The attach branch should say `auto`. File: `executors/serve-preflight/executor.ts`, where `second` is built from
    the asked offset.

## New friction

- **D6 partial:** see the table. A background run captured with `> log 2>&1` loses the refusal.
- **A preflight refusal exits 130**, which reads as a Ctrl+C, rather than 1.
- **After Ctrl+C, `.bespunky/run/web@<off>/tmp/node-compile-cache/` is left behind.** The record is gone and nothing
  is running. It is gitignored, so this is clutter.
- **lint-house-apps writes the deprecated `@nx/eslint:lint` executor.**
- **The compact project.json is re-serialised by the platform tagger.**

## Not run, and why

- **`nx run web-e2e:e2e`:** its `dev-stack` dependency has no offset, so it would bind the **default** ports, which
  the developer may be using. I checked its wiring in project.json instead.
- **Container rebuild, a real deploy, and `firebase init`:** no Docker and no credentials.
- **The trigger path:** not exercised.
- **Lockfile:** a reinstall under `--local` needs the packed tarball, because 0.50.0 is unpublished. I installed from
  a scratch `file:` tgz and restored `package.json`. The fixture's `yarn.lock` now points at that tarball.

## Cleanup

- The `hfh-released2` worktree was removed.
- No process has a cwd under `df2b`.
- Two older `firebase emulators:start` processes from `scratchpad/v5` / `scratchpad/e2e` are still alive (PIDs
  657667 and 658681). They are not this run's, and were left alone.
