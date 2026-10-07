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
  would have silently edited source on an unrelated branch, which an upgrade's git backup does not cover;
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

**Order within one version is a contract this suite states.** Rungs of the same version run in
`migrations.json` file order — held only by V8's stable sort under Nx's `lt(a, b) ? -1 : 1` comparator, not by
any Nx guarantee. So where one rung creates input another reads, a cross-rung case reads the order straight out
of `migrations.json` and proves it in one run, with the reasons in its header: `cases/0.50.0-ladder-order.mjs`.

Assertion helpers on `t`: `ok(cond, message)`, `exists`, `missing`, `has`, `hasNot`,
`occurrences(path, needle, n)`, `wired(path, providerFn)` / `notWired(…)` — where *wired* means called on
a line that is not a comment.

**Idempotence is the harness's job.** Every rung is run twice and the case fails if the second run changed
the tree, so no fixture needs to remember it. The claim is per *rung*, not per ladder: re-running a whole
ladder legitimately is not idempotent, because a later rung can create the anchor an earlier one looks for.

**So is honesty.** A second run that changed nothing must not *claim* a change — and the harness does not guess
which verbs mean "changed" (a verb list once matched none of the lines the 0.50 ladder logged). Every `info`
line from a no-op re-run fails the case, except the forms listed in `REPORTED_EVERY_RUN` in `run.mjs`, each with
its reason: the layout resolver's inference, and a leftover the rung reports on every run (`Left … alone`,
`— left as is`). Warnings are reports by definition and are not checked. The log is reset per ladder run, so a
case's `expect` (and a diverging shape's) sees only what its own run reported.

**Historical shapes converge — or say why not.** Idempotence re-runs a rung on its *own* output, so it cannot
catch an "already current" guard keyed on one marker of the new shape and fooled by an intermediate shape an
*earlier* release wrote (0.24.3 judged a 0.7.1-repaired interface current because every member had `default:`,
and it never got `proxied?`). So a case may list the same input as earlier toolkit versions really shipped it —
taken from git, sha named:

```js
historicalShapes: [
  { name: '0.7.1 repair (abc1234)', setup: (tree) => … },                 // must land byte-identical to `setup`'s result
  { name: 'pre-0.12 scaffold', diverges: 'why it legitimately ends elsewhere', setup, expect }, // reason printed
],
```

The harness runs the ladder on each (idempotence and parsing checked as usual) and fails unless the whole tree is
identical to the canonical case's. A shape that declares `diverges` but converges anyway fails too, so a stale
reason cannot outlive the fix that made it untrue. Whenever a rung skips "already migrated" input, list every
shape that carries the marker it skips on.

**Coverage today is `0.33.0`, `0.33.1`, `0.34.0`, and `0.24.0`'s `unify-serve-targets`** (back-filled for the
`host`-stripping fix). The other earlier rungs have no cases. Back-filling them is
real work with its own judgement calls about what each should assert — worth doing, deliberately left out
of the effort that built the harness.

## Where it runs

CI, on every push to `main`/`development` and on pull requests
(`.github/workflows/migration-tests.yml`).

**Deliberately not in the pre-push hook.** That hook checks a pushed commit by materialising it in a
temporary worktree, which has no `node_modules` — these tests need one, so they would either be skipped
silently (worse than absent) or force an install into every push. The two checkers that hook does run are
dependency-free by design, and that is the property worth keeping.
