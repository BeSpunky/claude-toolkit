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
//
// THE SAME BUILD, THE SAME RELEASE: 0.50.0 also moves the build's esbuild options from the inline `esbuildOptions`
// (`{ outExtension: { '.js': '.js' } }`) to the generator-owned `esbuildConfig` (tools/functions-esbuild.config.cjs),
// whose plugin writes the Functions emulator's inert secrets into every build. Nx refuses a target with both, and a
// record-less merge would KEEP the old key — so the house's own inline options are removed here. Options the project
// changed are its own: left, and reported (the generator then leaves the build on them, without the plugin).
import { type Tree, logger, readProjectConfiguration } from '@nx/devkit';
import { houseProjectHome, updateProjectConfigInPlace } from '../../generators/_utils/project-files';
import { resolveAppsDir } from '../../generators/_utils/workspace-layout';
import { HOUSE_ESBUILD_OPTIONS_0_49 } from '../../generators/firebase-emulators/generator';

const TAG = '[migrate 0.50.0 read-functions-params-in-place]';

type Asset = string | { glob?: unknown; input?: unknown; output?: unknown; [key: string]: unknown };

const trimSlashes = (path: string) => path.replace(/^\.\//, '').replace(/\/+$/, '');

export default function readFunctionsParamsInPlace(tree: Tree): void {
  const functions = houseProjectHome(tree, 'functions', `${resolveAppsDir(tree)}/functions`);
  if (!functions.exists) return;
  const config = readProjectConfiguration(tree, functions.name);
  const options = config.targets?.build?.options as { assets?: Asset[] } | undefined;
  if (!options) return;

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

  retireHouseEsbuildOptions(tree, functions.root, functions.name);
  if (!Array.isArray(options.assets)) return;
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


function retireHouseEsbuildOptions(tree: Tree, root: string, name: string): void {
  const options = readProjectConfiguration(tree, name).targets?.build?.options as { esbuildOptions?: unknown } | undefined;
  if (!options || !('esbuildOptions' in options)) return;
  if (JSON.stringify(options.esbuildOptions) !== HOUSE_ESBUILD_OPTIONS_0_49) {
    logger.warn(
      `${TAG} ${name}:build has esbuild options of its own (${JSON.stringify(options.esbuildOptions)}) — left. The house's build ` +
        `now runs tools/functions-esbuild.config.cjs (esbuildConfig), whose plugin writes the Functions emulator's inert ` +
        `secrets into every build; Nx cannot take both. Fold yours into a config that spreads the house's ` +
        `(\`{ ...require('./functions-esbuild.config.cjs'), …yours }\`), point esbuildConfig at it and drop esbuildOptions — ` +
        `until then the build runs without that plugin (tools/emulators.sh still places the file at launch).`,
    );
    return;
  }
  updateProjectConfigInPlace(tree, root, (onDisk) => {
    const build = onDisk.targets?.build?.options as { esbuildOptions?: unknown } | undefined;
    if (build) delete build.esbuildOptions;
  });
  logger.info(`${TAG} ${name}:build: the inline esbuildOptions gave way to the house esbuildConfig (tools/functions-esbuild.config.cjs).`);
}
