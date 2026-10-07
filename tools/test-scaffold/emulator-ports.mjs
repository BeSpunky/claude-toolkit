// Render tools/emulator-ports.mjs into a fixture workspace exactly as the firebase-emulators generator does:
// the owned template with the one port table (suite-ports.json) projected in. The scripts under test
// (emulators.sh, reap-emulators.sh) read their ports from it, so a fixture without it tests nothing real.
//
//   node tools/test-scaffold/emulator-ports.mjs <workspace dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GEN = join(dirname(fileURLToPath(import.meta.url)), '../../plugins/house/engine/nx-tools/src/generators/firebase-emulators');
const { defaults, alwaysOn, nested } = JSON.parse(readFileSync(join(GEN, 'suite-ports.json'), 'utf8'));
const out = join(process.argv[2], 'tools', 'emulator-ports.mjs');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, readFileSync(join(GEN, 'emulator-ports.mjs.tpl'), 'utf8').split('{{SUITE}}').join(JSON.stringify({ defaults, alwaysOn, nested }, null, 2)));
