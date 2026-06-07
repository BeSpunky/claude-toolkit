# publish-nx-tools

Publishes **`@bespunky/nx-tools`** (the house Nx generators) to npm, so projects can install it as a
devDependency and run the generators — including the reusable-tool extraction generators
(`mark-extractable`, `adopt-extracted`) — natively in their devcontainer.

## Why this exists (Phase 4 distribution)

The generators live as **TypeScript** in the toolkit (`plugins/project-starter/.../assets/nx-tools`).
The scaffold compiles them on the fly and bundles them at scaffold time — but that copy is **pruned on
every `yarn install`**, so the generators aren't runnable in a project afterward.

Fix: publish `@bespunky/nx-tools` and have projects depend on it (the scaffold/repair add it as a
devDep). Nx can't run raw TS from `node_modules`, so the published package ships **compiled JS** — this
script compiles (reusing `compile-generators.mts`) and publishes.

## Usage

```bash
# validate the package without publishing:
tools/publish-nx-tools/publish.sh --dry-run

# real publish (bump the version in assets/nx-tools/package.json first):
tools/publish-nx-tools/publish.sh
```

Runs in Docker (host Node is too old) with your `~/.npmrc` mounted for auth — **you** run it; it needs
your npm credentials (the same ones you publish other `@bespunky/*` packages with).

## Bootstrapping order

1. `publish.sh` → `@bespunky/nx-tools@0.1.0` on npm.
2. New projects get it as a devDep automatically (scaffold); existing projects via `scaffold.sh --repair`.
3. Then `nx g @bespunky/nx-tools:mark-extractable` / `adopt-extracted` work in any project's devcontainer.
