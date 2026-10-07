// The dev declaration — `.bespunky/dev.json`, what a project serves. GENERATOR-OWNED
// (@bespunky/nx-tools:dev); rewritten every sync. The DECLARATION itself is the project's: adapters seed it,
// humans edit it, and nothing here ever writes it.
//
// {
//   "install": { "cmd": ["yarn", "install"], "creates": "node_modules" },      // optional, per tree
//   "apps": {
//     "<app>": {
//       "processes": [
//         {
//           "id": "app",                                    // [a-z][a-z0-9-]*, unique in the app
//           "cmd": "python3 -m http.server ${PORT:app}",   // a string runs through `sh -c`; an array is argv
//           "ports": { "app": 8000 },                       // name → BASE port; every port shifts by one offset
//           "env": { "KEY": "value" },                      // optional; values substitute like cmd
//           "primary": true,                                // optional; the process the app URL points at
//           "ready": { "http": "/" },                       // optional; what "up" means for the primary
//           "url": [{ "param": "emulate", "value": "none", "when": "skipped" }],          // optional
//           "advice": [{ "when": "contended", "text": "…" }]                               // optional
//         }
//       ]
//     }
//   }
// }
//
// Substitutions in cmd / env / url values: ${PORT:<name>} (that port, shifted), ${OFFSET}, ${TREE} (the
// served tree's absolute path), ${APP}, ${STACK_DIR} (this stack's own state dir). Every process also gets
// PORT_<NAME> for every port of the app, PORT_OFFSET when the stack is shifted, and DEV_STACK_DIR — the
// directory that is this stack's alone (tree + app + offset), where a process keeps anything a tool would
// otherwise key by something every stack shares (a TMPDIR, a lock, a locator file). See lib/stacks.mjs. A bare PORT is NOT exported: it is a convention some runtimes act on
// (a Cloud Functions worker, say) — a server that wants it declares `"env": { "PORT": "${PORT:app}" }`.
//
// url[].when    always | offset (stack shifted) | running (this process runs) | skipped (--skip'ed)
// advice[].when always | base (stack on its base ports) | offset | contended (base ports owned elsewhere)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DECLARATION_PATH = '.bespunky/dev.json';

const ID = /^[a-z][a-z0-9-]*$/;
const PORT_NAME = /^[a-z][a-z0-9_-]*$/;
const URL_WHEN = ['always', 'offset', 'running', 'skipped'];
const ADVICE_WHEN = ['always', 'base', 'offset', 'contended'];

export class DeclarationError extends Error {}

