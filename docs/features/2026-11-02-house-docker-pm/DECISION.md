---
effort: house-docker-pm
status: concluded
concluded: 2026-11-02
summary: the Docker fallback runs on HOUSE_NODE_MAJOR instead of the newest image, checks for the package manager up front, and a dead run reports itself
tags: [house, docker, package-manager]
---

# The Docker fallback no longer depends on what MCR published last

**The bug.** On a host with no usable Node, `house.sh new --preset=angular` printed `env: 'yarn': No such file or directory`, then `chown: cannot access '/work/<project>'`, and exited 1 with no project. `base_image_node_major` picked the newest `typescript-node` major, now 26, and that image has no yarn and no corepack (24 has yarn 1.22.22). The `chown` hid the real failure: it ran under `set -e` on a tree that did not exist, so the script died there, before its failure report.

## Decisions

**Choose the image, not patch it: the runner is `HOUSE_NODE_MAJOR`.** It is read from `nx-tools/src/generators/_utils/versions.ts`, shipped beside the engine, so there is one source. Installing yarn into whatever image is newest would have fixed only today's symptom:
- the toolchain would still float with Microsoft's publishing, and "nothing floats" is the house rule;
- a scaffold would run on a Node other than the one its project gets (`.nvmrc` is seeded from the same constant);
- yarn 1 enforces `engines` strictly, so a newer runner adds a way to fail, and it gains nothing a generator needs.

It also removes the MCR call and the `curl` requirement from both launchers (`house.sh`, `extract-tool`).

**The check is on the host, after `--print-inner` and before the lock.** `container_require_command` asks the image the way the program will run it (same user, same login shell). Nothing has been written at that point, and a dry render still pulls no image. It tells "has no yarn" (exit 1) from "could not run the image" (docker's 125 and up).

**A dead program keeps its own exit code.** The chown runs only if the tree exists, and a failed chown ends a run only if the run had otherwise succeeded. The GitHub step is skipped after a failure: before this it would have pushed a half-built scaffold. `new` now reports `NEW_FAILED` (matching `NEW_OK`) instead of an upgrade's migration and restore advice.

## What the generated project gets

`MAJOR` does not reach the project, and has not since nx-tools 0.50.0: the devcontainer reads the project's Node file. Checked on the Docker-path scaffold: `.nvmrc` is `24`, `house.Dockerfile` is `FROM typescript-node:24`, `packageManager` is `yarn@1.22.22`. That image has yarn, so `post-create.sh` works.

**Still open: a yarn project that declares Node 26.** Its devcontainer builds on `typescript-node:26`, and `post-create.sh` runs `yarn install` under `set -euo pipefail` with no yarn there. This is payload work, so it needs an nx-tools release and dogfooding, and is left out of this change. `npm install -g yarn@1.22.22` works as the `node` user on that image, so the fix is available. **It must land before `HOUSE_NODE_MAJOR` moves past 24**, because that move would bring the problem to every new project and to this runner (where it would now stop at the up-front check).

## Verification

- Docker path, real images, no Node on the host, throwaway `PROJECTS_DIR`: `house.sh new --local --preset=angular dockerpm-e2e` reached `NEW_OK` on `typescript-node:24`. `--local` was needed because `@bespunky/nx-tools@0.51.0` is not on npm; without it the run reached the install and stopped with `NEW_FAILED`.
- Real `typescript-node:26` (a copy of the engine with the constant changed): one clear error, exit 1, nothing written, no `chown`.
- `tools/test-scaffold/docker-fallback.test.sh` covers the above against a fake `docker`. Run against the old engine it fails 21 assertions.

## Corrections from the sanity review (2026-11-03)

- **A third launcher.** `tools/publish-nx-tools/publish.sh` floated on the newest image too, with its own copy of the lookup. It now takes the same function, so "both launchers" above is three. `extract-tool` also checks for yarn up front, because `extract-tool.mjs` runs `yarn nx g`.
- **"No longer depends on what MCR published" is true of the major, not the contents.** `:24` is a rolling tag. If it loses yarn, the up-front check says so, but nothing catches it earlier.
- **The open gap is wider than yarn on 26.** The devcontainer's unguarded install dies on any package manager its image lacks. `pnpm` on `:24` was not checked. On the fallback, a project whose package manager the image lacks now stops at the check with `UPGRADE_REFUSED: runner-image`.
- **"Runs on the Node its project runs on" holds for `new` only.** An upgrade on the fallback runs on `HOUSE_NODE_MAJOR` whatever the project declares, so yarn 1's strict `engines` can stop a project that excludes it. This is not worse than before, when the runner had no yarn at all.
- **The check is presence, not usability.** `packageManager: yarn@4` without a `yarnPath` passes it and then fails on yarn 1.
- **The Docker verification above predates the rebase.** It used `--local`, so the registry path has not reached `NEW_OK` on this base.
