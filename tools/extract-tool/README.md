# extract-tool

The **cross-workspace** step of reusable-tool extraction (Phase 2). Lifts a library that was marked
in a project (`nx g @bespunky/nx-tools:mark-extractable`) into the shared `@bespunky` workspace as a
publishable package.

It is a **host-side tool**, not an Nx generator — on purpose. An Nx generator works on one workspace's
tree, but `~/projects` is a flat set of **isolated** workspaces with nothing spanning them, so a move
that *reads one workspace and writes another* can't be a generator (see
`docs/reusable-tool-extraction.md` §2.1).

It runs **in Docker**, not on the bare host: the host's Node is too old for modern Nx, so — exactly like
`scaffold.sh` — the launcher runs the tool inside the `typescript-node` base image with `~/projects`
mounted (both the source project and the shared workspace are visible, and the shared workspace's own
Nx is available via its mounted `node_modules`).

## Usage

Run the **launcher** (`extract-tool.sh`) — it handles Docker, path mapping, and ownership:

```bash
tools/extract-tool/extract-tool.sh \
  --from <source-project>        # name under ~/projects, or a path
  [--into bespunky]              # shared workspace (default: bespunky)
  [--lib <library-name>] \
  [--scope @bespunky] \
  [--dry-run] [--no-scaffold] [--force]
```

(`extract-tool.mjs` is the actual logic and runs *inside* the container — don't invoke it on the bare
host; its Node is too old.)

- `--from` (required) — the source project workspace.
- `--into` — the shared workspace (default `~/projects/bespunky`).
- `--lib` — a single library to ingest (default: every `status: candidate` marker in the project).
- `--dry-run` — print the plan (commands + copies) without writing anything.
- `--no-scaffold` — don't run the package-shell generator (the package must already exist → update).
- `--force` — include markers whose status isn't `candidate`.

## What it does

For each candidate (an `extraction.json` with `status: candidate`):

1. **NEW package** → scaffolds the shell by invoking the shared workspace's own generator as a
   subprocess (`yarn nx g @nx/js:lib` or `@nx/angular:library --publishable --importPath=<pkg>`).
   **Existing package** → updates it (and leaves the version bump to `nx release`).
2. Copies the library's `src/` into the package.
3. Sets `package.json`: `name`, `peerDependencies` (framework deps pinned to the **installed major**),
   `dependencies`, `publishConfig.access = public`, and — for a new package — the initial version
   (`0.<ngMajor>.0` for Angular libs; `0.0.1` for plain semver).
4. Writes the project's marker back to `status: ingested`.

## Important

This produces a **draft package for review** — it does **not** publish. Source-derived
`peerDependencies` are best-effort; **review them and the version by hand** before releasing.

After it runs: review → `nx release` in the shared workspace → commit the project's updated
`extraction.json` → `nx g @bespunky/nx-tools:adopt-extracted` back in the project.
