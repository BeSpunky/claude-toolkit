// 0.35.0 — declare what `nx serve` runs, in `.bespunky/dev.json`.
//
// WHAT CHANGED. Up to 0.34.x the `@bespunky/nx-tools:serve` executor KNEW what an app's dev loop was: the app's
// `dev-server` target on port 4200 (+ offset), plus — when firebase.json existed in the served tree — the
// `firebase:emulators` suite, the `?portOffset=` / `?emulate=none` URL switches, a sniffed
// `<app>/proxy.conf.mjs` handed to the dev-server, and an install command guessed from the lockfile on every
// serve. From 0.35.0 that knowledge is DATA: the stack-free engine (tools/dev/dev serve, which `nx serve` now
// wraps) runs exactly what `.bespunky/dev.json` declares, and the executor knows nothing.
//
// So every project whose `serve` is the house composer gets the declaration that reproduces what the 0.34.x
// executor did for it — nothing more, nothing less:
//   - process `app`: `<nx> run <project>:dev-server --port=${PORT:app}`, base 4200 (0.34.x used 4200 whatever
//     the target said), NX_DAEMON=false + NX_WORKSPACE_ROOT_PATH pinned to the served tree, primary;
//   - process `emulators` (when firebase.json exists and the workspace `firebase` project has `emulators`):
//     `<nx> run firebase:emulators`, its ports read from firebase.json (+ the hub/logging ports
//     tools/emulators.sh pins) so the offset block keeps its 6000 step, `?portOffset=${OFFSET}` on a shifted
//     stack, `?emulate=none` when skipped, and the OAuth-origin advice;
//   - `install`: the same package-manager precedence the executor applied per serve, decided once.
//
// THE PROXY MOVES WHERE IT BELONGS. 0.34.x sniffed `<app>/proxy.conf.mjs` at serve time and appended
// `--proxyConfig`. That is the dev-server's own configuration, so it becomes the `dev-server` target's
// `proxyConfig` option (workspace-relative — Nx resolves it against the served tree's root, which the
// declaration pins). Only on an Angular dev-server, and only when neither the leaf nor `serve` names one —
// exactly the old executor's rule. A non-Angular leaf in a Firebase workspace is REPORTED, not edited.
//
// IDEMPOTENT and NON-DESTRUCTIVE: an app already declared keeps every process it has; only missing ids are
// added. Nothing is retired from project.json — the `serve` target, its executor and its options are unchanged
// (the executor now forwards them to the primary process).
//
// SELF-CONTAINED by the migration contract: the 0.34.x behaviour is frozen here, not imported from the live
// adapters (which are free to evolve — e.g. honour a dev-server's own `port`).
import { type Tree, getProjects, logger, updateProjectConfiguration } from '@nx/devkit';

const TAG = '[migrate 0.35.0 declare-dev-processes]';
const DECLARATION = '.bespunky/dev.json';
const SERVE_EXECUTOR = '@bespunky/nx-tools:serve';
const ANGULAR_DEV_SERVERS = ['@angular/build:dev-server', '@angular-devkit/build-angular:dev-server'];
/** 0.34.x BASE_APP_PORT. */
const APP_PORT = 4200;
const NX_ENV = { NX_DAEMON: 'false', NX_WORKSPACE_ROOT_PATH: '${TREE}' };
const FIREBASE_DEFAULT_PORTS: Record<string, number> = {
  ui: 4000, hub: 4400, logging: 4500, hosting: 5000, functions: 5001, apphosting: 5002, firestore: 8080,
  pubsub: 8085, database: 9000, auth: 9099, storage: 9199, eventarc: 9299, dataconnect: 9399, tasks: 9499,
};

interface Process {
  id: string;
  cmd: string[];
  ports: Record<string, number>;
  env: Record<string, string>;
  primary?: boolean;
  ready?: { http: string };
  url?: { param: string; value: string; when: string }[];
  advice?: { text: string; when: string }[];
}
interface Declaration {
  install?: { cmd: string[]; creates: string };
  apps: Record<string, { processes: Process[] }>;
}

