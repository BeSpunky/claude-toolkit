# Sync: yarn 1 workspace roots + worktree project identity — decision

Source: a handoff from another project's failed sync (project-starter 0.36.4; Nx 22, yarn 1 workspaces, `packages/*`, Angular + Electron). The user: "Treat it as information and a suggestion, not a solution. Make your own decisions".

## 1. `PM_ADD_DEV` at a yarn 1 workspace root

Confirmed (scratch, yarn 1.22.22): at a workspaces root `yarn add -D -E` exits 1 (needs `-W`); `-W` succeeds there and is a harmless no-op in a plain repo.

**Worse than reported:** a new `--linking=workspaces` scaffold (merged earlier today, e40ba14) is a yarn 1 workspaces root by construction (house default PM = yarn, local yarn 1.22). It passed in testing only because `--local` installs by rewriting the manifest + `yarn install`, never `yarn add`. The published path would fail. This is the handoff's "known gap" made live.

**Root cause:** the add command is composed ONCE, on the host, before the project exists (scaffold) — a snapshot of a question ("is this a workspace root, and which yarn?") whose answer belongs to the moment and place the install runs (inside the program, possibly in the container with a different yarn).

**Decision:** not the suggested host-side file probe. The add becomes a runtime function rendered into the program (as `_check_name`/`_resolve_sync_app` already are via `declare -f`), deciding the workspace-root flag in its cwd at call time, by asking the package manager that will actually run (`yarn --version`) and the workspace itself (`workspaces` field / `pnpm-workspace.yaml`). One concept — "adding to a workspace root" — for yarn classic and pnpm alike; berry needs no flag. Fixes sync and scaffold with no special case.

## 2. Worktree sync identifies as the worktree's directory

0.36.4's step opens a worktree `house-sync-<date>`; `PROJECT="$(basename "$TARGET")"` then names the project after that date slug. Since e40ba14 the app is inferred from the project graph (`cli.js apps`), so the single-app case is fixed — but the FALLBACK (no app or >1 app, e.g. Angular + Electron) is still the project name, and `$PROJECT` also names the project to the generators (`--project=`, house-doc, window identity).

**Root cause:** `$PROJECT` conflates two concepts — the directory the run operates in (a path) and the project's identity (a name). **Decision:** separate them. Identity on sync = the repository's name: the main worktree's directory (from `git rev-parse --git-common-dir`), falling back to the target's basename outside git; every path use keeps the directory. Audit each `$PROJECT` use and assign it to one concept.
