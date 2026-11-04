# seam-installer: what was built

> 2026-11-04, branch `feat/hps-installer`. A capability no layer wears yet.

## The format (`layers/descriptor.ts`)

`ArchiveTool` is now `TarballTool | DebClosureTool`. A tarball entry is unchanged and states no `format`.

`DebClosureTool`: `format: 'deb'`, `id`, `bin`, `libraryPaths` (`*` allowed), optional `prune` (exact paths), `closures: { <codename>: { version, systemDepends, packages: { <arch>: [{ url, sha256 }] } } }`.

The installer, in order: refuse an unknown codename or architecture; download and check every file; `apt-get update` and `apt-get satisfy -y --no-install-recommends "<systemDepends>"`, three tries; `dpkg-deb -x` each file into `<home>/.partial`; prune; `mv` to `<version>`; switch `current`; write a wrapper per executable in `bin`; drop wrappers it no longer has and the old release. No dpkg registration, so no maintainer scripts. A failure before the switch leaves the installed release alone.

The machinery sits in its own template sections (`DEB_ARCHIVES`, shared `ARCHIVE_TOOLS`), so a project with no closure gets not one changed byte.

## For the layer that wears it (Landing 2)

```ts
archives: [{
  format: 'deb', id: 'postgres',
  bin: `usr/lib/postgresql/${major}/bin`,
  libraryPaths: ['usr/lib/*-linux-gnu'],
  prune: ['usr/share/man', 'usr/share/doc', 'usr/share/locale', `usr/lib/postgresql/${major}/bin/pg_config`],
  closures: POSTGRES_CLOSURES[major],
}]
```

- **Prune `pg_config`.** Its wrapper would come first on PATH and shadow a `libpq-dev` `/usr/bin/pg_config` (the `typescript-node` image has one), pointing native module builds at headers the closure does not hold. Pruning an executable removes its wrapper; `run-closure.mjs` asserts this.
- `/var/run/postgresql` is compiled in and not created, so the launcher sets `unix_socket_directories`.
- 18 has no JIT without `postgresql-18-jit` in the closure (a Recommends). Decide it there, in `selectPackages`.
- `version` is `<upstream>-<fingerprint of every file>`, so a moved pgvector reinstalls with the server standing still. Reach binaries through `current` or the wrappers.

## The table

`node tools/postgres-debs/project.mjs [--check|--write]`, pins in `versions.ts` (`POSTGRES_MAJORS`, `POSTGRES_DEB_CODENAMES`, `POSTGRES_DEB_ARCHITECTURES`, `POSTGRES_EXTENSIONS`). Rules are pure, in `closure.mjs`. Beyond the brief: it also checks that Debian's indexes (the codename, `-updates`, `-security`) can supply every `systemDepends` clause, because otherwise that failure first appears at a consumer's image build. Weekly (`upstream-tables.yml`), and before publish (`publish.sh`). Needs `gpg`, `bzip2` and `xz` on the host that publishes.

The `PACKAGING_ONLY` list drops `postgresql-common`, `postgresql-client-common`, `ssl-cert`, `debconf`, `locales`, `sensible-utils`. Anything else stays and reaches apt, on purpose.

`node tools/postgres-debs/run-closure.mjs <empty dir>` is the by-hand real run. Not in CI.

## Migration question

Nothing to migrate. Rendered `house.packages.sh`, `house.Dockerfile`, `post-create.sh` and `devcontainer.json` were compared at the commit before and after this change for agent, web, firebase and firebase + web: no difference at all. So no shape on disk moves, and no existing project's image layer is invalidated.

## Left for the docs unit

`CLAUDE.md`: the versions paragraph and the commands table should name `tools/postgres-debs`. The devcontainer paragraph's `name=version` apt sentence is already known wrong (`layer-infra.md` §5.2).

## Unproven until a user rebuild

1. `dpkg-deb -x` as root in a real `docker build`, and the tree then run by the non-root remote user.
2. `apt-get satisfy` for real, on `devcontainers/base:debian` and `typescript-node`, with both the exact string and the absence of Recommends observed. Here `apt-get` and `sudo` were stubs; the string was checked, never executed.
3. A real bookworm container. Bookworm closures were extracted here, never run.
4. arm64: projected and HEAD-checked, never executed.
5. Post-create on an adopted image, as non-root through real `sudo`.
