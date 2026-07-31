// Release invariants for this repo — the questions nobody remembers to ask.
//
// WHY THIS EXISTS ALONGSIDE `nx release`. Adopting `nx release` (see tools/nx-release/) removed the HAND
// BUMP: versions are now written by the tool, and the marketplace registry is derived rather than
// maintained. What it cannot do is guarantee that anyone RAN it. Push a change without releasing and you are
// in the exact state this repo has already been in twice — the change is in the repo, the advertised version
// is unchanged, `/plugin marketplace update` is a no-op, and consumers silently stay behind with nothing
// anywhere reporting a problem.
//
// That asymmetry is the whole point. A missed `@bespunky/nx-tools` bump is LOUD (CI skips the publish, the
// next `--sync` installs the old payload, you find out). A missed PLUGIN bump is SILENT and permanent. Silent
// failures are exactly what deserves a machine check, so this asks the one question after the fact:
//
//   did the thing that should have happened, happen?
//
// It DETECTS AND REPORTS; it never bumps anything. Choosing patch vs minor is a judgment call about what a
// change means to consumers, and a tool that guessed it would be the "hook that commands the model to act"
// this repo's hook doctrine already refuses. The fix it prints is the command to run, not an edit it makes.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MARKETPLACE = '.claude-plugin/marketplace.json';
const NX_TOOLS = 'plugins/project-starter/skills/new-project/assets/nx-tools';

// stderr is discarded on purpose: probing `<sha>^:<path>` legitimately fails for a root commit or a path that
// did not exist yet, and git narrates each of those to stderr. Those are expected answers ("no earlier
// version"), not problems, and letting them print would bury the report they are gathered for.
const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const failures = [];
const notes = [];
const fail = (title, detail, fix) => failures.push({ title, detail, fix });

/**
 * The newest commit at which `versionPath`'s version field CHANGED — i.e. the project's last release.
 *
 * Walking commits that touched the manifest and comparing the parsed version is deliberate: the manifest also
 * changes for description edits and metadata, and treating those as releases would silently excuse every
 * change made after one. Returns null when the file has no history yet (a brand-new, uncommitted plugin).
 */
function lastVersionChangeCommit(versionPath, extract) {
  const commits = git('log', '--format=%H', '--', versionPath).split('\n').filter(Boolean);
  for (const sha of commits) {
    const at = versionAt(sha, versionPath, extract);
    const before = versionAt(`${sha}^`, versionPath, extract);
    if (at !== before) return { sha, version: at };
  }
  return null;
}

function versionAt(ref, path, extract) {
  try {
    return extract(git('show', `${ref}:${path}`));
  } catch {
    return null; // file absent at that ref (or ref has no parent) — treated as "different"
  }
}

/**
 * Files under a plugin root that are WORKSPACE TOOLING, not plugin content.
 *
 * The question this check exists to ask is "did anything a consumer receives change?" — and a consumer
 * receives a plugin's manifest, skills, agents, commands and hooks. `project.json` is Nx workspace metadata:
 * it is what makes the plugin a release target in the first place, and Claude Code never reads it. Counting it
 * would have demanded nine meaningless bumps the moment `nx release` was adopted, and a guard whose first act
 * is to cry wolf nine times is a guard nobody keeps.
 */
const NOT_PLUGIN_CONTENT = new Set(['project.json']);

/** Files under `dir` changed since `sha`, excluding the manifest whose version bump we are testing for. */
function changedSince(sha, dir, excluding) {
  return git('diff', '--name-only', `${sha}..HEAD`, '--', dir)
    .split('\n')
    .filter((f) => f && f !== excluding && !NOT_PLUGIN_CONTENT.has(f.slice(dir.length + 1)));
}

