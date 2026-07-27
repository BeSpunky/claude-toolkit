// House generator: write .claude/settings.json (marketplaces + autoUpdate + enabled plugins),
// ensure the .claude/data mount source exists, and keep Claude local state out of git.
//
// MERGE, never clobber. This file is co-owned: the house owns the marketplace/plugin/permission keys,
// but the PROJECT owns everything it adds afterwards (its own `hooks`, extra `permissions.allow`
// entries, extra `enabledPlugins`, env, statusLine…). A wholesale `tree.write` of the template — what
// this generator used to do — silently deleted all of that on every `scaffold.sh --sync`.
//
// The merge rule is deliberate and one-directional: house keys are RE-ASSERTED (the template wins at
// every leaf it declares, so a drifted or hand-broken house setting heals), and any key the template
// does NOT declare is PRESERVED as-is. Objects merge recursively; a leaf (scalar or array) the template
// declares replaces the project's. So the house can never lose a setting to drift, and the project can
// never lose a setting to a sync.
import { type Tree } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Json = Record<string, unknown>;

export default async function claudeSettingsGenerator(tree: Tree): Promise<void> {
  const house = JSON.parse(readFileSync(join(__dirname, 'settings.json.tpl'), 'utf8')) as Json;
  const project = readJson(tree, '.claude/settings.json');
  const merged = project ? deepMerge(project, house) : house;

  tree.write('.claude/settings.json', `${JSON.stringify(merged, null, 2)}\n`);

  // Ensure the devcontainer bind-mount source (.claude/data) exists locally after scaffolding.
  if (!tree.exists('.claude/data/.gitkeep')) {
    tree.write('.claude/data/.gitkeep', '');
  }

  // Keep Claude Code local state out of git.
  ensureIgnored(tree, '# Claude Code local state', ['.claude/data/']);

  // Keep Nx's CACHES out of git — an agent-DX concern, which is why it lives in this layer's generator.
  // `nx init` on an EXISTING repo ignores `.nx/polygraph` but not `.nx/cache` or `.nx/workspace-data`, so a
  // retrofitted repo has three files that churn on every single `nx` invocation. For a human that is noise;
  // for an agent it is worse, because a permanently dirty tree makes "is this change mine?" unanswerable and
  // invites committing machine-local cache. Additive and idempotent: an entry already present is left alone,
  // so a project that ignores these its own way is untouched.
  ensureIgnored(tree, '# Nx caches (machine-local; never committed)', ['.nx/cache', '.nx/workspace-data']);
}

/**
 * Append any of `entries` that aren't already mentioned in `.gitignore`, under a single heading.
 *
 * Substring matching is deliberate and sufficient here: these are distinctive paths, and the question being
 * asked is "does this repo already deal with this?", not "is there an exactly-equal line". A repo that
 * ignores `.nx/` wholesale already covers `.nx/cache`, and re-adding it would be noise.
 */
function ensureIgnored(tree: Tree, heading: string, entries: string[]): void {
  const current = tree.exists('.gitignore') ? (tree.read('.gitignore', 'utf8') ?? '') : '';
  const missing = entries.filter((entry) => !current.includes(entry));

  const appended =
    missing.length === 0
      ? current
      : `${current}${current === '' || current.endsWith('\n') ? '' : '\n'}\n${heading}\n${missing.join('\n')}\n`;

  // Tidy the whole file, even on a run that appends NOTHING.
  //
  // `.gitignore` is written by several hands — `nx init` appends its own block with leading newlines, and
  // so does every generator that owns a rule here — and the result accumulates runs of blank lines that no
  // single author is responsible for. This layer owns .gitignore hygiene, so it normalises the file it
  // touches rather than only the lines it contributed; anything else leaves the mess for a human to notice.
  // Idempotent by construction: collapsing is a fixed point, so a second run rewrites nothing.
  const tidied = appended.replace(/\n{3,}/g, '\n\n');
  if (tidied !== current) tree.write('.gitignore', tidied);
}

/**
 * Read + parse a JSON file from the tree. A file that doesn't exist — or that a human has left
 * unparseable — yields `undefined`, which the caller treats as "nothing to preserve" and writes the
 * clean house template. Healing a broken settings.json beats failing the whole sync on it.
 */
function readJson(tree: Tree, path: string): Json | undefined {
  if (!tree.exists(path)) return undefined;

  try {
    const parsed: unknown = JSON.parse(tree.read(path, 'utf8') ?? '');
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Recursively merge `house` INTO `project`: house wins at every leaf it declares; unknown keys survive. */
function deepMerge(project: Json, house: Json): Json {
  const merged: Json = { ...project };

  for (const [key, houseValue] of Object.entries(house)) {
    const projectValue = merged[key];

    merged[key] =
      isPlainObject(houseValue) && isPlainObject(projectValue)
        ? deepMerge(projectValue, houseValue)
        : houseValue;
  }

  return merged;
}

/** A mergeable object — a JSON object, not an array and not null (both of which are leaves here). */
function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
