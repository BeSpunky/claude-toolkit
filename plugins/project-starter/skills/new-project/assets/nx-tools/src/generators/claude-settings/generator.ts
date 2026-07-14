// House generator: write .claude/settings.json (marketplaces + autoUpdate + enabled plugins),
// ensure the .claude/data mount source exists, and keep Claude local state out of git.
//
// MERGE, never clobber. This file is co-owned: the house owns the marketplace/plugin/permission keys,
// but the PROJECT owns everything it adds afterwards (its own `hooks`, extra `permissions.allow`
// entries, extra `enabledPlugins`, env, statusLine…). A wholesale `tree.write` of the template — what
// this generator used to do — silently deleted all of that on every `scaffold.sh --repair`.
//
// The merge rule is deliberate and one-directional: house keys are RE-ASSERTED (the template wins at
// every leaf it declares, so a drifted or hand-broken house setting heals), and any key the template
// does NOT declare is PRESERVED as-is. Objects merge recursively; a leaf (scalar or array) the template
// declares replaces the project's. So the house can never lose a setting to drift, and the project can
// never lose a setting to a repair.
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
  const gitignore = tree.exists('.gitignore') ? (tree.read('.gitignore', 'utf8') ?? '') : '';
  if (!gitignore.includes('.claude/data/')) {
    const sep = gitignore === '' || gitignore.endsWith('\n') ? '' : '\n';
    tree.write('.gitignore', `${gitignore}${sep}\n# Claude Code local state\n.claude/data/\n`);
  }
}

/**
 * Read + parse a JSON file from the tree. A file that doesn't exist — or that a human has left
 * unparseable — yields `undefined`, which the caller treats as "nothing to preserve" and writes the
 * clean house template. Healing a broken settings.json beats failing the whole repair on it.
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
