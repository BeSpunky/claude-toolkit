---
effort: house-docker-open-items
summary: close the five items house-docker-pm left open — a chown failure losing the report, yarn 2+ without yarnPath, the rolling :24 image, a stale versions.ts comment, and a devcontainer dying on a package manager its image lacks
---

# Decisions made before dispatch

The user: "Send agents to fix those open items". Read `docs/features/2026-11-02-house-docker-pm/` first.

- **D1 chown after a good run.** Keep the run's report; exit with the chown's code; say how to repair ownership. A completed run is never reported as if it had not happened.
- **D2 declared yarn the image cannot honour.** Refuse up front on the fallback, before the lock, with the native route. Yarn 1 only dispatches to a project's yarn through `yarnPath`.
- **D3 rolling `:24`.** A weekly real-image check beside the other upstream checks, not a digest pin: a pin stops security updates and still leaves the devcontainer on the rolling tag.
- **D4 stale comment.** Corrected in the payload release D5 owes anyway.
- **D5 devcontainer without the project's package manager.** Fixed in the payload, for any package manager and any image, not for yarn on 26 alone.

## What D5 settled, and the roads not taken

One script, `house.package-manager.sh`: the exact declared version, else the first `PACKAGE_MANAGER_PINS` entry that fits, never a float. It runs as a soft-failing image layer with what `package.json` said at the last upgrade, and again in post-create with what it says that day. Rejected: corepack (Node 25+ no longer ships it, and images differ), and widening the build context to `package.json` (it would rebuild the layer on every dependency change).

This supersedes 2026-11-02's "Still open": the devcontainer half is closed. Moving `HOUSE_NODE_MAJOR` past 24 still has to answer where the fallback's own yarn comes from.

**Nothing to migrate.** Everything new is an owned artifact a generator re-asserts on every upgrade, owned or adopted. An adopted `post-create.sh` the generator leaves alone simply does not run the script, as it did not before. One behaviour to say in the release note: a declared old version is now honoured, so `npm@9` replaces the image's npm.

## Corrections from the sanity review (2026-11-04)

- **`HOME=/home/node` broke every uid but the image's 1000** (a GitHub runner, a Mac). It is `/tmp` now, behind `CONTAINER_HOME` / `container_run_program`, which house.sh, extract-tool, publish.sh and check.sh all run through, so a check answers for the program by construction. This predates the effort and would have turned its new e2e job red on the first run.
- **D2 reached further than it was written.** Yarn 1's real rule is `/^yarn@[01]\./`, so `yarn@1`, `yarn@stable` and `yarn@^4` passed the major comparison and failed at install, and `yarn@0.28.4` was wrongly refused. A yarn 2+ repo with no declaration passed too, and yarn 1 rewrote its lockfile to v1 with exit 0. The same check now runs natively, against the host's yarn asked from inside the project, because the route the refusal recommends has the same hole. That is an extension of D2 past "on the fallback", taken under "every known instance in the same release".
- **The installer** no longer runs lifecycle scripts (with `--force`, a failing one left the replaced bin dangling), and as root hands what it installed to the prefix's owner, so post-create can replace it.
- **Yarn's `isYarnBerry`** is one function now, used by the CI generator too, whose copy gave yarn 1 with a `.yarnrc.yml` `--immutable`, which yarn 1 ignores, so that install was not frozen. Nothing to migrate: the deploy workflow is rewritten on every upgrade.
- **P1 closed: the deploy workflow's corepack is pinned too** (`COREPACK_VERSION`, 0.36.0). `npm install -g --ignore-scripts corepack@<pin>` then `corepack enable`, in both jobs, after setup-node and before the first use; setup-node has no `cache:`, so nothing needs the package manager earlier. On every Node, not branched on the major: run on real tarballs of 18, 20, 22, 23, 24, 25 and 26, it overwrites a bundled corepack and resolves yarn 1, yarn 4 and pnpm, and on the Nodes its `engines` leave out npm only warns (a project `.npmrc` with `engine-strict` does not reach a global install, also observed). Corepack stays right here though D5 rejected it for the devcontainer: D5's objection was to relying on what an image ships, and a declared `packageManager` is what this job must honour exactly. Scripts off because deploy holds `id-token`. Nothing to migrate: the workflow is rewritten on every upgrade. Unobserved: a real GitHub runner.

## What the first real Docker run showed (2026-11-04)

GitHub run 41794445331, uid 1001, the real `typescript-node:24`. The image check passed and `HOME=/tmp` was writable, but `yarn create nx-workspace` died with `Cannot create "/usr/local/share/npm-global/bin/create-nx-workspace" due to insufficient permissions`: the image's global prefix belongs to uid 1000 too, the same bug as `HOME`, which no fake docker could show. Reproduced with real yarn 1.22.22 and an unwritable `NPM_CONFIG_PREFIX`; a writable one gets through. `container_run_program` now sets it beside `HOME`.

The same run corrected a claim: `:24` holds node 24.22.1, yarn 1.22.22, corepack 0.36.0 and **pnpm 12.15.0**, in `/usr/local/share/npm-global/bin`. The earlier note that it has no pnpm was wrong.

## A generated devcontainer on a real image (2026-11-04)

`tools/check-runner-image/devcontainer.sh`, in its own workflow `devcontainer-image-e2e.yml` (weekly, by hand, and on pushes to any branch touching the templates, `compose.ts`, `versions.ts` or `package-manager.ts`). Six cases: Node 24 and 26 on yarn 1, Node 24 and 26 on an exact pnpm of the 10 line, Node 24 on an exact yarn 4 with no `yarnPath`, Node 26 with only a versionless `yarn.lock`. One project made with `new --local --preset=node`, mutated and regenerated per case, built from the generated Dockerfile and context. The build log's installer lines are read rather than the Dockerfile's soft-fail changed.

**Observed: not on a real image; there is no Docker here.** With a local stand-in for `docker` that ran the real generated installer and post-create sections against a sandboxed prefix, every assertion held except the two a host cannot satisfy (HOME, and "the layer installed yarn" where the host already has it). Root, the hand-back, the image's PATH and its real package managers remain unobserved until the first run.

**That stand-in found a false green in the check itself.** `check "… $(x) …" $?` passes the status of `$(x)`, because arguments expand left to right, so every assertion was green. `check` here takes the status first. `e2e.sh` had the same defect on one line: its "everything belongs to this uid" check, the one thing only a real engine can show, could never fail, because of the `$(id -u)` in its message. Fixed. Its past greens on that line prove nothing.
