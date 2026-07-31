// Custom `nx release` version actions for BeSpunky Claude Code plugins.
//
// WHY THIS EXISTS. A plugin's version does not live in a package.json — it lives in
// `plugins/<p>/.claude-plugin/plugin.json`, and it is mirrored in the marketplace registry at
// `.claude-plugin/marketplace.json`. Nx's default version actions are package.json-shaped, so without this
// the whole release surface of this repo is invisible to `nx release` and every bump is done by hand, in two
// files, from memory. That is not hypothetical: `bespunky-workflow`, `bespunky-engineering` and
// `bespunky-design-system` have all shipped content with no bump. A missed plugin bump is SILENT — the repo
// has the change, the marketplace advertises the old version, `/plugin marketplace update` is a no-op, and
// consumers stay behind forever with nothing to see.
//
// `versionActions` is the documented seam for exactly this. Nx resolves the path with `require.resolve`
// (falling back to workspace-root-relative) and takes `loaded.default ?? loaded` as the class, so a plain
// CommonJS file works with no build step — which matters in a repo whose product is markdown and which has no
// compile step of its own. The nx-tools payload is TypeScript because it ships to consumers and is compiled
// for them; this only ever runs here.
//
// ── THE ORDERING RULE THIS FILE IS BUILT AROUND ────────────────────────────────────────────────────────────
//
// Nx's pipeline is: construct → `validate(tree)` → version every project into the Tree → FLUSH the tree to
// disk → `afterAllProjectsVersioned`. Everything after the flush is unundoable, and Nx has no rollback.
//
// So ALL cross-file validation happens in `validate()`, before a single byte is written. An earlier revision
// of this file validated inside `afterAllProjectsVersioned` instead, and that was actively dangerous: a
// registry/manifest disagreement threw AFTER all nine manifests were already mutated on disk, leaving the
// repo half-released — unstaged, uncommitted, untagged, with marketplace.json stale. Precisely the drift this
// file claims to make impossible. Worse, because `currentVersionResolver` is `disk`, simply fixing the
// problem and re-running then read the already-bumped manifests and bumped them AGAIN: one `patch` intent,
// two version increments, every plugin skipping a number, silently.
//
// The rule, therefore: `validate()` may read anything and must reject everything it can; the post-flush hook
// does arithmetic-free writing and nothing else.
//
// ── THE MARKETPLACE IS DERIVED, NOT MAINTAINED ─────────────────────────────────────────────────────────────
//
// `afterAllProjectsVersioned` regenerates `.claude-plugin/marketplace.json` from the plugin manifests. That is
// what turns "plugin.json and marketplace.json must agree" from an invariant somebody has to remember into
// one that cannot be expressed. Only `version` is derived — every entry's hand-written `description` and its
// `source` are preserved verbatim, because trading a version-drift bug for a content-loss bug is a poor deal.
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { VersionActions } = require('nx/release');

const PLUGIN_MANIFEST_DIR = '.claude-plugin';
const PLUGIN_MANIFEST = 'plugin.json';
// A repo-relative POSIX literal, not `join(...)`: this string is handed back to Nx in `changedFiles`, where
// every other path is a forward-slash tree path, and `join` would emit backslashes on Windows.
const MARKETPLACE = '.claude-plugin/marketplace.json';

/**
 * New versions decided during THIS run, by project name.
 *
 * Populated in `updateProjectVersion` (which receives the Tree and runs in dry-run too) and consumed by
 * `afterAllProjectsVersioned`. Reading the new versions from disk instead — the obvious approach — makes the
 * hook a no-op under `--dry-run`, because the tree is never flushed: the registry regeneration then never
 * appears in the dry-run preview, which is the only review gate a release has. Threading them through here
 * makes the preview honest and removes the hook's dependence on flush timing entirely.
 */
const pendingVersions = new Map();

class ClaudePluginVersionActions extends VersionActions {
  /**
   * The manifest filename Nx looks for inside each configured manifest root.
   *
   * The root itself is `{projectRoot}/.claude-plugin`, set via `manifestRootsToUpdate` in nx.json — Nx
   * interpolates `{projectRoot}`, so the nesting needs no special handling here.
   */
  validManifestFilenames = [PLUGIN_MANIFEST];

