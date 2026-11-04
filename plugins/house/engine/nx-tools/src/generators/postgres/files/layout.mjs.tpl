// Where things are: the one answer for every verb of the launcher. GENERATOR-OWNED (@bespunky/nx-tools:postgres); rewritten
// every upgrade. Node built-ins only, here and in every file beside it: a repo wearing this layer may have no node_modules.
//
// A SERVER PER STACK. Its data lives outside the tree, under the persisted home, keyed by the tree and the stack:
//   <data home>/<hash of the tree>/tree                  the tree's path: what the sweep asks about
//   <data home>/<hash of the tree>/<app>@<offset>/<major>/data       the cluster
//   <data home>/<hash of the tree>/<app>@<offset>/<major>/identity   its system_identifier, written once, before the rename
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const LAUNCHER = join(ROOT, 'tools/postgres/postgres.mjs');
export const DEV_ENGINE = join(ROOT, 'tools/dev/dev.mjs');
export const MIGRATIONS = join(ROOT, 'postgres/migrations');
export const SEEDS = join(ROOT, 'postgres/seed/world');
export const DECLARATION = join(ROOT, '.bespunky/postgres.json');

/** The stack's port, by name in dev.json and `dev run`. The stack's offset applies to it. */
export const PORT_NAME = 'postgres';
export const BASE_PORT = 5432;
export const DATABASE = 'app';
export const ROLE = 'postgres';
/** What the launcher waits on, in the stack's state dir: it dies with the stack, so it cannot go stale. */
export const READY_MARKER = 'postgres.ready';
/** The one variable `deploy` reads. Not DATABASE_URL: that name is in every shell and `.env` of a project that has a database. */
export const DEPLOY_URL_VAR = 'POSTGRES_DEPLOY_URL';

/** A refusal or failure a human acts on: printed as it is, never as a stack trace. */
export class Refusal extends Error {}

/** How this repo invokes Nx, for a sentence that names a target. */
export const NX = existsSync(join(ROOT, 'nx')) ? './nx' : 'nx';

export function declaredMajor() {
  let declared;
  try {
    declared = JSON.parse(readFileSync(DECLARATION, 'utf8'));
  } catch (error) {
    throw new Refusal(`Cannot read the Postgres major from .bespunky/postgres.json (${error.message}). It should say { "major": 18 }.`);
  }
  if (!Number.isInteger(declared?.major)) throw new Refusal(`.bespunky/postgres.json should say { "major": <a whole number> }, and it says ${JSON.stringify(declared)}.`);
  return String(declared.major);
}

export const dataHome = () => join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'bespunky/postgres');
export const treeHome = () => join(dataHome(), createHash('sha256').update(realpathSync(ROOT)).digest('hex').slice(0, 16));
export const stackHome = (key) => join(treeHome(), key);
export const clusterHome = (key, major) => join(stackHome(key), major);
export const dataDir = (home) => join(home, 'data');
export const identityFile = (home) => join(home, 'identity');
