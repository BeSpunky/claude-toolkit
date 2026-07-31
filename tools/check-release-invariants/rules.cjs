// The release rules, in one place: semver ordering and the migration-ceiling invariant.
//
// WHY THIS FILE EXISTS. The ceiling rule — "no migration may be registered above the payload's version, or
// `nx migrate` can never collect it" — was implemented three times: in `publish.sh`, inline in
// `.github/workflows/publish-nx-tools.yml`, and in `check.mjs`. `publish.sh` even carried a comment asking
// future maintainers to keep the copies in sync, which is the tell: a rule that has to be manually kept
// identical in N places is a rule that will eventually differ in one of them.
//
// It already had. Both publish-path copies read only `migrations.json`'s `generators` key (nx migrate honours
// `schematics` too) and silently skipped any entry whose `version` was missing (`g.version &&`), so a
// schematics-keyed or version-less migration above the ceiling was invisible to the two checks that gate
// npm publishing. This module is the strongest of the three, and now the only one.
//
// COMMONJS ON PURPOSE. The callers are an ESM script (`check.mjs`), a bash script driving `node -e`
// (`publish.sh`), and a GitHub workflow step doing the same. CJS is the one format all three can load with no
// build step and no flags, in a repo that deliberately has no build.
//
// ── THE ONE DUPLICATE THAT REMAINS, AND WHY ────────────────────────────────────────────────────────────────
//
// `scaffold.sh` carries its own copy of the comparator (twice: a shell one in MIGRATE_PROBE and a JS one in
// the `--local` migration collector). Those CANNOT use this module: scaffold.sh ships to consumers and runs
// inside their projects, where this repo does not exist — the same self-containment constraint the migrations
// themselves live under. So that duplication is deliberate and permanent, and it is pinned instead of
// unified: `agreement.test.cjs` extracts scaffold.sh's comparator from the file and asserts it agrees with
// this one across a table of cases. A duplicate you have decided to keep needs a test; a duplicate you merely
// tolerate needs a comment, and comments do not fail the build.

/**
 * Parse a version into a comparable shape. Returns null for anything that is not `major.minor.patch`
 * (with an optional `-prerelease`), which callers must treat as an error rather than as "sorts low" —
 * a version that cannot be ordered cannot be proven reachable.
 */
function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.+)?$/.exec(String(value ?? '').trim());
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] ?? null };
}

/**
 * Compare two versions: -1 if a < b, 0 if equal, 1 if a > b. Throws on an unorderable input.
 *
 * PRERELEASE-AWARE, and it has to be. Comparing release cores alone makes `0.25.0-rc.1` equal to a migration
 * keyed `0.25.0`, so a ceiling guard would pass while the runtime collectors — scaffold.sh's probe and the
 * `--local` collector, which both rank a prerelease BELOW its release — treat that migration as unreachable.
 * The guard would then miss exactly the failure class it exists to catch.
 */
function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  if (!x || !y) throw new Error(`Unorderable version: ${JSON.stringify(!x ? a : b)}`);

  for (let i = 0; i < 3; i++) {
    if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  }
  if (x.prerelease === y.prerelease) return 0;
  // A prerelease sorts BELOW the release that shares its core: 0.25.0-rc.1 < 0.25.0.
  if (x.prerelease === null) return 1;
  if (y.prerelease === null) return -1;
  return x.prerelease < y.prerelease ? -1 : x.prerelease > y.prerelease ? 1 : 0;
}

/** Is `a` strictly greater than `b`? Throws on an unorderable input. */
const isGreater = (a, b) => compareVersions(a, b) > 0;

/**
 * Every migration in `migrationsJson` that a project could never receive, given `packageVersion`.
 *
 * Returns two lists, because they need different words to the reader:
 *   - `unreachable` — ordered above the package version, so no range any project walks can include it.
 *   - `unorderable` — a version that is not semver at all, so reachability cannot be established either way.
 *     Previously these were silently skipped, which is the quietest possible way to not check something.
 *
 * Reads BOTH `generators` and `schematics`: `nx migrate` honours both keys, so checking one leaves a
 * perfectly valid migrations.json entirely unguarded.
 */
function findUnreachableMigrations(migrationsJson, packageVersion) {
  const entries = {
    ...(migrationsJson?.generators ?? {}),
    ...(migrationsJson?.schematics ?? {}),
  };

  const unreachable = [];
  const unorderable = [];

  for (const [name, migration] of Object.entries(entries)) {
    const version = migration?.version;
    if (!parseVersion(version)) {
      unorderable.push({ name, version });
      continue;
    }
    if (isGreater(version, packageVersion)) unreachable.push({ name, version });
  }

  // Highest last, so a caller can quote the version to bump to.
  unreachable.sort((a, b) => compareVersions(a.version, b.version));
  return { unreachable, unorderable };
}

module.exports = { parseVersion, compareVersions, isGreater, findUnreachableMigrations };
