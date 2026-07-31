// Release invariants for this repo — the questions nobody remembers to ask.
//
// WHY THIS EXISTS ALONGSIDE `nx release`. Adopting `nx release` (tools/nx-release/) removed the HAND BUMP:
// versions are written by the tool and the marketplace registry is derived rather than maintained. What it
// cannot do is guarantee anyone RAN it. Push without releasing and you are in the state this repo has been in
// three times — the change is in the repo, the advertised version is unchanged, `/plugin marketplace update`
// is a no-op, and consumers stay behind with nothing anywhere reporting a problem.
//
// That asymmetry is the point. A missed `@bespunky/nx-tools` bump is LOUD (CI skips the publish, the next
// `--sync` installs the old payload). A missed PLUGIN bump is SILENT and permanent. So this asks, after the
// fact: did the thing that should have happened, happen?
//
// ── THE DESIGN RULE: NEVER GUESS GREEN ──────────────────────────────────────────────────────────────────────
//
// A guard that reports "ok" when it cannot actually see is worse than no guard, because it converts an open
// question into a false assurance. An earlier revision of this file failed that rule four ways: a shallow
// clone, an unreadable manifest, a directory rename, and a reverted release each produced a green report on a
// genuinely broken state. Every "I cannot tell" below is therefore an ERROR, never a pass — and the process
// exits 2 (not 1) when the checker itself breaks, so CI can tell a violated invariant from a broken tool.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MARKETPLACE = '.claude-plugin/marketplace.json';
const PLUGINS_DIR = 'plugins';
const NX_TOOLS = 'plugins/project-starter/skills/new-project/assets/nx-tools';

// stderr is discarded on purpose: probing `<sha>^:<path>` legitimately fails for a root commit or a path that
// did not exist yet, and git narrates each of those. Those are expected answers, gathered deliberately below.
const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const failures = [];
const fail = (title, detail, fix) => failures.push({ title, detail, fix });

/** Files under a plugin root that are workspace tooling rather than shipped plugin content. */
const NOT_PLUGIN_CONTENT = new Set(['project.json']);

/**
 * Does `path` exist at `ref`? Distinguishes "absent" from "unreadable" — the overload that made the previous
 * revision fabricate releases. `git cat-file -e` answers exactly this and nothing else.
 */
