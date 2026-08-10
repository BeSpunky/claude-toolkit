# Migration tests

Run the `@bespunky/nx-tools` migrations against fixture workspaces.

```bash
node tools/test-migrations/run.mjs            # everything
node tools/test-migrations/run.mjs firestore  # only cases whose suite/case name matches
```

Needs the workspace installed (`yarn install`) — unlike the other checkers, the fixtures use `@nx/devkit`'s
in-memory `Tree`, and the migrations themselves reach for the TypeScript compiler API.

## Why it exists

A migration is the only code in this repo that **writes into other people's repositories**, one way, with
no undo beyond a git tag. It runs once, on a machine nobody here is sitting at, against a workspace shape
nobody here has seen — and a migration that writes nothing looks exactly like a migration with nothing to
do. `tools/test-scaffold/run.sh` makes the same argument for the scaffolder's refusals; the ladder had
thirteen rungs and no test between them.

The evidence is not hypothetical. A throwaway version of these fixtures, written while reviewing the
`0.33.0` rung, caught **five** defects that four reading passes had missed:

- a tree walk that entered `.claude/worktrees/` — the house's own convention for feature worktrees — and
  would have silently edited source on an unrelated branch, which `--sync`'s git backup does not cover;
- sibling files written beside a config that did not export what they imported, so the project stopped
  compiling on a bare `nx migrate`, on a partial sync, and in every multi-app workspace;
- an "already migrated" check that matched on identifier *name*, so a project with its own same-named
  provider was skipped, three providers silently dropped, and the run logged as a success;
- an import path derived by suffix match, pointing at files nobody had written;
- a rewrite that stopped at the first call site in a file, leaving a server config without the providers
  it had a moment earlier.

None of those is subtle to a fixture. All of them are invisible to a reader.

## Adding a case

One file in `cases/`, no wiring:

```js
// cases/0.42.0-my-migration.mjs
export default {
  name: '0.42.0 · my-migration',
  ladder: ['0.42.0/my-migration'],          // rungs to run, in order
  cases: [
    {
      name: 'what it should do',
      setup: (tree) => tree.write('apps/web/src/app/app.config.ts', '…'),
      expect: (tree, t) => t.has('apps/web/src/app/app.config.ts', 'expected'),
    },
  ],
};
```

`ladder` may also be set per case, for a rung whose behaviour depends on an earlier one having run
(`0.33.1` is written that way — the real ladder runs `0.33.0` first, and the two interact).

Assertion helpers on `t`: `ok(cond, message)`, `exists`, `missing`, `has`, `hasNot`,
`occurrences(path, needle, n)`, `wired(path, providerFn)` / `notWired(…)` — where *wired* means called on
a line that is not a comment.

**Idempotence is the harness's job.** Every rung is run twice and the case fails if the second run changed
the tree, so no fixture needs to remember it. The claim is per *rung*, not per ladder: re-running a whole
ladder legitimately is not idempotent, because a later rung can create the anchor an earlier one looks for.

**Coverage today is `0.33.0` and `0.33.1`.** The eleven earlier rungs have no cases. Back-filling them is
real work with its own judgement calls about what each should assert — worth doing, deliberately left out
of the effort that built the harness.

## Where it runs

CI, on every push to `main`/`development`/`staging` and on pull requests
(`.github/workflows/migration-tests.yml`).

**Deliberately not in the pre-push hook.** That hook checks a pushed commit by materialising it in a
temporary worktree, which has no `node_modules` — these tests need one, so they would either be skipped
silently (worse than absent) or force an install into every push. The two checkers that hook does run are
dependency-free by design, and that is the property worth keeping.
