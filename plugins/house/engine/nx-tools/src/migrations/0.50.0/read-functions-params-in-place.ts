// 0.50.0 — the functions build stops copying `.env` into the bundle: Firebase reads the params files in place.
//
// WHY. Until 0.50.0 the house's `functions:build` carried one asset, `{ glob: '.env', input: <functions root>,
// output: '.' }`, so the bundle in dist/ held the public params and the emulator / deploy read them there. That
// channel only ever carried `.env` — the emulator-only `.env.local` (Nx skips gitignored assets) and
// `.env.<projectId>` never arrived. From 0.50.0 firebase.json → `functions[0].configDir` points both the emulator
// and deploy at the functions SOURCE directory, so every params file is read in place, and the asset is a second
// copy of the same file: two sources of one fact.
//
// WHY A MIGRATION, when the generator re-asserts `functions:build` on every upgrade. House targets now merge
// three-way against `.bespunky/house-targets.json` (0.50.0), and the FIRST 0.50 upgrade has no record: a key the
// house no longer declares is then indistinguishable from one the project added, so it is KEPT. The house dropped
// `options.assets` entirely, so without this rung the stale asset would survive every upgrade from now on — the
// record written on that first run would list a target without it, and the project's copy would look like an edit.
//
// WHAT IT DOES. Removes exactly the house's entry from `build.options.assets` of the functions project (found by
// name or canonical root, like the generator finds it), and the `assets` key when that leaves it empty. Any other
// asset is the project's: kept. A `.env` asset of another shape is the project's too — kept, and reported, because
// configDir now reads that file in place and the copy is redundant.
import { type Tree, logger, readProjectConfiguration, updateProjectConfiguration } from '@nx/devkit';
import { houseProjectHome } from '../../generators/_utils/project-files';
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
  for (const asset of kept.filter(mentionsEnv)) {
    logger.warn(
      `${TAG} ${functions.name}:build still copies a params file into the bundle (${JSON.stringify(asset)}) — left, it is ` +
        `your own. firebase.json → functions.configDir now makes the emulator and deploy read .env, .env.<projectId> ` +
        `and .env.local from ${functions.root} in place, so the copy is redundant: remove it from ` +
        `${functions.root}/project.json unless something else reads it from dist/.`,
    );
  }
  if (kept.length === options.assets.length) return;

  if (kept.length) options.assets = kept;
  else delete options.assets;
  updateProjectConfiguration(tree, functions.name, config);
  logger.info(
    `${TAG} ${functions.name}:build no longer copies .env into the bundle — the emulator and deploy read the params ` +
      `files from ${functions.root} in place (firebase.json → functions.configDir).`,
  );
}
