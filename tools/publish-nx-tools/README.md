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

# npm 2FA on the account? pass a one-time code:
tools/publish-nx-tools/publish.sh --otp 123456
```

**You** run it; it needs your npm credentials (the same ones you publish other `@bespunky/*` packages with),
read from your `~/.npmrc`.

**Where it runs.** Docker was never the requirement — a modern **Node** was, and Docker only existed here to
supply one. So it now runs **locally when the local Node is 22.18+** (the bar is type-stripping, which
`compile-generators.mts` needs unflagged), and falls back to the `typescript-node` image otherwise. Force the
container with `--docker`. Both paths run the same rendered command sequence, so they can't drift.

**2FA.** If the account requires an OTP for writes, a 30-second TOTP code can expire during the staging +
compile. The native path is faster, which narrows that window but doesn't close it — the robust fix is an npm
**automation token** (or a granular token that bypasses 2FA) in `~/.npmrc`, after which publishes run unattended
with no `--otp` at all. Set one up with **[`tools/set-npm-token`](../set-npm-token/README.md)** — it prompts
silently and writes the token to `~/.npmrc` for you (the human types it; it's never pasted into a chat).

## Bootstrapping order

1. `publish.sh` → `@bespunky/nx-tools@0.1.0` on npm.
2. New projects get it as a devDep automatically (scaffold); existing projects via `scaffold.sh --repair`.
3. Then `nx g @bespunky/nx-tools:mark-extractable` / `adopt-extracted` work in any project's devcontainer.
