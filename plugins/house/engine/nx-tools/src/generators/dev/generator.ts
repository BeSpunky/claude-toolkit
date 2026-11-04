// House generator: the stack-free dev engine (`tools/dev/`) + the declarations of the apps the house serves.
//
// The ONE owner of tools/dev. Any layer may list its step: a capability needs the engine for its stack identity whether
// or not the project serves anything (`tools/dev/dev run`), and the planner runs a step two layers share once.
//
// Two jobs, both on every sync:
//   1. WRITE THE ENGINE (owned, class A) — tools/dev/dev (a POSIX shim), dev.mjs and lib/*.mjs. Node built-ins
//      only: it must run in a Python or Go repo with no node_modules. Rewritten every run, never edited in the
//      project; the project's own knowledge lives in the declaration.
//   2. SEED THE DECLARATION (project state) — `.bespunky/dev.json` gains an entry for every Nx project served
//      by the `@bespunky/nx-tools:serve` composer that does not declare one yet, from the adapters that apply
//      to it (fragments/). Seeding only ADDS process ids; what a project already declares is never rewritten.
//
// WITH NOTHING SERVED, only the first job applies: tools/dev is written and nothing is seeded (fragments/index.ts). In
// particular `.bespunky/dev.json` is not created: that file is the `web` layer's evidence, and a capability must not
// make a project wear `web` by asking for the engine.
//
// A project the house knows nothing about (Vite outside Nx, uvicorn, `go run`) writes its declaration by hand
// and is served by the same engine — the declaration is the contract, the adapters are conveniences.
import { type Tree, formatFiles, getProjects, logger } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAYERS, detectLayers, isPresent } from '../../layers/registry';
import { seedFromAdapters } from './fragments';
import { SERVE_EXECUTOR } from '../_utils/dev-server';

/** The engine's files, relative to tools/dev/ — each written from files/<name>.tpl. */
export const ENGINE_FILES = [
  'dev',
  'dev.mjs',
  'lib/browser.mjs',
  'lib/declaration.mjs',
  'lib/ports.mjs',
  'lib/ready.mjs',
  'lib/stack.mjs',
  'lib/stacks.mjs',
  'lib/worktrees.mjs',
] as const;

export const ENGINE_ROOT = 'tools/dev';

type DevSchema = Record<string, never>;

export function writeEngine(tree: Tree): void {
  for (const file of ENGINE_FILES) {
    const body = readFileSync(join(__dirname, 'files', `${file}.tpl`), 'utf8');
    tree.write(`${ENGINE_ROOT}/${file}`, body, file === 'dev' ? { mode: 0o755 } : undefined);
  }
}

/** Every project with a house composer target (`dev-stack`) — the projects the Nx wrapper serves through the engine. */
export function servedProjects(tree: Tree): string[] {
  return [...getProjects(tree)]
    .filter(([, config]) => Object.values(config.targets ?? {}).some((t) => t && typeof t === 'object' && t.executor === SERVE_EXECUTOR))
    .map(([name]) => name)
    .sort();
}

/**
 * Seed every served app's declaration from the adapters that apply NOW. Also called by a capability at the moment
 * it comes into being (the Firebase core, right after it writes firebase.json): this generator runs as the web
 * layer's step, BEFORE later layers' workspace steps, so on a first scaffold the suite did not exist yet when it
 * ran — and a new Firebase app would otherwise serve without its emulators until the next sync.
 */
export function seedServedApps(tree: Tree, tag: string): void {
  for (const project of servedProjects(tree)) {
    for (const line of seedFromAdapters(tree, project)) logger.info(`[${tag}] ${line}`);
  }
}

/** The engine belongs to a workspace wearing a layer that lists its step; which layers those are is theirs to say. */
function requireEngineLayer(tree: Tree): void {
  const owners = LAYERS.filter((entry) => entry.generators?.workspace?.some((step) => step.generator === 'dev'));
  if (owners.some((entry) => isPresent(tree, entry.id))) return;
  const present = detectLayers(tree);
  throw new Error(
    `[dev] needs a layer that brings the dev engine (${owners.map((entry) => entry.id).join(', ')}), and this workspace has none of them.\n` +
      `  present: ${present.length ? present.join(', ') : '(none)'}\n` +
      owners.map((entry) => `  add ${entry.id} with: ${entry.ensureHint}`).join('\n'),
  );
}

export default async function devGenerator(tree: Tree, _options: DevSchema = {}): Promise<void> {
  requireEngineLayer(tree);
  writeEngine(tree);
  seedServedApps(tree, 'dev');
  if (servedProjects(tree).length === 0) {
    const waiting = LAYERS.filter((entry) => entry.devFragment && isPresent(tree, entry.id)).map((entry) => entry.id);
    if (waiting.length) logger.info(`[dev] tools/dev written; nothing here is served, so nothing was declared for ${waiting.join(', ')} (it runs through tools/dev/dev run until an app is served).`);
  }
  await formatFiles(tree);
}
