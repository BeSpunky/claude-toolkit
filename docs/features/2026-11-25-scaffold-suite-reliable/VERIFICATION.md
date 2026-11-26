# Verification — what was run, where, and what it printed

All in the sealed box (4 cores), on the commit named. Full runs of the scaffold suite are in EVIDENCE.md.

## The other suites (item 9) — at 0b8b5d93, after `yarn install --frozen-lockfile` (exit 0)

| Command | Exit | Time | Last line |
| --- | --- | --- | --- |
| `node tools/test-layers/run.mjs` | 0 | 23 s | ok: 113 passed, 0 failed |
| `node tools/test-generators/run.mjs` | 0 | 41 s | ok: 474 passed, 0 failed, 35 skipped (a framework plugin is not installed; `--strict` fails them) |
| `node tools/test-migrations/run.mjs` | 0 | 14 s | ok: 468 passed, 0 failed |
| `node tools/test-branches/run.mjs` | 0 | 95 s | all 55 branch-model tests passed |
| `node tools/test-standing/run.mjs` | 0 | 22 s | (its last check) ok --tsv carries no free text |
| `node tools/test-tips/run.mjs` | 0 | 2 s | all 10 tips tests passed |
| `node tools/test-voice/run.mjs` | 0 | 12 s | 38/38 passed |

The 35 generator cases skipped are skipped, not passed: they need `@nx/js` / `@nx/angular`, optional peers that are
not installed. Every suite ran; none is counted that could not run.

## Each changed test file alone (item 7) — at 0344b373, 2026-11-26T01:11:22Z

| Command | Exit | Time | Checks |
| --- | --- | --- | --- |
| `bash tools/test-scaffold/emulators-stop.test.sh` | 0 | 84 s | 35 ok, 0 FAIL |
| `bash tools/test-scaffold/emulator-reset.test.sh` | 0 | 6 s | 24 ok, 0 FAIL |
| `bash tools/test-scaffold/postgres-launcher.test.sh` | 0 | 9 s | 134 ok, 0 FAIL |
| `bash tools/test-scaffold/supabase-launcher.test.sh` | 0 | 30 s | 153 ok, 0 FAIL |
