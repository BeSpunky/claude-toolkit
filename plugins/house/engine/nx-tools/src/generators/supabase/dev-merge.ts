// The keeper's process, in a project wearing Supabase. `.bespunky/dev.json` is the project's, and seeding never rewrites it, but this
// process cannot run with one port: the keeper pins them all. So every run adds what the layer needs, and keeps what the project set:
// its own ports and exports stay, and a URL is replaced only if it is still the native server's, by the letter.
import { type Tree, logger } from '@nx/devkit';
import { DECLARATION_PATH, type DevProcess, readDeclaration } from '../dev/declaration';
import { postgresFragment } from '../postgres/dev-fragment';
import { SUPABASE_ALLOCATES_FROM, SUPABASE_PORTS, supabaseExports, supabaseFragment } from './dev-fragment';

/** The process that serves the database. A project's own process calling another verb of the launcher (`seed`, `migrate`) is not it. */
const KEEPER = /\bpostgres\.mjs\s+(?:serve|start)\b/;

function reshape(process: DevProcess): boolean {
  const before = JSON.stringify(process);
  const native = postgresFragment().processes[0];
  process.ports = { ...SUPABASE_PORTS, ...process.ports };
  process.avoidPorts = [...new Set([...(process.avoidPorts ?? []), SUPABASE_ALLOCATES_FROM])];
  const exports = { ...process.exports };
  for (const [name, value] of Object.entries(supabaseExports())) {
    if (exports[name] === undefined || exports[name] === native.exports?.[name]) exports[name] = value;
    else if (exports[name] !== value) logger.info(`[supabase] ${name} of the "${process.id}" process in ${DECLARATION_PATH} is yours and stays: the stack's would be ${value}.`);
  }
  process.exports = exports;
  process.ready = process.ready && JSON.stringify(process.ready) !== JSON.stringify(native.ready) ? process.ready : supabaseFragment().processes[0].ready;
  return JSON.stringify(process) !== before;
}

export function mergeServedApps(tree: Tree): void {
  const declaration = readDeclaration(tree);
  if (!declaration) return;
  let changed = false;
  for (const [app, entry] of Object.entries(declaration.apps)) {
    for (const process of entry.processes ?? []) {
      if (!KEEPER.test(Array.isArray(process.cmd) ? process.cmd.join(' ') : process.cmd)) continue;
      if (reshape(process)) {
        changed = true;
        logger.info(`[supabase] ${app}: the "${process.id}" process in ${DECLARATION_PATH} now declares the stack's ports.`);
      }
    }
  }
  if (changed) tree.write(DECLARATION_PATH, `${JSON.stringify(declaration, null, 2)}\n`);
}
