// Render the emulator tooling modules into a fixture workspace exactly as the firebase-emulators generator does:
//   tools/emulator-ports.mjs    — the owned template with the one port table (suite-ports.json) projected in;
//   tools/emulator-project.mjs  — which project id the suite runs under (offline demo- twin by default);
//   tools/emulator-secrets.cjs  — what the Functions emulator is given as secrets.
// The scripts under test (emulators.sh, reap-emulators.sh) call all three, so a fixture without them tests nothing real.
//
//   node tools/test-scaffold/emulator-tools.mjs <workspace dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GEN = join(dirname(fileURLToPath(import.meta.url)), '../../plugins/house/engine/nx-tools/src/generators/firebase-emulators');
const tools = join(process.argv[2], 'tools');
mkdirSync(tools, { recursive: true });
const { defaults, alwaysOn, nested } = JSON.parse(readFileSync(join(GEN, 'suite-ports.json'), 'utf8'));
const template = (name) => readFileSync(join(GEN, name), 'utf8');
writeFileSync(join(tools, 'emulator-ports.mjs'), template('emulator-ports.mjs.tpl').split('{{SUITE}}').join(JSON.stringify({ defaults, alwaysOn, nested }, null, 2)));
writeFileSync(join(tools, 'emulator-project.mjs'), template('emulator-project.mjs.tpl'));
// The version the generator renders in (generator.ts CONFIG_DIR_SINCE) — read from there, never restated here.
const since = /export const CONFIG_DIR_SINCE = '([^']+)'/.exec(template('generator.ts'))?.[1];
if (!since) throw new Error('generator.ts no longer declares CONFIG_DIR_SINCE');
writeFileSync(join(tools, 'emulator-secrets.cjs'), template('emulator-secrets.cjs.tpl').split('{{configDirSince}}').join(since));