export default function declareDevProcesses(tree: Tree): void {
  const projects = getProjects(tree);
  const served = [...projects]
    .filter(([, p]) => Object.values(p.targets ?? {}).some((t) => t && typeof t === 'object' && t.executor === SERVE_EXECUTOR))
    .map(([name]) => name)
    .sort();
  if (served.length === 0) return;

  const wrapper = !tree.exists('package.json');
  const nx = wrapper ? './nx' : 'node_modules/.bin/nx';
  const emulators = firebaseEmulators(tree, nx, projects.has('firebase') && Boolean(projects.get('firebase')?.targets?.emulators));

  // An existing declaration this rung cannot read is the PROJECT's file (only a hand edit gets it into that
  // state) — never a reason to take the whole ladder down, and never one to overwrite it. Report it, declare
  // nothing, and still do the part that does not touch it (the proxyConfig move below).
  const decl = readDeclaration(tree);
  if (!decl) {
    logger.warn(
      `${TAG} ${DECLARATION} exists but is not a readable declaration (invalid JSON, or not {"apps": {…}}) — it is ` +
        `LEFT UNTOUCHED and nothing was declared for ${served.join(', ')}. Fix it, then re-run the sync (the dev ` +
        `generator seeds whatever an app does not declare yet), or declare the processes by hand.`,
    );
    if (emulators) served.forEach((name) => moveProxyConfig(tree, name));
    return;
  }
  const added: string[] = [];

  if (!decl.install && !wrapper) {
    decl.install = { cmd: [packageManager(tree), 'install'], creates: 'node_modules' };
    added.push(`install: ${decl.install.cmd.join(' ')}`);
  }

  for (const name of served) {
    const project = projects.get(name)!;
    const entry = (decl.apps[name] ??= { processes: [] });
    const has = (id: string) => entry.processes.some((p) => p.id === id);
    const taken = new Set(entry.processes.flatMap((p) => Object.keys(p.ports ?? {})));

    const candidates: Process[] = [];
    if (project.targets?.['dev-server']) {
      candidates.push({
        id: 'app',
        cmd: [nx, 'run', `${name}:dev-server`, '--port=${PORT:app}'],
        env: { ...NX_ENV },
        ports: { app: APP_PORT },
        primary: !entry.processes.some((p) => p.primary),
        ready: { http: '/' },
      });
    } else {
      logger.warn(`${TAG} \`${name}\` has a house \`serve\` but no \`dev-server\` target — nothing to declare as its app process. Declare it by hand in ${DECLARATION}.`);
    }
    if (emulators && (candidates.length || entry.processes.length)) candidates.push({ ...emulators });

    for (const process of candidates) {
      if (has(process.id)) continue;
      const clash = Object.keys(process.ports).filter((p) => taken.has(p));
      if (clash.length) {
        logger.warn(`${TAG} NOT declaring \`${process.id}\` for \`${name}\`: port name(s) ${clash.join(', ')} already used in ${DECLARATION}.`);
        continue;
      }
      if (!process.primary) delete process.primary;
      entry.processes.push(process);
      Object.keys(process.ports).forEach((p) => taken.add(p));
      added.push(`${name}/${process.id}`);
    }
    if (entry.processes.length === 0) delete decl.apps[name];

    if (emulators) moveProxyConfig(tree, name);
  }

  if (added.length) {
    tree.write(DECLARATION, `${JSON.stringify(decl, null, 2)}\n`);
    logger.info(`${TAG} Declared in ${DECLARATION}: ${added.join(', ')}. \`nx serve <app>\` now runs exactly this (via tools/dev/dev serve).`);
  }
}