function existsAt(ref, path) {
  try {
    git('cat-file', '-e', `${ref}:${path}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * The version recorded in `path` at `ref`, or null when the file does not exist there.
 *
 * Throws when the file EXISTS but cannot be read or parsed. That distinction is the whole point: treating an
 * unparseable manifest (a bad merge leaving conflict markers, say) as "no earlier version" made the commit
 * look like a release and silently excused every unbumped change before it.
 */
function versionAt(ref, path) {
  if (!existsAt(ref, path)) return null;
  const raw = git('show', `${ref}:${path}`);
  try {
    return JSON.parse(raw).version ?? null;
  } catch (error) {
    throw new Error(`Cannot parse ${path} at ${ref}: ${error.message}`);
  }
}

const semver = (v) => {
  // Numeric core plus an optional prerelease. `Number()` on a prerelease component yields NaN, and every
  // NaN comparison is false — which made the previous `split('.').map(Number)` silently answer "not greater"
  // for any prerelease, i.e. exactly the safe-looking wrong answer this file exists to avoid.
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(String(v ?? '').trim());
  if (!m) return null;
  return { core: [+m[1], +m[2], +m[3]], pre: m[4] ?? null };
};

/** Is `a` strictly greater than `b`? Null (unparseable) on either side is an error, not a comparison. */
function isGreater(a, b) {
  const [x, y] = [semver(a), semver(b)];
  if (!x || !y) throw new Error(`Unparseable semver: ${JSON.stringify(!x ? a : b)}`);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] > y.core[i];
  if (x.pre === y.pre) return false;
  if (x.pre === null) return true; // 1.0.0 > 1.0.0-rc.1
  if (y.pre === null) return false;
  return x.pre > y.pre; // lexicographic is sufficient for the ordering this repo uses
}

/**
 * The manifest's history as `{sha, path}`, newest first, following renames.
 *
 * The path is captured PER COMMIT and not assumed constant. Probing `<sha>^:<current-path>` instead — the
 * obvious approach — breaks the moment a plugin directory is renamed: the path does not exist at the parent,
 * which reads as "the manifest first appeared here", so the rename commit masquerades as a release and every
 * unbumped change before it (including content changed in that very commit) is excused.
 */
function manifestHistory(manifestPath) {
  const raw = git('log', '--follow', '--format=%x01%H', '--name-only', '--', manifestPath);
  return raw
    .split('\x01')
    .filter(Boolean)
    .map((record) => {
      const [sha, ...rest] = record.trim().split('\n');
      const path = rest.map((l) => l.trim()).filter(Boolean).pop();
      return { sha, path: path ?? manifestPath };
    });
}

/**
 * The commit at which the manifest's version last INCREASED — i.e. the project's last real release.
 *
 * "Increased", not merely "changed": reverting a release commit changes the version *downwards*, and calling
 * that a release reports green on the exact state this file exists to catch. (The revert itself is caught
 * separately — see `versionRegressed` — because after one, the version at HEAD is one consumers already have
 * while the content is not.)
 */
function lastReleaseCommit(manifestPath) {
  const history = manifestHistory(manifestPath);
  for (let i = 0; i < history.length; i++) {
    const at = versionAt(history[i].sha, history[i].path);
    if (at === null) continue;
    const older = i + 1 < history.length ? versionAt(history[i + 1].sha, history[i + 1].path) : null;
    if (older === null) return { sha: history[i].sha, version: at }; // first appearance of the manifest
    if (isGreater(at, older)) return { sha: history[i].sha, version: at };
  }
  return null;
}

/**
 * Has this manifest ever carried a version HIGHER than the one it carries now?
 *
 * If so the version went backwards — a reverted or hand-rolled-back release. That is not merely untidy: the
 * version now advertised is one consumers already installed, so `/plugin marketplace update` will not fetch
 * the current content no matter how much of it changed. Monotonicity is the property that makes "advertised
 * version" a usable signal at all, so it is checked directly rather than inferred.
 */
function versionRegressed(manifestPath) {
  const history = manifestHistory(manifestPath);
  const current = versionAt('HEAD', manifestPath);
  if (current === null) return null;

  let highest = current;
  for (const { sha, path } of history) {
    const seen = versionAt(sha, path);
    if (seen !== null && semver(seen) && isGreater(seen, highest)) highest = seen;
  }
  return highest === current ? null : highest;
}

/**
 * Shipped files under `dir` that changed since `sha`.
 *
 * The manifest is included but compared with `version` MASKED, so a bump alone does not count as content
 * while a description edit does — descriptions are consumer-facing text shown in plugin listings, and this
 * repo's own doctrine calls them load-bearing. Excluding the manifest wholesale (the previous approach) meant
 * a rewritten description could never trigger a release.
 */
function changedContentSince(sha, dir, manifestPath) {
  const changed = git('diff', '--name-only', `${sha}..HEAD`, '--', dir).split('\n').filter(Boolean);
  return changed.filter((file) => {
    if (NOT_PLUGIN_CONTENT.has(file.slice(dir.length + 1))) return false;
    if (file !== manifestPath) return true;
    const strip = (raw) => {
      const { version, ...rest } = JSON.parse(raw);
      return JSON.stringify(rest);
    };
    try {
      return strip(git('show', `${sha}:${file}`)) !== strip(readFileSync(join(ROOT, file), 'utf8'));
    } catch {
      return true; // cannot tell → treat as changed; never guess green
    }
  });
}

function checkProject({ label, dir, manifestPath, fixHint }) {
  const regressedFrom = versionRegressed(manifestPath);
  if (regressedFrom) {
    fail(
      `${label}: version went BACKWARDS — ${regressedFrom} was released, ${versionAt('HEAD', manifestPath)} is advertised now`,
      `  Consumers who already have ${regressedFrom} will never be offered the current content, whatever it contains:\n` +
        `  \`/plugin marketplace update\` only fetches a HIGHER version.`,
      `release forward past ${regressedFrom} (nx release version --projects=${label} --specifier=patch), never back to it`
    );
    return;
  }

  const last = lastReleaseCommit(manifestPath);
  if (!last) {
    fail(
      `${label}: no release could be identified in history`,
      `  Could not find a commit where ${manifestPath}'s version increased.`,
      `if this is a brand-new plugin, commit its first version; otherwise the history may be incomplete`
    );
    return;
  }
  const changed = changedContentSince(last.sha, dir, manifestPath);
  if (changed.length > 0) {
    fail(
      `${label} changed since ${last.version} was released, but the version has not moved`,
      [
        `  last released at ${last.sha.slice(0, 7)} (version ${last.version})`,
        ...changed.slice(0, 12).map((f) => `  changed: ${f}`),
        changed.length > 12 ? `  …and ${changed.length - 12} more` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      fixHint
    );
  }
}

function main() {
  // ── Can this checker see the history it needs at all? ─────────────────────────────────────────────────────
  // A shallow clone's graft boundary looks exactly like a file's first commit, so every plugin appears to have
  // been released at the boundary and everything older is excused. That is a silent, total false pass — the
  // worst possible outcome — so it is refused rather than reported.
  if (git('rev-parse', '--is-shallow-repository') === 'true') {
    console.error(
      'error: this is a shallow clone, so the last release of each plugin cannot be identified.\n' +
        '       Every plugin would appear released at the graft boundary and this check would pass vacuously.\n' +
        '       Fetch full history (CI: actions/checkout with fetch-depth: 0; locally: git fetch --unshallow).'
    );
    process.exit(2);
  }

  const marketplace = readJson(MARKETPLACE);
  const registered = new Map(marketplace.plugins.map((e) => [e.source.replace(/^\.\//, ''), e]));

  // ── A. Every plugin whose shipped content moved since its last release must have been released again ──────
  for (const [root, entry] of registered) {
    checkProject({
      label: entry.name,
      dir: root,
      manifestPath: `${root}/.claude-plugin/plugin.json`,
      fixHint: `nx release version --projects=${entry.name} --specifier=patch   # then commit`,
    });
  }

  // ── A2. A plugin directory that is not in the registry is a plugin nobody can install ──────────────────────
  // Checked because the registry is the ONLY list the loop above walks, so an unregistered plugin is invisible
  // to it — the same silent-omission shape, one level up.
  for (const name of readdirSync(join(ROOT, PLUGINS_DIR))) {
    const root = `${PLUGINS_DIR}/${name}`;
    if (registered.has(root)) continue;
    if (!existsSync(join(ROOT, root, '.claude-plugin', 'plugin.json'))) continue;
    fail(
      `${root} is a plugin but has no entry in ${MARKETPLACE}`,
      `  It has a .claude-plugin/plugin.json, so it is a plugin — but no consumer can install it.`,
      `add an entry with "source": "./${root}" (see CLAUDE.md → adding a plugin)`
    );
  }

  // ── A3. The nx-tools payload, which releases through npm rather than the marketplace ──────────────────────
  checkProject({
    label: '@bespunky/nx-tools',
    dir: NX_TOOLS,
    manifestPath: `${NX_TOOLS}/package.json`,
    fixHint: `bump "version" in ${NX_TOOLS}/package.json — and ask what migration the change owes (CLAUDE.md → Release & versioning)`,
  });

  // ── B. The derived registry must agree with the manifests ────────────────────────────────────────────────
  // A regression test rather than a live risk: the registry is derived during `nx release`, so the two can
  // only diverge if it was hand-edited or the derivation broke.
  for (const [root, entry] of registered) {
    const manifest = readJson(`${root}/.claude-plugin/plugin.json`);
    if (manifest.version !== entry.version) {
      fail(
        `${entry.name}: marketplace says ${entry.version}, manifest says ${manifest.version}`,
        `  ${MARKETPLACE} is DERIVED from ${root}/.claude-plugin/plugin.json — never edit it by hand.`,
        `nx release version --projects=${entry.name} --specifier=patch   # regenerates the registry`
      );
    }
    if (manifest.name !== entry.name) {
      fail(
        `${entry.name}: manifest declares a different name (${manifest.name})`,
        `  The manifest is the source of truth for a plugin's identity.`,
        `fix the name in ${root}/.claude-plugin/plugin.json or the entry in ${MARKETPLACE}`
      );
    }
  }

  // ── C. A migration registered above the payload's version is never collected ──────────────────────────────
  // `nx migrate` only collects migrations whose version falls inside the range it walks, so one above the
  // ceiling sits there forever: never run, and silent about it.
  const pkg = readJson(`${NX_TOOLS}/package.json`);
  if (existsSync(join(ROOT, `${NX_TOOLS}/migrations.json`))) {
    const migrations = readJson(`${NX_TOOLS}/migrations.json`);
    // `nx migrate` honours both keys; reading only `generators` silently skipped a schematics-keyed file.
    const all = { ...(migrations.generators ?? {}), ...(migrations.schematics ?? {}) };
    for (const [name, migration] of Object.entries(all)) {
      if (!semver(migration.version)) {
        fail(
          `migration "${name}" has an unparseable version (${JSON.stringify(migration.version)})`,
          `  Its position relative to the payload version cannot be determined, so it cannot be guaranteed collectable.`,
          `give it a semver version in ${NX_TOOLS}/migrations.json`
        );
        continue;
      }
      if (isGreater(migration.version, pkg.version)) {
        fail(
          `migration "${name}" is registered at ${migration.version}, above @bespunky/nx-tools ${pkg.version}`,
          `  nx migrate will never collect it — it is above every range any project can walk.`,
          `bump ${NX_TOOLS}/package.json to at least ${migration.version}`
        );
      }
    }
  }

  if (failures.length === 0) {
    console.log(`ok: release invariants hold (${registered.size} plugins, payload ${pkg.version})`);
    return 0;
  }

  console.error(`\n${failures.length} release invariant violation(s):\n`);
  for (const { title, detail, fix } of failures) {
    console.error(`  ✗ ${title}`);
    if (detail) console.error(detail);
    console.error(`    fix: ${fix}\n`);
  }
  console.error(
    'A version that does not move is a change consumers never receive: `/plugin marketplace update` compares\n' +
      'versions, so the repo having the change is not the same as anyone getting it.\n'
  );
  return 1;
}

// Exit 2 for "the checker broke", distinct from 1 for "an invariant is violated". Without this, a missing
// directory or an absent `git` is reported by the pre-push hook as "a plugin changed without a release",
// which sends the reader to fix a release that is not the problem.
try {
  process.exit(main());
} catch (error) {
  console.error(`error: release-invariants check could not complete: ${error.message}`);
  process.exit(2);
}
