// Custom `nx release` version actions for BeSpunky Claude Code plugins.
//
// WHY THIS EXISTS. A plugin's version does not live in a package.json — it lives in
// `plugins/<p>/.claude-plugin/plugin.json`, and it is mirrored in the marketplace registry at
// `.claude-plugin/marketplace.json`. Nx's default version actions are package.json-shaped, so without this
// the whole release surface of this repo is invisible to `nx release` and every bump is done by hand, in two
// files, from memory. That is not a hypothetical failure: `bespunky-engineering` and `bespunky-design-system`
// both shipped content changes with no bump, and the only reason anyone noticed is that a later sweep happened
// to look. A missed plugin bump is SILENT — the repo has the change, the marketplace advertises the old
// version, `/plugin marketplace update` is a no-op, and consumers stay behind forever with nothing to see.
//
// `versionActions` is the documented seam for exactly this (nx.json → release.version.versionActions, and it
// is overridable per release group and per project). Nx resolves the path with `require.resolve`, falling back
// to workspace-root-relative, and takes `loaded.default ?? loaded` as the class — so a plain CommonJS file
// works with no build step, which matters in a repo whose product is markdown and which has no compile step of
// its own.
//
// PLAIN JS ON PURPOSE. Nx would happily load a `.ts` implementation (it routes `.ts`/`.cts`/`.mts` through its
// own loader), but that would make this repo's release machinery depend on a TypeScript toolchain it otherwise
// does not have. The nx-tools payload is TypeScript because it ships to consumers and is compiled for them;
// this file only ever runs here.
//
// THE MARKETPLACE IS DERIVED, NOT MAINTAINED. `afterAllProjectsVersioned` regenerates
// `.claude-plugin/marketplace.json` from the nine plugin.json files after versioning. That is what turns
// "plugin.json and marketplace.json must agree" from an invariant somebody has to remember into one that
// cannot be expressed: there is one source of truth, and the registry is a projection of it.
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { VersionActions } = require('nx/release');

const PLUGIN_MANIFEST_DIR = '.claude-plugin';
const PLUGIN_MANIFEST = 'plugin.json';
const MARKETPLACE = join(PLUGIN_MANIFEST_DIR, 'marketplace.json');

class ClaudePluginVersionActions extends VersionActions {
  /**
   * The manifest filename Nx looks for inside each configured manifest root.
   *
   * The root itself is `{projectRoot}/.claude-plugin`, set via `manifestRootsToUpdate` in nx.json — Nx
   * interpolates `{projectRoot}` for us, so the nesting needs no special handling here.
   */
  validManifestFilenames = [PLUGIN_MANIFEST];

  async readCurrentVersionFromSourceManifest(tree) {
    const manifestPath = this.manifestsToUpdate[0]?.manifestPath;
    if (!manifestPath || !tree.exists(manifestPath)) return null;

    const manifest = readJson(tree, manifestPath);
    if (typeof manifest.version !== 'string') {
      throw new Error(
        `[nx-release] "${manifestPath}" has no string "version" field. Every plugin manifest must carry one — ` +
          `it is what the marketplace advertises and what \`/plugin marketplace update\` compares.`
      );
    }
    return { currentVersion: manifest.version, manifestPath };
  }

  /**
   * Plugins are distributed by git, not by a registry — there is nothing to query.
   *
   * Returning null rather than throwing is the contract Nx documents for an unsupported resolver: it then
   * shows the user a message about `currentVersionResolver` being incompatible with this implementation,
   * which is a far better error than anything this file could invent.
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
    const logs = [];
    for (const { manifestPath } of this.manifestsToUpdate) {
      const manifest = readJson(tree, manifestPath);
      const previous = manifest.version;
      manifest.version = newVersion;
      writeJson(tree, manifestPath, manifest);
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
 * plugin, so writing it per-project would rewrite the whole file once per plugin and interleave badly on a
 * multi-project release. Nx provides this hook for precisely this shape (its own example is a workspace lock
 * file) and stages whatever paths we report back.
 *
 * The tree is already flushed to disk by the time this runs — hence plain fs, not a devkit Tree.
 *
 * WHAT IS DERIVED AND WHAT IS NOT. Only `version` is taken from plugin.json, plus `name` and the relative
 * `source` which are structural. Everything else in an existing marketplace entry — most importantly the long,
 * hand-written `description` that is the entry's whole value — is PRESERVED verbatim. A regenerator that
 * flattened those descriptions would be trading a version-drift bug for a much worse content-loss bug.
 */
const afterAllProjectsVersioned = async (cwd, { dryRun } = {}) => {
  const marketplacePath = join(cwd, MARKETPLACE);
  const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'));

  const entries = marketplace.plugins.map((entry) => {
    // `source` is the relative path to the plugin directory — the registry's own pointer, so it is the
    // authority on where a plugin lives rather than a name-to-directory guess.
    const pluginRoot = entry.source.replace(/^\.\//, '');
    const manifestPath = join(cwd, pluginRoot, PLUGIN_MANIFEST_DIR, PLUGIN_MANIFEST);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    if (manifest.name !== entry.name) {
      throw new Error(
        `[nx-release] "${manifestPath}" declares name "${manifest.name}" but the marketplace entry pointing ` +
          `at "${entry.source}" is named "${entry.name}". The manifest is the source of truth for a plugin's ` +
          `identity; fix the marketplace entry (or the source path) rather than letting the two diverge.`
      );
    }
    return { ...entry, version: manifest.version };
  });

  const next = `${JSON.stringify({ ...marketplace, plugins: entries }, null, 2)}\n`;
  const current = readFileSync(marketplacePath, 'utf8');
  if (next === current) return { changedFiles: [], deletedFiles: [] };

  if (!dryRun) writeFileSync(marketplacePath, next);
  return { changedFiles: [MARKETPLACE], deletedFiles: [] };
};

/** Read JSON through the devkit Tree (in-memory during versioning, so writes stay transactional). */
function readJson(tree, path) {
  return JSON.parse(tree.read(path, 'utf8'));
}

/** Write JSON through the Tree, preserving the 2-space + trailing-newline shape these manifests are kept in. */
function writeJson(tree, path, value) {
  tree.write(path, `${JSON.stringify(value, null, 2)}\n`);
}

module.exports = ClaudePluginVersionActions;
module.exports.default = ClaudePluginVersionActions;
module.exports.afterAllProjectsVersioned = afterAllProjectsVersioned;
