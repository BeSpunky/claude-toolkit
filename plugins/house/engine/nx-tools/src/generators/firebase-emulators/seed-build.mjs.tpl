// The one command `firebase emulators:exec` runs to populate a seed — picks the world
// by name and applies it (tools/seed/build-seeds.sh calls this once per seed). The
// emulator state it writes is what --export-on-exit captures into the seed dir.
import { WORLDS, applyWorld } from './world.mjs';

const name = process.argv[2];
const world = WORLDS[name];
if (!world) {
  console.error(`[seed] unknown world "${name}" — expected one of: ${Object.keys(WORLDS).join(', ')}`);
  process.exit(1);
}

applyWorld(name, world).catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
