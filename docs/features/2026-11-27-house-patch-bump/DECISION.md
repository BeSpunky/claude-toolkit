---
effort: house-patch-bump
summary: Release the unreleased postgres/supabase template changes (bespunky-house 0.54.3, nx-tools 0.56.2) so the release-invariants check, and the stuck task 273e, go green.
---

# House patch bump — bespunky-house 0.54.3, @bespunky/nx-tools 0.56.2

## Why

`node tools/check-release-invariants/check.mjs` exited 1 on `development`: `13362013` ("fix(test-scaffold): wait for what a case
reads, and say ready only once it is said") changed two payload templates after the 0.56.1 / 0.54.2 release and bumped neither.
That kept `yarn test` red and blocked Zanshin task `273e`. Shy approved the bump: "Yes, land the bump".

## The migrations question — nothing to migrate

The change is `postgres/files/server.mjs.tpl` (a new exported `declareReady(stackDir, lines)`: announce, then write the ready
marker) and `supabase/files/supabase-keeper.mjs.tpl` (calls it instead of writing the marker before its announcement).

- Both are **class A, owned template artifacts**: `generators/postgres/generator.ts` writes every `LAUNCHER_FILES` entry
  (`server.mjs` included) and `generators/supabase/generator.ts` every `SUPABASE_LAUNCHER_FILES` entry (`supabase-keeper.mjs`
  included) with an unconditional `tree.write` on every run, so every upgrade of a project wearing the layer replaces them whole.
- The new import (`supabase-keeper.mjs` → `declareReady` from `server.mjs`) is satisfied in the same run: `supabase` requires
  `postgres`, whose generator rewrites `server.mjs` too.
- Nothing on disk changes shape — no target, path, config key, declaration or project-state file is renamed, moved or retired;
  the ready marker's name and content are unchanged.

So no rung is owed. The root `package.json` pin (`@bespunky/nx-tools` 0.56.1) is this repo's own consumer install of the
released payload and moves with its next self-upgrade, as at the 0.56.1 bump (`41d2aa3`).

## Verification, 2026-11-27, on the host (Ubuntu 26.04 "resolute", not the devcontainer)

- `node tools/check-release-invariants/check.mjs` → exit 0 (11 plugins, payload 0.56.2).
- `yarn test` → exit 1. Passed: every suite but four. Failed, each on something this host lacks, not on the bump:
  `test-postgres` (exit 2: no Postgres closure for this Debian-less host), `test-supabase` (3 of 160: `psql` not on PATH),
  `test-angular-ts-solution` (`create-nx-workspace` could not resolve `@nx/workspace:preset` under npm 11.19),
  `test-scaffold` (1 FAIL, "kill: the suite's own export lines streamed through"; a re-run alone passed all 30 files: flaky).
- `yarn nx test bespunky-house`, `yarn nx run-many -t test` → exit 1 before running: Nx's lock file under the main checkout's
  `.nx/workspace-data` is root-owned (EACCES). Their suites are the same ones as above.

Not landed: the four commands were the condition. They need the devcontainer (or wherever `273e` runs) to go green.
