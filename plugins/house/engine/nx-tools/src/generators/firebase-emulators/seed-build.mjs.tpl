// The one command `firebase emulators:exec` runs to populate a seed — picks the world
// by name and applies it (tools/seed/build-seeds.sh calls this once per seed). The
// emulator state it writes is what --export-on-exit captures into the seed dir.
// The data is yours (world.mjs); the applier is the house's (apply.mjs, regenerated).
import { WORLDS } from './world.mjs';
import { applyWorld } from './apply.mjs';

const name = process.argv[2];
const world = WORLDS[name];
if (!world) {
  console.error(`[seed] unknown world "${name}" — expected one of: ${Object.keys(WORLDS).join(', ')}`);
  process.exit(1);
}

applyWorld(name, world).catch((err) => {
  console.error(`[seed] ${err?.name === 'SeedTargetError' ? err.message : err?.stack ?? err}`);
  process.exit(1);
});
