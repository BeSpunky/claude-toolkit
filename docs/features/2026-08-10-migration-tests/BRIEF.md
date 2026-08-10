# Brief — migrations have no regression test

*Opened 2026-08-10. Slug `migration-tests`.*

## Where it came from

The `firebase-bootstrap-split` effort shipped two migrations. Four adversarial review agents then found
eleven defects in them, and a throwaway fixture suite written during that review — an `@nx/devkit` `Tree`
carrying a git worktree, a `dist/`, a nested checkout, a name collision, a subfolder call site, two
providers arrays in one file, and an unwired app — **caught five of them**. That suite lived in a scratch
directory and was deleted with the session.

Its own `DECISION.md` recorded the gap:

> *"There is no regression test for migrations. … The house already has `tools/test-scaffold/run.sh` for
> the scaffolder's silent-regression guards; migrations deserve the same."*

## Why migrations specifically

A migration is the highest-risk code this repo ships and the only code here that **writes into other
people's repositories**, one way, with no undo beyond a git tag. Everything about how it fails argues for
a harness:

- **It runs once, somewhere else.** Nobody here ever sees it run against a real project of the shape that
  breaks it. The five bugs the fixtures caught were all of that kind — a second git worktree inside the
  workspace, a multi-app workspace, a project with its own same-named provider.
- **Its failures are silent by construction.** A migration that writes nothing looks exactly like a
  migration with nothing to do. One of the eleven reported *"already wired"* and exited zero while
  silently dropping three providers.
- **It cannot be tested by running it.** There is no application here to migrate. The only way to exercise
  one is to construct the workspace shape it will meet, which is precisely what a fixture is.

`tools/test-scaffold/run.sh` already makes this argument for the scaffolder's refusals — *"a gate that
stops refusing looks exactly like a gate with nothing to catch."* The same sentence is true of a migration,
and the ladder has thirteen rungs with no test between them.

## Scope

Build the **harness**, and cover the two newest rungs with it (`0.33.0`, `0.33.1`) by porting the fixtures
that already proved their worth. Adding a case for an older rung must then be cheap — one file, no wiring.

Explicitly **not** in scope: back-filling cases for the eleven earlier migrations. That is real work with
its own judgement calls about what each one should assert, and folding it in here would bury the harness
inside a sweep.
