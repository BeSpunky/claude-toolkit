// House generator: write .claude/settings.json (marketplaces + autoUpdate + enabled plugins),
// and keep the active layers' machine-local state out of git.
//
// COMPOSED FROM THE ACTIVE LAYERS. Which plugins a project enables is a fact about its layers — the Nx plugin
// with the Nx floor, `bespunky-angular` with Angular, the design-system plugin with a design system — so each
// layer declares them (`descriptor.claudePlugins`) and this generator enables the union. The devcontainer's
// plugin pre-install reads the SAME list (`_utils/layer-contributions.ts`), so the two can no longer drift.
// The same goes for `.gitignore`: each layer names the machine-local paths its tooling creates
// (`descriptor.gitignore`), and they are ignored only where that layer is.
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
//
// TWO CLASSES OF HOUSE KEY, and the difference is not cosmetic. `settings.json.tpl` is OWNED — it is
// infrastructure (which marketplaces exist, which plugins are enabled), the project has no business
// disagreeing with it, and re-asserting it every sync is the point. `settings.seed.json.tpl` is
// SEEDED — written only where the project has no value of its own, and never touched again.
//
// `outputStyle` is the seeded case and shows why the distinction has to exist. It is a BEHAVIOURAL
// preference, only ONE can be active at a time, and a consumer choosing a different one — or writing
// their own — is a legitimate decision. Re-asserting it would silently revert that choice on every
// `--sync`, which is not "keeping the house standard", it is overruling a human who already answered
// the question. Seeding gets the house default working out of the box (nobody has to know the setting
// exists) while leaving the answer theirs the moment they give one.
import { type Tree } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { activeLayers, claudePlugins, gitignoreBlocks } from '../_utils/layer-contributions';

type Json = Record<string, unknown>;

interface ClaudeSettingsSchema {
  /** The layers this project has. Default: DETECTED from the workspace. */
  layers?: string[] | string;
}

export default async function claudeSettingsGenerator(tree: Tree, options: ClaudeSettingsSchema = {}): Promise<void> {
  const layers = activeLayers(tree, options.layers);
  const house = { ...pluginSettings(layers), ...(JSON.parse(readFileSync(join(__dirname, 'settings.json.tpl'), 'utf8')) as Json) };
  const seeds = JSON.parse(readFileSync(join(__dirname, 'settings.seed.json.tpl'), 'utf8')) as Json;
  const project = readJson(tree, '.claude/settings.json');
  const merged = deepSeed(project ? deepMerge(project, house) : { ...house }, seeds);

  tree.write('.claude/settings.json', `${JSON.stringify(merged, null, 2)}\n`);

  // The devcontainer's `.claude/data` bind source is NOT created here: it is gitignored, so anything written now
  // exists on this machine only and a fresh clone would still lack it. The devcontainer's host probe creates it
  // on the host before every container open — the one place that holds on every machine.

  // Keep each active layer's machine-local state out of git — Claude Code's own (`agent`), Nx's caches and the
  // sync's lock (`nx`), whatever a later layer adds. Additive and idempotent: an entry already mentioned is left
  // alone, so a project that ignores these its own way is untouched.
  for (const block of gitignoreBlocks(layers)) ensureIgnored(tree, `# ${block.heading}`, [...block.entries]);
}

/**
 * The marketplace + plugin keys, from the active layers. OWNED (re-asserted every sync): which marketplaces exist
 * and which house plugins are on is infrastructure. A plugin the project enabled itself — or one the house no
 * longer contributes — is a key this does not declare, so the merge leaves it exactly as the project has it.
 */
function pluginSettings(layers: Parameters<typeof claudePlugins>[0]): Json {
  const { plugins, marketplaces } = claudePlugins(layers);
  return {
    extraKnownMarketplaces: Object.fromEntries(
      marketplaces.map(([name, market]) => [
        name,
        { source: { source: 'github', repo: market.repo }, ...(market.autoUpdate ? { autoUpdate: true } : {}) },
      ]),
    ),
    enabledPlugins: Object.fromEntries(plugins.map((plugin) => [plugin, true])),
  };
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

/**
 * Write each seed into `target` ONLY where the project has no value of its own — the inverse of
 * `deepMerge`, which is why it cannot be expressed as a flag on it: there, the house wins every leaf
 * it declares; here, the project wins every leaf it has already answered.
 *
 * Absence is judged with `in`, not truthiness: `false`, `0` and `""` are answers a project gave, and
 * a seed must not overwrite them. Objects recurse, so a nested seed can fill one missing sub-key
 * without disturbing its siblings.
 */
function deepSeed(target: Json, seeds: Json): Json {
  for (const [key, seedValue] of Object.entries(seeds)) {
    const current = target[key];

    if (isPlainObject(seedValue) && isPlainObject(current)) deepSeed(current, seedValue);
    else if (!(key in target)) target[key] = seedValue;
  }

  return target;
}

/** A mergeable object — a JSON object, not an array and not null (both of which are leaves here). */
function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