  /**
   * Reject everything that can be rejected, while nothing has been written yet.
   *
   * Runs per project being released (Nx calls it after preVersionCommands, before any versioning), and
   * deliberately checks the WHOLE registry rather than just this project: entries for plugins that are not
   * part of this release are still rewritten by the hook, so a fault in one of them is still this run's
   * problem. Re-reading nine small manifests a few times costs nothing next to the failure it prevents.
   */
  async validate(tree) {
    await super.validate(tree);

    const marketplace = readTreeJson(tree, MARKETPLACE, 'the marketplace registry');
    if (!Array.isArray(marketplace.plugins)) {
      throw new Error(`[nx-release] "${MARKETPLACE}" has no "plugins" array.`);
    }

    const entryBySource = new Map();
    for (const entry of marketplace.plugins) {
      // The Claude marketplace schema also permits non-path (e.g. object / "github:owner/repo") sources.
      // This repo lists only local plugins, and deriving a version for a plugin whose files are not here is
      // not something this implementation can do — so say that, rather than failing later on a raw ENOENT
      // or `entry.source.replace is not a function` in the unundoable phase.
      if (typeof entry.source !== 'string' || !entry.source.startsWith('./')) {
        throw new Error(
          `[nx-release] Marketplace entry "${entry.name}" has a non-local source (${JSON.stringify(entry.source)}). ` +
            `This versioning implementation only derives versions for plugins vendored in this repo under ` +
            `"./plugins/...". Remove the entry from the release, or extend tools/nx-release/.`
        );
      }

      const pluginRoot = entry.source.replace(/^\.\//, '');
      const manifestPath = `${pluginRoot}/${PLUGIN_MANIFEST_DIR}/${PLUGIN_MANIFEST}`;
      if (!tree.exists(manifestPath)) {
        throw new Error(
          `[nx-release] Marketplace entry "${entry.name}" points at "${entry.source}", but there is no ` +
            `"${manifestPath}". Either the plugin was moved/deleted without updating the registry, or the ` +
            `entry is stale — fix one of them before releasing.`
        );
      }

      const manifest = readTreeJson(tree, manifestPath, `the manifest for "${entry.name}"`);
      if (typeof manifest.version !== 'string') {
        throw new Error(
          `[nx-release] "${manifestPath}" has no string "version" field (found ${JSON.stringify(manifest.version)}). ` +
            `Every plugin manifest must carry one — it is what the marketplace advertises and what ` +
            `\`/plugin marketplace update\` compares.`
        );
      }
      if (manifest.name !== entry.name) {
        throw new Error(
          `[nx-release] "${manifestPath}" declares name "${manifest.name}" but the marketplace entry pointing ` +
            `at "${entry.source}" is named "${entry.name}". The manifest is the source of truth for a plugin's ` +
            `identity; fix the marketplace entry (or the source path) rather than letting the two diverge.`
        );
      }
      entryBySource.set(pluginRoot, entry);
    }

    // MEMBERSHIP IS NOT DERIVED, so it is checked. The release group selects projects by the
    // `type:claude-plugin` tag, while the registry's contents come from the registry file — two independent
    // sources. Without this, a newly tagged plugin releases and commits perfectly while never appearing in
    // the marketplace, so no consumer can install it and nothing says so.
    const projectRoot = this.projectGraphNode.data.root;
    if (!entryBySource.has(projectRoot)) {
      throw new Error(
        `[nx-release] Project "${this.projectGraphNode.name}" (${projectRoot}) is in the release group but has ` +
          `no entry in "${MARKETPLACE}". Releasing it would bump a plugin nobody can install. Add an entry ` +
          `with "source": "./${projectRoot}" first.`
      );
    }
  }

  async readCurrentVersionFromSourceManifest(tree) {
    const manifestPath = this.manifestsToUpdate[0]?.manifestPath;
    if (!manifestPath || !tree.exists(manifestPath)) return null;
    // `validate()` has already proven this parses and carries a string version.
    return { currentVersion: JSON.parse(tree.read(manifestPath, 'utf8')).version, manifestPath };
  }

  /**
   * Plugins are distributed by git, not by a registry — there is nothing to query.
   *
   * Returning null means `currentVersionResolver: "registry"` cannot work here. Nx's handling of that is
   * NOT the friendly "incompatible implementation" message it gives for the disk path: it surfaces a generic
   * "unable to resolve the current version from the registry … ensure the package exists in the registry",
   * which reads like a network blip and advises publishing git-distributed plugins to npm. So: keep
   * `currentVersionResolver: "disk"` in nx.json, which is the only resolver this implementation supports.
   */
  async readCurrentVersionFromRegistry() {
    return null;
  }

  /**
   * Plugins do not depend on each other through a manifest.
   *
   * They cross-reference by namespaced skill id (`bespunky-engineering:architecture-first`), which is a
   * runtime lookup against whatever is installed, not a version constraint. So there is no dependency version
   * to read and none to write — modelling one would invent a coupling the product does not have.
   */
  async readCurrentVersionOfDependency() {
    return { currentVersion: null, dependencyCollection: null };
  }

  async updateProjectVersion(tree, newVersion) {
    pendingVersions.set(this.projectGraphNode.name, newVersion);

    const logs = [];
    for (const { manifestPath } of this.manifestsToUpdate) {
      const manifest = JSON.parse(tree.read(manifestPath, 'utf8'));
      const previous = manifest.version;
      manifest.version = newVersion;
      // 2-space + trailing newline: the exact shape these manifests are committed in, verified byte-for-byte
      // against the repo, so a release produces no formatting noise.
      tree.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      logs.push(`✍️  New version ${newVersion} written to ${manifestPath} (was ${previous})`);
    }
    return logs;
  }

  async updateProjectDependencies() {
    // See readCurrentVersionOfDependency — nothing to update.
    return [];
  }
}

/**
 * Regenerate `.claude-plugin/marketplace.json` from the plugin manifests, after every project is versioned.
 *
 * WHY HERE and not inside updateProjectVersion: the marketplace is a WORKSPACE-level artifact listing every
 * plugin, so writing it per-project would rewrite the whole file once per plugin. Nx provides this hook for
 * precisely that shape and calls it exactly once per run (it dedupes by versionActions path), then stages
 * whatever paths we report back.
 *
 * By the time this runs the tree is flushed and every input has already been validated, so this does no
 * checking — it composes the new registry and writes it, or reports that nothing changed.
 */
const afterAllProjectsVersioned = async (cwd, { dryRun } = {}) => {
  const marketplacePath = join(cwd, MARKETPLACE);
  const current = readFileSync(marketplacePath, 'utf8');
  const marketplace = JSON.parse(current);

  const entries = marketplace.plugins.map((entry) => {
    const pluginRoot = entry.source.replace(/^\.\//, '');
    // Prefer the version decided in THIS run. Falling back to disk covers plugins that were not part of the
    // release, whose versions genuinely did not change — and makes the dry-run preview correct, since disk
    // still holds the old values then.
    const version =
      pendingVersions.get(entry.name) ??
      JSON.parse(readFileSync(join(cwd, pluginRoot, PLUGIN_MANIFEST_DIR, PLUGIN_MANIFEST), 'utf8')).version;

    return { ...entry, version };
  });

  const next = `${JSON.stringify({ ...marketplace, plugins: entries }, null, 2)}\n`;

  // Compare the DATA, not the bytes. A byte comparison would rewrite (and report as changed) a registry that
  // differs only in line endings — so on a CRLF checkout every release, including a no-op one, would produce
  // a spurious full-file diff forever.
  if (JSON.stringify(JSON.parse(next)) === JSON.stringify(marketplace)) {
    return { changedFiles: [], deletedFiles: [] };
  }

  if (!dryRun) writeFileSync(marketplacePath, next);
  return { changedFiles: [MARKETPLACE], deletedFiles: [] };
};

/** Read JSON from the devkit Tree, naming the file when it is unparseable rather than leaking a bare SyntaxError. */
function readTreeJson(tree, path, what) {
  try {
    return JSON.parse(tree.read(path, 'utf8'));
  } catch (error) {
    throw new Error(`[nx-release] Could not parse ${what} at "${path}": ${error.message}`);
  }
}

module.exports = ClaudePluginVersionActions;
module.exports.default = ClaudePluginVersionActions;
module.exports.afterAllProjectsVersioned = afterAllProjectsVersioned;