const fail = (where, message) => {
  throw new DeclarationError(`${DECLARATION_PATH}: ${where}: ${message}`);
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCmd = (v) =>
  (typeof v === 'string' && v.trim() !== '') ||
  (Array.isArray(v) && v.length > 0 && v.every((w) => typeof w === 'string'));

/** Read and validate the declaration at `root`; `null` when the tree has none. */
export function loadDeclaration(root) {
  const file = join(root, DECLARATION_PATH);
  if (!existsSync(file)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new DeclarationError(`${file}: not valid JSON — ${err.message}`);
  }
  return validate(parsed);
}

/** Validate a parsed declaration; returns it unchanged, or throws a DeclarationError naming the field. */
export function validate(decl) {
  if (!isObject(decl)) fail('root', 'must be an object');
  if (decl.install !== undefined) {
    if (!isObject(decl.install) || !isCmd(decl.install.cmd)) fail('install', 'must be { "cmd": string | string[], "creates"?: string }');
    if (decl.install.creates !== undefined && typeof decl.install.creates !== 'string') fail('install.creates', 'must be a path');
  }
  if (!isObject(decl.apps) || Object.keys(decl.apps).length === 0) fail('apps', 'must declare at least one app');

  for (const [name, app] of Object.entries(decl.apps)) {
    const at = `apps.${name}`;
    if (!isObject(app) || !Array.isArray(app.processes) || app.processes.length === 0) fail(at, 'must have a non-empty "processes" array');
    const ids = new Set();
    const portNames = new Set();
    let primaries = 0;
    app.processes.forEach((p, i) => {
      const pat = `${at}.processes[${i}]`;
      if (!isObject(p)) fail(pat, 'must be an object');
      if (typeof p.id !== 'string' || !ID.test(p.id)) fail(`${pat}.id`, 'must match [a-z][a-z0-9-]*');
      if (ids.has(p.id)) fail(`${pat}.id`, `"${p.id}" is declared twice`);
      ids.add(p.id);
      if (!isCmd(p.cmd)) fail(`${pat}.cmd`, 'must be a command string or a non-empty argv array');
      if (p.ports !== undefined && !isObject(p.ports)) fail(`${pat}.ports`, 'must map a name to a base port');
      for (const [port, base] of Object.entries(p.ports ?? {})) {
        if (!PORT_NAME.test(port) || port === 'offset') fail(`${pat}.ports.${port}`, 'must match [a-z][a-z0-9_-]* and not be "offset"');
        if (portNames.has(port)) fail(`${pat}.ports.${port}`, 'port names are unique across the app');
        portNames.add(port);
        if (!Number.isInteger(base) || base < 1 || base > 65535) fail(`${pat}.ports.${port}`, 'must be a port number');
      }
      if (p.env !== undefined && (!isObject(p.env) || !Object.values(p.env).every((v) => typeof v === 'string'))) fail(`${pat}.env`, 'must map names to strings');
      if (p.primary !== undefined && typeof p.primary !== 'boolean') fail(`${pat}.primary`, 'must be a boolean');
      if (p.primary) {
        primaries++;
        if (!Object.keys(p.ports ?? {}).length) fail(`${pat}.primary`, 'the primary process must declare a port');
      }
      if (p.ready !== undefined && !(isObject(p.ready) && typeof p.ready.http === 'string')) fail(`${pat}.ready`, 'must be { "http": "<path>" }');
      for (const [j, u] of (p.url ?? []).entries()) {
        if (!isObject(u) || typeof u.param !== 'string' || typeof u.value !== 'string' || !URL_WHEN.includes(u.when ?? 'always')) {
          fail(`${pat}.url[${j}]`, `must be { "param", "value", "when"?: ${URL_WHEN.join('|')} }`);
        }
      }
      for (const [j, a] of (p.advice ?? []).entries()) {
        if (!isObject(a) || typeof a.text !== 'string' || !ADVICE_WHEN.includes(a.when ?? 'always')) {
          fail(`${pat}.advice[${j}]`, `must be { "text", "when"?: ${ADVICE_WHEN.join('|')} }`);
        }
      }
    });
    if (primaries > 1) fail(at, 'at most one process may be "primary"');
    if (portNames.size === 0) fail(at, 'must declare at least one port');
  }
  return decl;
}

/** The app to serve: the one named, else the only one declared. */
export function pickApp(decl, name) {
  const names = Object.keys(decl.apps);
  if (name) {
    if (!decl.apps[name]) throw new DeclarationError(`no app "${name}" in ${DECLARATION_PATH} (declared: ${names.join(', ')})`);
    return name;
  }
  if (names.length === 1) return names[0];
  throw new DeclarationError(`${DECLARATION_PATH} declares ${names.length} apps — name one: ${names.join(', ')}`);
}

/** The primary process: the one marked, else the first that declares a port. */
export function primaryOf(app) {
  return app.processes.find((p) => p.primary) ?? app.processes.find((p) => Object.keys(p.ports ?? {}).length);
}

/** Every base port the app declares, across all its processes. */
export function declaredPorts(app) {
  return app.processes.flatMap((p) => Object.values(p.ports ?? {}));
}

/**
 * Every base port a serve will actually BIND — each process it runs, not only the primary. This is what decides
 * whether a port block is free: a block whose app port is free but whose emulator hub is held would be accepted,
 * and the suite would then fail to bind.
 */
export function boundPorts(app, skip = []) {
  return app.processes.filter((p) => !skip.includes(p.id)).flatMap((p) => Object.values(p.ports ?? {}));
}

const envName = (port) => `PORT_${port.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

const shellQuote = (word) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`);

/**
 * Resolve an app into exactly what a serve runs — pure, so a dry run and a real run cannot disagree.
 *
 *   offset       the resolved port offset
 *   tree         the served tree's absolute path
 *   skip         process ids not to run
 *   passthrough  extra argv for the PRIMARY process (`dev serve app -- --flag`)
 *   baseEnv      the environment the children inherit
 *   stackDir     this stack's own state dir (lib/stacks.mjs) — DEV_STACK_DIR / ${STACK_DIR}
 */
