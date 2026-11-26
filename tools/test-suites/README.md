# tools/test-suites: the one test command

`yarn test` runs `node tools/test-suites/run.mjs`. It runs every suite in `suites.json` whose needs are met, one at a
time, prints each suite it skipped with the need that was not met, and fails when a suite failed or when nothing ran.

```
node tools/test-suites/run.mjs                      run everything that can run here
node tools/test-suites/run.mjs --project=<project>  only that Nx project's suites
node tools/test-suites/run.mjs --list               print what would run (`run:`) and be skipped (`skip: ... needs:`), run nothing
node tools/test-suites/test/run.mjs                 the runner's own test (fixture lists, plus one coverage case on the real repo)
```

Exit 0: no suite failed and at least one passed. Exit 1: a suite failed, or nothing ran (an empty selection, or every
suite skipped: a skip is never a pass). Exit 2: the list is unreadable or malformed, or the arguments are wrong.

The summary prints each failed suite as `  failed: <name>` and nothing else on such a line; a suite's own output is shown
with a `  | ` prefix so it can never look like one. Skips print as `  skipped: <name> (unmet need: <need>: <what was observed>)`.

## The list: `suites.json`

The only place a suite is declared. The runner, `--list`, `--project` and the test all derive from it.

- `needs`: the needs a suite may name and how each is judged (`probe`: a command run from the repo root, exit 0 means met;
  `null` means nothing to observe; `never` means the need is not met by this runner, with the reason).
- `suites[]`: `name`, `dir` (its directory under `tools/`), `command` (argv, run from the repo root), `project` (the owning
  Nx project, one of `yarn nx show projects`), `needs` (any of `none`, `workspace`, `network`, `docker`).
- `excluded[]`: directories that look like suites but are not, each with its reason (`tools/test-support`).

Add a suite: one entry. The runner's test fails when a `tools/test-*` (entry `run.*`) or `tools/check-*` (entry
`check.*` or `test.*`) directory is neither declared nor excluded, so a suite cannot be forgotten.

## How a need is judged met (observed on every run, never assumed)

| need | met when | by |
|---|---|---|
| `none` | always | nothing to observe |
| `workspace` | `node_modules/.bin/nx` and `node_modules/@bespunky/nx-tools` exist (what `yarn install` leaves) | `probes.mjs workspace` |
| `network` | the npm registry (`registry.npmjs.org`) answers an HTTPS request now, through `HTTPS_PROXY` when set | `probes.mjs network` |
| `docker` | never: Docker-only checks are declared so they are named, and always skipped as out of scope | `never` in the list |

The runner's test covers each: fixture lists with probes that fail or pass, and the real probes against the real box.
Suites run one at a time because `test-voice` and `test-scaffold` are not safe side by side.
