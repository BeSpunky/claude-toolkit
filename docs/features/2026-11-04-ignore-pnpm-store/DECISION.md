---
effort: ignore-pnpm-store
status: concluded
concluded: 2026-11-04
summary: The Nx floor's generated .gitignore now ignores .pnpm-store, so it no longer shows in git changes; what runs pnpm was not identified.
tags: [house, gitignore, pnpm]
---

# Ignore `.pnpm-store/`

The user: "We have this ongoing problem with pnpm-store always popping up in git changes."

## What was found (pnpm 12.3.4, in this devcontainer)

- pnpm keeps its store on the project's filesystem so it can hard-link. The repo and `~/.local` are separate mounts, so
  from any SUBFOLDER of the repo (a worktree under `.claude/worktrees/` is one) the store resolves to the top of the
  repo's mount: `/workspaces/claude-toolkit/.pnpm-store/v11`. From the mount root itself it resolves to `node_modules/.pnpm-store`.
- The stray folder's fingerprint (one file, `index.db`; 259 directories) is reproduced exactly by `pnpm install` with
  nothing to fetch, from a subfolder. `--version`, `config list`, `view` and `store path` create nothing; an install
  with a real dependency leaves more files.
- **The caller was NOT identified.** A logging wrapper over the migration, generator, layer and scaffold suites saw only
  `pnpm --version`. The earlier finding, that a package in `node_modules` shells out to pnpm regardless of the launching
  manager, did not hold: Nx's unconditional calls (`pnpm view` fallback, version/config reads) do not create the store.
  Nx Console's bundle names pnpm commands and was not tested. The folder was first created 2026-11-02 12:43 UTC.

## Decision

Ignore it. It is a machine-local cache, the same class as `.nx/cache`, and ignoring it works wherever the caller runs.

Roads not taken:
- **`pnpm_config_store_dir` in the container's env** works (tested), but moves the store off the project's mount, so real
  pnpm consumers should lose hard-linking and fall back to copies. Penalises them to hide an empty folder.
- **`"packageManager": "yarn@…"` in this repo** makes pnpm refuse at the repo and worktree roots (tested), but nested
  folders still run and still create the store, and it could break the unknown caller. The user: "You're saying we
  should add a config that will break installs? always?" Withdrawn.
- **A `pnpm` wrapper forwarding to yarn**: the two take different arguments and it would break real pnpm projects.

## Outcome

Released as `@bespunky/nx-tools` 0.51.5 with `bespunky-house`. Entry is `.pnpm-store`, no slash: the generator's check is
a substring match, and `.pnpm-store/` would have re-added itself beside a project's `/.pnpm-store`, which a fixture caught.

Nothing to migrate: the floor's gitignore step re-asserts on every upgrade. Verified by the self-upgrade on a clone and
`tools/dogfood-consumer`: consumer upgrade from 0.51.3 twice (the second a no-op), `new` for every preset.

Open: the caller is still unknown. A logging `pnpm` wrapper on PATH would find it, if the folder ever starts holding
real packages. Noticed, not changed: the dogfood's default `--released=development` cannot build a consumer while
development's payload version is unpublished, as 0.51.4 was; pass the last published commit.
