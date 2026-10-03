---
effort: scaffold-test-sigpipe
status: concluded
concluded: 2026-10-03
summary: The scaffolder tests stop failing at random — every check that searched captured output through `printf | grep -q` now uses a pipe-free in_text helper.
tags: [tests, scaffolder, ci, flaky]
---

# Scaffolder tests: no SIGPIPE race

CI on `main` failed at `d5f4a72` in `render.test.sh` ("wrapper host renders a Node-project install") with
`printf: write error: Broken pipe`, on a commit that touched nothing the test covers; three local runs passed.

**Root cause.** `printf '%s\n' "$out" | grep -q …` under `set -o pipefail`: `grep -q` exits on its first match
and closes the pipe; if `printf` is still writing it dies of SIGPIPE, and pipefail reports the pipeline as failed
although the text matched. Size- and scheduler-dependent, so random. 45 checks across 7 files had the shape.

**Fix.** `tools/test-scaffold/text.sh` defines `in_text TEXT GREP-ARGS…` (a here-string — no writer to kill);
every racy check uses it, and the README's *Adding a test* names the convention. Display-only pipes
(`| grep -E … | sed`) were left as they are: nothing reads their status.

> User: "yes" — to making the fix, after the failure was reported as pre-existing and flaky.

Verified: the suite passes three runs in a row with the same 322 checks as before the change.
