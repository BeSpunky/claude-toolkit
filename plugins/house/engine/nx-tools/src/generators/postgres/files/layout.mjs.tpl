// Where things are: the one answer for every verb of the launcher. GENERATOR-OWNED (@bespunky/nx-tools:postgres); rewritten
// every upgrade. Node built-ins only, here and in every file beside it: a repo wearing this layer may have no node_modules.
//
// A SERVER PER STACK. Its data lives outside the tree, under the persisted home, keyed by the tree and the stack:
//   <data home>/<hash of the tree>/tree                  the tree's path: what the sweep asks about
//   <data home>/<hash of the tree>/origin                who wrote that: the hostname and the device of the tree's parent
//   <data home>/<hash of the tree>/<app>@<offset>/<major>/data       the cluster
//   <data home>/<hash of the tree>/<app>@<offset>/<major>/identity   its system_identifier, written once, before the rename
//   <data home>/<hash of the tree>/<app>@<offset>/<major>/owner      the hostname running it; its mtime is the heartbeat
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
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

/** How to run a verb from a sentence. Under an agent, the launcher itself: Nx would show it nothing until the verb ended. */
export const verbCommand = (verb, args = '') => `${process.env.CLAUDECODE === '1' ? `node tools/postgres/postgres.mjs ${verb}` : `${NX} run postgres:${verb}`}${args && ` ${args}`}`;

/** A linked git worktree, whose `.git` is a file. The base block is the main tree's: it never takes that by default. */
export function isLinkedWorktree() {
  try {
    return statSync(join(ROOT, '.git')).isFile();
  } catch {
    return false;
  }
}

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
export const ownerFile = (home) => join(home, 'owner');
export const originFile = (dir) => join(dir, 'origin');

/** The stacks of this tree that hold a cluster of `major`, by key: a serve's is `<app>@<offset>`, a stack of its own's `postgres@<offset>`. */
export function stacksWithData(major) {
  if (!existsSync(treeHome())) return [];
  return readdirSync(treeHome(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(identityFile(clusterHome(entry.name, major))))
    .map((entry) => entry.name);
}
