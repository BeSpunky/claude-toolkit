# BRIEF — the sync never installs `@bespunky/nx-tools`, because it never runs at all

## The report

> "Some projects report that after running our sync, nx-tools don't install the latest version. Fix it"

## What it actually is

`scaffold.sh` **dies at render time**, before a single command of the sequence it assembles is executed.
Exit code 127, on `--sync` *and* on a fresh scaffold. Nothing is installed, nothing is migrated, nothing is
stamped — so `node_modules/@bespunky/nx-tools` keeps whatever version the project already had. From the
outside that is indistinguishable from "the sync ran and didn't update the tooling", which is how it was
reported.

Reproduction (any project, any mode):

```
$ bash scaffold.sh --sync --yes --print-inner <project>
Package manager: yarn (this project declares none — using the house default)
Node v22.23.1 is new enough — running the generators natively (no Docker).
scaffold.sh: line 1450: agent: command not found
scaffold.sh: line 1450: @: command not found
scaffold.sh: line 1450: retire-inline-house-sections: command not found
scaffold.sh: line 1450: --layers: command not found
rc=127
```

## The cause

Four **unescaped backticks** in prose comments inside `WORKSPACE_GEN_BLOCK` — the double-quoted string that
renders part of the inner program. Introduced by `66a4449` (*"feat(project-starter)!: house docs reach every
project, not only ones wanting the tooling"*), which ungated the `house-doc` generator and wrote a long
explanatory comment above it:

```
#     UNGATED, and that is a deliberate change from being part of the `agent` layer. HOUSE.rules.md is the
#     mechanism by which the house directives reach a session at all — CLAUDE.md `@`-imports it, which is
#     It also left a migration permanently unable to run: `retire-inline-house-sections` deletes the frozen
#     `--layers` supports, so a markdown repo is not told which port not to bind). That gating is the reason
```

Inside a double-quoted string a backtick is **command substitution, evaluated now, at render time — even
inside a `#` comment**. So the render runs `agent`, `@`, `retire-inline-house-sections` and `--layers` as
commands. Each fails with 127, the assignment inherits that status, and `set -euo pipefail` (line 74) kills
the script.

`scaffold.sh` documents this exact hazard, at length, immediately above the block (*"Rule of thumb: inside
these blocks write comments in plain prose with no backticks…"*) — and every neighbouring comment in the
same string escapes its backticks (`` \`app\` ``, `` \`installPackagesTask\` ``). The rule was known; the
commit simply didn't follow it, and nothing was watching.

## Blast radius

`66a4449` is on **`main`**, so this is not an in-flight regression — it is the released behaviour:

| branch | plugin | payload | carries the defect |
| --- | --- | --- | --- |
| `main` / `staging` | 0.27.0 | 0.27.0 | yes |
| `development` | 0.28.0 | 0.28.0 | yes |

Published `@bespunky/nx-tools` is `0.27.0`, which agrees with `main` — **npm is not the problem, and no
release is missing.** Every consumer on project-starter 0.27.0 has a scaffolder that cannot run.

## What is actually being fixed

The four backticks are the defect. The **root cause is that this file's most dangerous class of bug has no
guard.** `scaffold.sh`'s product is a ~300-line shell program assembled out of nested double-quoted strings;
a stray backtick there is live code, the file says so in its own comments, it names the verification
(`--print-inner`, *"ANY stderr during rendering means something in a string was evaluated"*) — and that
verification had to be run by hand, by someone who remembered to. It has bitten this file "repeatedly", by
its own account.

So: escape the backticks, **and make the render itself a test** in `tools/test-scaffold/`, which already runs
in CI and on the pre-push hook. See [[DECISION]].
