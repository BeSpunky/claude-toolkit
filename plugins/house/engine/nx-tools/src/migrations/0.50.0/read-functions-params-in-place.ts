// 0.50.0 — the functions build stops copying `.env` into the bundle: Firebase reads the params files in place.
//
// WHY. Until 0.50.0 the house's `functions:build` carried one asset, `{ glob: '.env', input: <functions root>,
// output: '.' }`, so the bundle in dist/ held the public params and the emulator / deploy read them there. That
// channel only ever carried `.env` — the emulator-only `.env.local` (Nx skips gitignored assets) and
// `.env.<projectId>` never arrived. From 0.50.0 firebase.json → `functions[0].configDir` points both the emulator
// and deploy at the functions SOURCE directory, so every params file is read in place, and the asset is a second
// copy of the same file: two sources of one fact.
//
// WHY A MIGRATION, when the generator re-asserts `functions:build` on every upgrade. House targets merge three-way
// against `.bespunky/house-targets.json`, whose first version (0.50.0/record-house-targets) proves a key the house's
// only when the project's value still equals what 0.49.2 wrote. `assets` is ONE value to that merge: beside an asset
// of the project's own, the whole array is the project's, and the house's `.env` entry inside it would survive every
// upgrade. Removing one ELEMENT the house wrote is a one-way change — a migration's.
//
// WHAT IT DOES — both halves of the move, here, because this rung commits on its own (`--create-commits`) and a
// generator that should finish the job may not run after it (a skipped step, a bare `nx migrate --run-migrations`):
//   1. firebase.json → the functions block that deploys this project (its `source` is the bundle, dist/<root>)
//      gains `configDir: <functions root>`, in place — unless it already names one (the project's choice, kept).
//   2. Only then, exactly the house's entry leaves `build.options.assets` of the functions project (found by name or
//      canonical root, like the generator finds it), and the `assets` key when that leaves it empty. Any other
//      asset is the project's: kept. A `.env` asset of another shape is the project's too — kept, and reported,
//      because configDir now reads that file in place and the copy is redundant.
// No functions block deploys this project (no firebase.json, or none whose source is its bundle) → nothing can read
// the params in place, so the asset — the only channel they have — STAYS, and that is reported.
import { type Tree, logger, readProjectConfiguration } from '@nx/devkit';
import { houseProjectHome, updateProjectConfigInPlace } from '../../generators/_utils/project-files';
import { updateJsonInPlace } from '../../generators/_utils/json-edits';
import { resolveAppsDir } from '../../generators/_utils/workspace-layout';

const TAG = '[migrate 0.50.0 read-functions-params-in-place]';

type Asset = string | { glob?: unknown; input?: unknown; output?: unknown; [key: string]: unknown };

const trimSlashes = (path: string) => path.replace(/^\.\//, '').replace(/\/+$/, '');

export default function readFunctionsParamsInPlace(tree: Tree): void {
  const functions = houseProjectHome(tree, 'functions', `${resolveAppsDir(tree)}/functions`);
  if (!functions.exists) return;
  const config = readProjectConfiguration(tree, functions.name);
  const options = config.targets?.build?.options as { assets?: Asset[] } | undefined;
  if (!options || !Array.isArray(options.assets)) return;

  const isHouseEntry = (asset: Asset) =>
    typeof asset === 'object' &&
    asset !== null &&
    Object.keys(asset).length === 3 &&
    asset.glob === '.env' &&
    asset.output === '.' &&
    typeof asset.input === 'string' &&
    trimSlashes(asset.input) === trimSlashes(functions.root);
  const mentionsEnv = (asset: Asset) =>
    (typeof asset === 'string' ? asset : String(asset?.glob ?? '')).split('/').pop()?.startsWith('.env') ?? false;

  const kept = options.assets.filter((asset) => !isHouseEntry(asset));
  if (kept.length !== options.assets.length && !readsParamsInPlace(tree, functions.root)) {
    logger.warn(
      `${TAG} ${functions.name}:build still copies .env into the bundle — left: firebase.json has no functions block ` +
        `whose source is dist/${trimSlashes(functions.root)}, so nothing could read the params from ${functions.root} in ` +
        'place. The next house upgrade re-asserts that block (with configDir); the copy can go after it.',
    );
    return;
  }
  for (const asset of kept.filter(mentionsEnv)) {
    logger.warn(
      `${TAG} ${functions.name}:build still copies a params file into the bundle (${JSON.stringify(asset)}) — left, it is ` +
        `your own. firebase.json → functions.configDir now makes the emulator and deploy read .env, .env.<projectId> ` +
        `and .env.local from ${functions.root} in place, so the copy is redundant: remove it from ` +
        `${functions.root}/project.json unless something else reads it from dist/.`,
    );
  }
  if (kept.length === options.assets.length) return;

  // In place: only the house entry goes (the emptied key with it) — nothing else in project.json moves.
  updateProjectConfigInPlace(tree, functions.root, (onDisk) => {
    const build = onDisk.targets?.build?.options as { assets?: Asset[] } | undefined;
    if (!build?.assets) return;
    build.assets = build.assets.filter((asset) => !isHouseEntry(asset));
    if (!build.assets.length) delete build.assets;
  });
  logger.info(
    `${TAG} ${functions.name}:build no longer copies .env into the bundle — the emulator and deploy read the params ` +
      `files from ${functions.root} in place (firebase.json → functions.configDir).`,
  );
}

/**
 * Make the functions block that deploys `root`'s bundle read the params in place: `configDir` set to `root` unless
 * the block already names one. Returns whether such a block now has a configDir (false: no block deploys it).
 */
function readsParamsInPlace(tree: Tree, root: string): boolean {
  if (!tree.exists('firebase.json')) return false;
  const bundle = `dist/${trimSlashes(root)}`;
  const deploysIt = (block: unknown): block is { configDir?: unknown; source?: unknown } =>
    typeof block === 'object' && block !== null && typeof (block as { source?: unknown }).source === 'string' &&
    trimSlashes((block as { source: string }).source) === bundle;
  let found = false;
  let wrote = false;
  updateJsonInPlace<{ functions?: unknown }>(tree, 'firebase.json', (json) => {
    for (const block of [json.functions].flat()) {
      if (!deploysIt(block)) continue;
      found = true;
      if (typeof block.configDir === 'string' && block.configDir.length) continue;
      block.configDir = trimSlashes(root);
      wrote = true;
    }
  });
  if (wrote) logger.info(`${TAG} firebase.json → the functions block deploying ${bundle} now reads its params from ${trimSlashes(root)} (configDir).`);
  return found;
}
