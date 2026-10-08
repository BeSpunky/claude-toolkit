// Render the stack-free dev engine (tools/dev/) into a fixture workspace exactly as the `dev` generator does: every
// files/<name>.tpl written as tools/dev/<name>. The emulator scripts under test claim their stacks through it
// (tools/dev/dev.mjs claim — the one stack identity), so a fixture without it tests nothing real.
//
//   node tools/test-scaffold/render-engine.mjs <workspace dir>
import { chmodSync, cpSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILES = join(dirname(fileURLToPath(import.meta.url)), '../../plugins/house/engine/nx-tools/src/generators/dev/files');
const copy = (from, to) => {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) copy(join(from, entry.name), join(to, entry.name));
    else cpSync(join(from, entry.name), join(to, entry.name.replace(/\.tpl$/, '')));
  }
};
const engine = join(process.argv[2], 'tools', 'dev');
copy(FILES, engine);
chmodSync(join(engine, 'dev'), 0o755);
