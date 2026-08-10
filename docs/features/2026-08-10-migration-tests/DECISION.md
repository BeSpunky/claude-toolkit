---
status: concluded
concluded: 2026-08-10
summary: Built tools/test-migrations — a fixture harness that runs the compiled migration rungs against
  in-memory @nx/devkit workspaces, asserts idempotence per rung for every case automatically, and covers
  0.33.0 and 0.33.1 with the thirteen cases that had proved their worth as throwaways.
tags: [migrations, testing, tooling, nx-tools, ci]
---

# Decisions — a fixture harness for the migrations

## It runs the COMPILED payload, not the source

`nx migrate` loads migrations as JavaScript out of `node_modules`, transpiled by
`assets/compile-generators.mts`. So the harness compiles the payload with that same script and imports the
result. Testing the TypeScript source directly would have been simpler and would have left the transpile
step — the one thing standing between what is written here and what consumers execute — untested.

**The build has to land inside the repo**, and this is the trap worth recording. The migrations reach for
the TypeScript compiler API with a bare `require('typescript')`, resolved from the compiled module's *own*
location. Compile to `os.tmpdir()` and that resolution walks up to `/` and finds nothing — so every
AST-based migration silently takes its "no TypeScript here" branch and **the suite passes while testing
almost nothing**. `node_modules/.cache/` keeps resolution inside the repo, where `typescript` and
`@nx/devkit` are.

That is also why `typescript@^5` is now a devDependency. Pinned to 5 deliberately: `typescript` on npm now
resolves to the 7.x native port whose main entry no longer exposes the classic compiler API, which
`_utils/typescript-api` already documents and probes for.

## Idempotence is the harness's job, not each fixture's

Re-running a rung immediately after itself must change nothing. That is a property of *every* migration, so
the runner asserts it for every case — run the rung, snapshot, run it again, fail if anything moved — rather
than hoping each fixture remembers.

**Per rung, not per ladder**, and the distinction is not pedantry: re-running a whole ladder legitimately is
*not* idempotent. `0.33.1` wires an anchor that `0.33.0` looks for, so running `0.33.0` again afterwards
does more work — correctly. The first version of the throwaway suite asserted whole-ladder idempotence and
reported a failure that was not one.

## Not in the pre-push hook

The hook checks a *pushed commit* by materialising it in a temporary worktree, which has no `node_modules`.
These tests need one. The options were to install into every push, or to skip silently when the modules are
missing — and a check that silently skips is worse than one that is absent, because it reads as green. The
two checkers that hook does run are dependency-free by design; that property is worth keeping intact. CI
carries this one.

## Scope: the harness, plus the two newest rungs

Thirteen cases, ported from the throwaway suite written while reviewing `0.33.0` — each one a defect that
actually shipped in review, named after what it is guarding:

- another git worktree, `dist/`, and a nested checkout are left untouched;
- the root config is rewritten alongside its siblings (they import symbols only it exports);
- import paths are computed, including for a call site in a subfolder;
- a name collision is reported rather than wired;
- every call site in a file, not just the first;
- an app at the workspace root is found at all;
- a hand-wired provider is left alone, wherever the project put it.

**The eleven earlier rungs have no cases.** Back-filling them is real work with its own judgement calls
about what each should assert, and folding it in here would have buried the harness inside a sweep. Adding
one is now a single file in `cases/` with no wiring, which is the point.

## Verified

The harness was made to go red before it was trusted: a deliberately false assertion produced `FAIL`, the
failing expectation, and exit code 1. On the real cases: 13 passed, 0 failed, with the captured migration
log printed only under a failing case — several of these rungs do nothing *but* report, so silencing their
output would have thrown away the fastest explanation of a failure.