// ── A. Every plugin whose content moved since its last release must have been released again ────────────────
//
// This is the one that has actually bitten: `bespunky-engineering` and `bespunky-design-system` both shipped
// skill edits with no bump, caught only because a later sweep happened to look.
const marketplace = readJson(MARKETPLACE);
for (const entry of marketplace.plugins) {
  const root = entry.source.replace(/^\.\//, '');
  const manifest = `${root}/.claude-plugin/plugin.json`;
  const extract = (raw) => JSON.parse(raw).version;

  const last = lastVersionChangeCommit(manifest, extract);
  if (!last) {
    notes.push(`${entry.name}: no release commit in history yet — skipped`);
    continue;
  }

  const changed = changedSince(last.sha, root, manifest);
  if (changed.length > 0) {
    fail(
      `${entry.name} changed since ${last.version} was released, but the version has not moved`,
      [`  last released at ${last.sha.slice(0, 7)} (version ${last.version})`, ...changed.map((f) => `  changed: ${f}`)].join('\n'),
      `nx release version --projects=${entry.name} --specifier=patch   # then commit`
    );
  }
}

// ── A'. Same question for the nx-tools payload, which releases through npm rather than the marketplace ───────
//
// Included because the failure is the same shape even though the delivery mechanism differs: CI publishes only
// when the version is not already on npm, so an unbumped payload change is simply never published.
{
  const manifest = `${NX_TOOLS}/package.json`;
  const extract = (raw) => JSON.parse(raw).version;
  const last = lastVersionChangeCommit(manifest, extract);
  if (last) {
    const changed = changedSince(last.sha, NX_TOOLS, manifest);
    if (changed.length > 0) {
      fail(
        `@bespunky/nx-tools changed since ${last.version} was released, but the version has not moved`,
        [`  last released at ${last.sha.slice(0, 7)} (version ${last.version})`, ...changed.slice(0, 12).map((f) => `  changed: ${f}`),
         changed.length > 12 ? `  …and ${changed.length - 12} more` : ''].filter(Boolean).join('\n'),
        `bump "version" in ${manifest} — and ask what migration the change owes (CLAUDE.md → Release & versioning)`
      );
    }
  }
}

// ── B. The registry must agree with the manifests ───────────────────────────────────────────────────────────
//
// Now a REGRESSION TEST rather than a live risk: the marketplace is derived by tools/nx-release's
// afterAllProjectsVersioned, so the two can only diverge if someone hand-edited the registry or the
// derivation broke. Kept precisely because that is worth being told about immediately.
for (const entry of marketplace.plugins) {
  const root = entry.source.replace(/^\.\//, '');
  const manifest = readJson(`${root}/.claude-plugin/plugin.json`);
  if (manifest.version !== entry.version) {
    fail(
      `${entry.name}: marketplace says ${entry.version}, manifest says ${manifest.version}`,
      `  ${MARKETPLACE} is DERIVED from ${root}/.claude-plugin/plugin.json — it should never be edited by hand.`,
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

// ── C. A migration registered above the payload's version is never collected ─────────────────────────────────
//
// `nx migrate` only collects migrations whose version falls inside the range it is walking, so one registered
// above the ceiling sits there forever: never run, and silent about it. CLAUDE.md states this invariant in
// prose; this makes it checkable.
{
  const pkg = readJson(`${NX_TOOLS}/package.json`);
  const migrationsPath = `${NX_TOOLS}/migrations.json`;
  if (existsSync(join(ROOT, migrationsPath))) {
    const migrations = readJson(migrationsPath).generators ?? {};
    const semver = (v) => v.split('.').map(Number);
    const gt = (a, b) => {
      const [x, y] = [semver(a), semver(b)];
      for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
      return false;
    };
    for (const [name, migration] of Object.entries(migrations)) {
      if (gt(migration.version, pkg.version)) {
        fail(
          `migration "${name}" is registered at ${migration.version}, above @bespunky/nx-tools ${pkg.version}`,
          `  nx migrate will never collect it — it is above every range any project can walk.`,
          `bump ${NX_TOOLS}/package.json to at least ${migration.version}`
        );
      }
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────────────────────────────────────
for (const note of notes) console.log(`note: ${note}`);

if (failures.length === 0) {
  console.log(`ok: release invariants hold (${marketplace.plugins.length} plugins, payload ${readJson(`${NX_TOOLS}/package.json`).version})`);
  process.exit(0);
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
process.exit(1);