export function planApp(decl, appName, { offset, tree, skip = [], passthrough = [], baseEnv = {}, stackDir }) {
  const app = decl.apps[appName];
  const primary = primaryOf(app);
  const ids = app.processes.map((p) => p.id);
  // An unknown id is REPORTED, not refused: `nx serve <app> --no-emulators` on an app without an emulator
  // suite has always been a harmless no-op, and a typo is visible in the plan's `ignoredSkips`.
  const ignoredSkips = skip.filter((id) => !ids.includes(id));
  if (skip.includes(primary.id)) throw new DeclarationError(`--skip=${primary.id}: that is the app's primary process — nothing would be served`);

  const ports = {};
  for (const p of app.processes) for (const [name, base] of Object.entries(p.ports ?? {})) ports[name] = base + offset;

  const subst = (text, where) =>
    text.replace(/\$\{([A-Z_]+)(?::([a-z0-9_-]+))?\}/g, (whole, kind, arg) => {
      if (kind === 'PORT' && arg !== undefined) {
        if (ports[arg] === undefined) throw new DeclarationError(`${where}: ${whole} names no declared port (has: ${Object.keys(ports).join(', ')})`);
        return String(ports[arg]);
      }
      if (arg === undefined && kind === 'OFFSET') return String(offset);
      if (arg === undefined && kind === 'TREE') return tree;
      if (arg === undefined && kind === 'APP') return appName;
      if (arg === undefined && kind === 'STACK_DIR' && stackDir) return stackDir;
      throw new DeclarationError(`${where}: unknown substitution ${whole} (known: \${PORT:<name>} \${OFFSET} \${TREE} \${APP} \${STACK_DIR})`);
    });

  const portEnv = Object.fromEntries(Object.entries(ports).map(([name, port]) => [envName(name), String(port)]));

  const processes = app.processes.map((p) => {
    const where = `apps.${appName}.${p.id}`;
    const extra = p.id === primary.id ? passthrough : [];
    const added = {
      ...Object.fromEntries(Object.entries(p.env ?? {}).map(([k, v]) => [k, subst(v, `${where}.env.${k}`)])),
      ...portEnv,
      ...(offset > 0 ? { PORT_OFFSET: String(offset) } : {}),
      ...(stackDir ? { DEV_STACK_DIR: stackDir } : {}),
    };
    const shell = typeof p.cmd === 'string';
    const command = shell ? [subst(p.cmd, `${where}.cmd`), ...extra.map(shellQuote)].join(' ') : subst(p.cmd[0], `${where}.cmd`);
    const args = shell ? [] : [...p.cmd.slice(1).map((w) => subst(w, `${where}.cmd`)), ...extra];
    return {
      id: p.id,
      primary: p.id === primary.id,
      skipped: skip.includes(p.id),
      shell,
      command,
      args,
      display: shell ? command : [command, ...args].join(' '),
      ports: Object.fromEntries(Object.entries(p.ports ?? {}).map(([n, b]) => [n, b + offset])),
      added,
      env: { ...baseEnv, ...added },
      ready: p.ready ? subst(p.ready.http, `${where}.ready`) : '/',
    };
  });

  const holds = (when, proc) =>
    when === 'always' ||
    (when === 'offset' && offset > 0) ||
    (when === 'base' && offset === 0) ||
    (when === 'running' && !proc.skipped) ||
    (when === 'skipped' && proc.skipped);

  const query = new URLSearchParams();
  const advice = [];
  app.processes.forEach((p, i) => {
    for (const u of p.url ?? []) if (holds(u.when ?? 'always', processes[i])) query.set(u.param, subst(u.value, `apps.${appName}.${p.id}.url`));
    for (const a of p.advice ?? []) advice.push({ when: a.when ?? 'always', text: subst(a.text, `apps.${appName}.${p.id}.advice`) });
  });

  const primaryPlan = processes.find((p) => p.primary);
  const primaryPort = Object.values(primaryPlan.ports)[0];
  const q = query.toString() ? `?${query}` : '';
  return {
    app: appName,
    ignoredSkips,
    processes,
    running: processes.filter((p) => !p.skipped),
    primary: primaryPlan,
    primaryPort,
    query: q,
    localUrl: `http://localhost:${primaryPort}/${q}`,
    readyUrl: `http://127.0.0.1:${primaryPort}${primaryPlan.ready.startsWith('/') ? '' : '/'}${primaryPlan.ready}`,
    advice: advice.filter((a) => holds(a.when, {}) || a.when === 'contended'),
  };
}
