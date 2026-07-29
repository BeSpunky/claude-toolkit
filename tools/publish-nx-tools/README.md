# publish-nx-tools

Publishes **`@bespunky/nx-tools`** (the house Nx generators) to npm, so projects can install it as a
devDependency and run the generators — including the reusable-tool extraction generators
(`mark-extractable`, `adopt-extracted`) — natively in their devcontainer.

## Why this exists (Phase 4 distribution)

The generators live as **TypeScript** in the toolkit (`plugins/project-starter/.../assets/nx-tools`).
The scaffold compiles them on the fly and bundles them at scaffold time — but that copy is **pruned on
every `yarn install`**, so the generators aren't runnable in a project afterward.

Fix: publish `@bespunky/nx-tools` and have projects depend on it (the scaffold/sync add it as a
devDep). Nx can't run raw TS from `node_modules`, so the published package ships **compiled JS** — this
script compiles (reusing `compile-generators.mts`) and publishes.

## Before you bump the version: the migrations gate

**A release ships the migrations it owes.** The version bump this script needs is not a bookkeeping step —
it is the moment existing projects find out what changed, and the *only* moment. So before editing
`assets/nx-tools/package.json`, put every change going out to one question:

> **Does this alter a shape that projects already on disk have?**

A renamed target, a relocated project or library, a retired config or environment file, a moved path, a
dropped option, a file shape a generator used to heal and no longer does — each is a **one-way delta**, and
the release is unfinished until a migration at `src/migrations/<version>/` carries it (registered in
`migrations.json`; see the toolkit `CLAUDE.md` §*Release & versioning* for the full rule, and the
`new-project` skill §1d for how the ladder runs).

**"Nothing to migrate" is a legitimate answer** — a brand-new generator, a new layer, a fix to an owned
template artifact that every sync regenerates anyway. It is also the answer you'll reach by accident if you
don't ask. So make it a *stated finding*: say it in the release commit message, so the next reader can tell
a considered "nothing to migrate" from a forgotten one.

Why the ceremony: **skipping an owed migration fails silently and permanently.** The project installs the new
tooling, `nx migrate` collects nothing, and `house-doc` stamps the project current on the way out — after
which the gap is sealed behind a stamp that every later sync believes.

And when you do write one, **a migration cleans up after itself**: it is done only when the old shape is
*gone* — deletions made, every reference to a moved path retargeted (including the ones the toolkit never
wrote), carried data cleared from where it used to live, and anything deliberately left un-deleted **reported
by name with its reason**. Details and the ladder's own scar tissue are in `CLAUDE.md`.

**The invariant this script cannot check for you:** `max(version in migrations.json) <= version in
assets/nx-tools/package.json`. A migration registered above the package version is never collected, never
run, and silent about it — so the migration's `version` field and the package bump are one decision.

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
2. New projects get it as a devDep automatically (scaffold); existing projects via `scaffold.sh --sync`.
3. Then `nx g @bespunky/nx-tools:mark-extractable` / `adopt-extracted` work in any project's devcontainer.
