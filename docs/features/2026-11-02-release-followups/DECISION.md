---
effort: release-followups
status: concluded
concluded: 2026-11-03
summary: Shipped nx-tools 0.51.2 so a house library's test, build and lint tell the truth from birth and after upgrade; ruled out passWithNoTests on @nx/angular:unit-test, which has no such option.
tags: [nx-tools, angular, testing, migrations, dogfood]
---

User: *"Send an agent for each"*, of the open list after 0.51.1.

Decided before dispatch: `nx test design-system` gets `passWithNoTests` — a library with no specs yet has nothing to fail, and the flag stops mattering the day a spec is added. Agents never bump a version or land; the session does, so two payload branches cannot collide on one version.

## 2026-11-02 — superseded before landing

`passWithNoTests` (above) was tried and does not exist: the `@nx/angular:unit-test` schema refuses it. User, on the outcome: seed a real DsTheme spec at creation only, plus a 0.51.2 rung adding it to existing design systems, skipping and reporting no test target, another executor, own include/exclude, any existing spec, DsTheme missing or reshaped. Creation only, because an upgrade must not bring back a spec a project deleted, or add one its reshaped library cannot pass.

## 2026-11-03 — outcome

User, on the review's four findings: *"yes"* (fix all in this release), under the standing rule that known gaps ship together.

- **`ds-component` built nothing:** `secondary-entrypoint` handed @nx/angular a directory where it wants a file. Fixed; no repair rung, a stray `src.ts` is warned about.
- **Specs outside `<lib>/src` never ran,** a false green. Every Angular library now states an include and exclude at birth; `secondary-entrypoint` ensures it for a library the port did not make; rung `truthful-angular-library-tests` brings existing ones along and names the specs that start running.
- **Libraries the house strips of their only spec:** a real DsTheme spec for the executor with no such option; `passWithNoTests` for Vitest and Jest (`pass-libraries-with-no-specs`). A shim on `@nx/angular:unit-test` with no spec loses its target; shims on disk keep the warning, because they cannot be told apart.
- **Dogfood gate:** the `brand-lib` seed runs `nx sync` instead of a hard-coded tag; the gate now also tests and exercises `ds-component`.
- **`adopt-extracted`:** `--version` never reached the generator, because Nx takes the flag: renamed `--packageVersion`, no alias. A kept shim passes its own lint.
- **House rules:** no blanket `git worktree prune`, from `standing-sees-branches`.

Left, knowingly: the Angular 20 road on Nx 24 was not run; `tsconfig.lib.json` also reaches a `dist` inside the library, pre-existing and never seen failing; a Jest library's entry specs are in no TS project, editor-only and unobserved; one tripwire run failed beside a concurrent job and passed alone, cause unknown.

Verified at 0.51.2 in a scratch clone: dogfood 78 passed, 0 failed; this repo's self-upgrade from 0.49.0, whole diff read; tripwire alone exit 0.