/** The declaration on disk (a fresh one when absent), or null when it exists but cannot be read as one. */
function readDeclaration(tree: Tree): Declaration | null {
  if (!tree.exists(DECLARATION)) return { apps: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(tree.read(DECLARATION, 'utf8') ?? '');
  } catch {
    return null;
  }
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  if (!isObject(parsed)) return null;
  const apps = parsed.apps ?? {};
  if (!isObject(apps) || !Object.values(apps).every((app) => isObject(app) && Array.isArray(app.processes ?? []))) return null;
  return { ...(parsed as object), apps } as Declaration;
}

/** 0.34.x's precedence: the packageManager field, then the lockfile, then yarn. */
function packageManager(tree: Tree): string {
  const declared = /"packageManager"\s*:\s*"(yarn|npm|pnpm)@/.exec(tree.read('package.json', 'utf8') ?? '')?.[1];
  if (declared) return declared;
  if (tree.exists('pnpm-lock.yaml')) return 'pnpm';
  if (tree.exists('yarn.lock')) return 'yarn';
  if (tree.exists('package-lock.json')) return 'npm';
  return 'yarn';
}

function firebaseEmulators(tree: Tree, nx: string, hasTarget: boolean): Process | null {
  if (!tree.exists('firebase.json')) return null;
  if (!hasTarget) {
    logger.warn(`${TAG} firebase.json exists but the workspace \`firebase\` project has no \`emulators\` target — the emulator suite is not declared. Add it to ${DECLARATION} by hand if you serve one.`);
    return null;
  }
  let emulators: Record<string, unknown> = {};
  try {
    emulators = (JSON.parse(tree.read('firebase.json', 'utf8') ?? '{}') as { emulators?: Record<string, unknown> }).emulators ?? {};
  } catch {
    logger.warn(`${TAG} firebase.json is not valid JSON — declaring the emulator ports from firebase-tools' defaults.`);
  }
  const ports: Record<string, number> = {};
  for (const [name, value] of Object.entries(emulators)) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as { port?: unknown; enabled?: unknown };
    if (entry.enabled === false) continue;
    const port = Number(entry.port ?? FIREBASE_DEFAULT_PORTS[name]);
    if (Number.isInteger(port) && port > 0 && /^[a-z][a-z0-9_-]*$/.test(name)) ports[name] = port;
  }
  ports.hub ??= FIREBASE_DEFAULT_PORTS.hub;
  ports.logging ??= FIREBASE_DEFAULT_PORTS.logging;
  return {
    id: 'emulators',
    cmd: [nx, 'run', 'firebase:emulators'],
    env: { ...NX_ENV },
    ports,
    url: [
      { param: 'portOffset', value: '${OFFSET}', when: 'offset' },
      { param: 'emulate', value: 'none', when: 'skipped' },
    ],
    advice: [
      {
        when: 'contended',
        text: 'Real Google OAuth sign-in is registered for that base origin only — sign in on the stack that owns it, or use the Auth emulator here.',
      },
    ],
  };
}

function moveProxyConfig(tree: Tree, name: string): void {
  const project = getProjects(tree).get(name)!;
  const proxy = `${project.root}/proxy.conf.mjs`;
  const leaf = project.targets?.['dev-server'];
  if (!leaf || !tree.exists(proxy)) return;
  if (leaf.options?.proxyConfig || project.targets?.serve?.options?.proxyConfig) return;
  if (!ANGULAR_DEV_SERVERS.includes(leaf.executor ?? '')) {
    logger.warn(
      `${TAG} \`${name}\`: ${proxy} exists but the dev-server is \`${leaf.executor}\`, not Angular's — NOT wiring it. ` +
        `0.34.x passed it as --proxyConfig; if your dev-server takes a proxy config, set it on the \`dev-server\` target.`,
    );
    return;
  }
  leaf.options = { ...leaf.options, proxyConfig: proxy };
  updateProjectConfiguration(tree, name, project);
  logger.info(`${TAG} \`${name}\`: dev-server.options.proxyConfig = ${proxy} (was appended by the serve executor at serve time).`);
}
