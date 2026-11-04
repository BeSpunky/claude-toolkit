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
//           "exports": { "KEY": "127.0.0.1:${PORT:app}" },  // optional; what a DEPENDENT of the stack is told (below)
//           "primary": true,                                // optional; the process the app URL points at
//           "dependency": true,                             // optional; the stack waits for it (below)
//           "ready": { "http": "/" },                       // what "up" means: for the primary (optional) or a dependency (required)
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
// PORT_<NAME> for every port of the app, PORT_OFFSET (0 on the base stack), DEV_URL_QUERY when the app is
// opened with URL switches (the same query, for a server that must resolve what the page resolves), DEV_STACK_DIR —
// the directory that is this stack's alone (tree + app + offset), where a process keeps anything a tool would
// otherwise key by something every stack shares (a lock, a locator file) — and DEV_STACK_TMP, the stack's own SHORT
// temp dir, for a tool that keys its state by os.tmpdir() (see lib/stacks.mjs stackTmp) — and DEV_STACK_LOCK, the stack's
// lock, which a process that must keep the stack alive past its own parent holds (tools/emulators.sh's keeper does).
// A command run by `tools/dev/dev run` gets the same, plus DEV_RUN=<the name it was run under>.
// None of these is ever INHERITED: a stack started from inside another stack's process gets its own, and one this
// stack does not set is removed, never left at an outer stack's value. A bare PORT is NOT exported: it is a
// convention some runtimes act on (a Cloud Functions worker, say) — a server that wants it declares
// `"env": { "PORT": "${PORT:app}" }`.
//
// EXPORTS are the stack's ADDRESS for whatever runs AGAINST it — an e2e run (`tools/dev/dev with <app> -- …`):
// BASE_URL (the primary's origin), DEV_URL, DEV_URL_QUERY, PORT_OFFSET and PORT_<NAME>, plus each running process's
// own `exports` (an emulator suite declares its FIREBASE_*_EMULATOR_HOST there).
//
// DEPENDENCIES are what the rest of the stack needs up before it starts (a database, a local backend). They start first,
// in declaration order, each only once the one before it is READY — and only when the last is does anything else
// start. What a dependency `exports` reaches every sibling's environment as well as a dependent's, which is how a
// capability delivers DATABASE_URL without editing the project's own process (a process's own `env` wins: it is the
// project's word). A `--skip`'ed dependency exports nothing, so a sibling then sees whatever the environment says.
//
// A dependency runs for as long as the stack does. There is no one-shot: a launcher does its own migrate and seed BEFORE
// it reports ready. So its exit is always a failure of the stack, whatever the code: before it is ready nothing else
// ever starts, after it the stack stops.
//
// ready        exactly one of
//                { "http": "<path>" }        the process's first port answers (any status)
//                { "tcp": "<port name>" }    that port, one of the process's own, accepts a connection
//                { "cmd": "<shell>" }        the command exits 0, in the process's environment; substitutes like cmd
//              and, on a dependency, "timeout": <seconds> (default 120), past which the stack fails, naming it. A port
//              accepting a connection is not always ready: a launcher that migrates and seeds has `cmd` ask for the
//              marker it writes last, in ${STACK_DIR} (which dies with the stack, so it cannot go stale).
//
// url[].when    always | offset (stack shifted) | running (this process runs) | skipped (--skip'ed)
// advice[].when always | base (stack on its base ports) | offset | contended (base ports owned elsewhere) — a
//               --skip'ed process's advice is never given
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DECLARATION_PATH = '.bespunky/dev.json';

const ID = /^[a-z][a-z0-9-]*$/;
const PORT_NAME = /^[a-z][a-z0-9_-]*$/;
const URL_WHEN = ['always', 'offset', 'running', 'skipped'];
const ADVICE_WHEN = ['always', 'base', 'offset', 'contended'];
const READY_KINDS = ['http', 'tcp', 'cmd'];
const READY_TIMEOUT_S = 120;

export class DeclarationError extends Error {}

const fail = (where, message) => {
  throw new DeclarationError(`${DECLARATION_PATH}: ${where}: ${message}`);
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCmd = (v) =>
  (typeof v === 'string' && v.trim() !== '') ||
  (Array.isArray(v) && v.length > 0 && v.every((w) => typeof w === 'string'));

/** `ready`, whichever kind it is — and what makes it illegal on this process. */
function validateReady(p, pat) {
  const at = `${pat}.ready`;
  if (p.ready === undefined) {
    if (p.dependency) fail(at, 'a dependency must say what ready means: { "tcp": "<port name>" }, { "cmd": "<shell>" } or { "http": "<path>" } — nothing else starts until it is');
    return;
  }
  if (!isObject(p.ready)) fail(at, 'must be { "http": "<path>" }, { "tcp": "<port name>" } or { "cmd": "<shell>" }');
  const kinds = READY_KINDS.filter((kind) => p.ready[kind] !== undefined);
  const stray = Object.keys(p.ready).filter((key) => !READY_KINDS.includes(key) && key !== 'timeout');
  if (kinds.length !== 1 || stray.length) fail(at, `must name exactly one of ${READY_KINDS.join(', ')}${stray.length ? ` (unknown: ${stray.join(', ')})` : ''}`);
  const value = p.ready[kinds[0]];
  if (typeof value !== 'string' || (kinds[0] !== 'http' && value.trim() === '')) fail(`${at}.${kinds[0]}`, 'must be a string');
  if (kinds[0] === 'tcp' && p.ports?.[value] === undefined) fail(`${at}.tcp`, `"${value}" is not a port this process declares (has: ${Object.keys(p.ports ?? {}).join(', ') || 'none'})`);
  if (kinds[0] === 'http' && p.dependency && !Object.keys(p.ports ?? {}).length) fail(`${at}.http`, 'this process declares no port to ask');
  if (p.ready.timeout !== undefined) {
    if (!p.dependency) fail(`${at}.timeout`, 'only a dependency is waited for, so only a dependency has a timeout');
    if (typeof p.ready.timeout !== 'number' || !(p.ready.timeout > 0)) fail(`${at}.timeout`, 'must be a positive number of seconds');
  }
}

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
    const exported = new Map();
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
      for (const field of ['env', 'exports']) {
        if (p[field] !== undefined && (!isObject(p[field]) || !Object.values(p[field]).every((v) => typeof v === 'string'))) fail(`${pat}.${field}`, 'must map names to strings');
      }
      if (p.primary !== undefined && typeof p.primary !== 'boolean') fail(`${pat}.primary`, 'must be a boolean');
      if (p.primary) {
        primaries++;
        if (!Object.keys(p.ports ?? {}).length) fail(`${pat}.primary`, 'the primary process must declare a port');
      }
      if (p.dependency !== undefined && typeof p.dependency !== 'boolean') fail(`${pat}.dependency`, 'must be a boolean');
      if (p.dependency && p.primary) fail(`${pat}.primary`, 'a dependency cannot be the primary: the app URL points at what depends on it');
      if (p.dependency) {
        for (const name of Object.keys(p.exports ?? {})) {
          if (isStackVariable(name)) fail(`${pat}.exports.${name}`, 'the engine sets this variable itself for every process, so a sibling would never see this value');
          if (exported.has(name)) fail(`${pat}.exports.${name}`, `dependency "${exported.get(name)}" already exports it, and a sibling can receive only one`);
          exported.set(name, p.id);
        }
      }
      validateReady(p, pat);
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
    if (!app.processes.some((p) => !p.dependency && Object.keys(p.ports ?? {}).length)) fail(at, 'needs a process that is not a dependency and declares a port: the one the dependencies are for, and the app URL points at');
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

/** The primary process: the one marked, else the first that declares a port and is not a dependency. */
export function primaryOf(app) {
  return app.processes.find((p) => p.primary) ?? app.processes.find((p) => !p.dependency && Object.keys(p.ports ?? {}).length);
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

/** The stack's own variables — every process gets its own values, never an outer stack's (see the header). */
const STACK_ENV = ['PORT_OFFSET', 'DEV_URL_QUERY', 'DEV_STACK_DIR', 'DEV_STACK_TMP', 'DEV_STACK_LOCK', 'DEV_RUN'];

const envName = (port) => `PORT_${port.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

const isStackVariable = (name) => STACK_ENV.includes(name) || name.startsWith('PORT_');

const shellQuote = (word) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`);

/** The environment of a `dev run` command: what a process of a serve gets, for a stack with no declaration. `ports` are shifted. */
export function runEnv(baseEnv, { app, ports, offset, stackDir, stackTmp, stackLock }) {
  const inherited = { ...baseEnv };
  for (const k of STACK_ENV) delete inherited[k];
  return {
    ...inherited,
    ...Object.fromEntries(Object.entries(ports).map(([name, port]) => [envName(name), String(port)])),
    PORT_OFFSET: String(offset),
    DEV_STACK_DIR: stackDir,
    DEV_STACK_TMP: stackTmp,
    DEV_STACK_LOCK: stackLock,
    DEV_RUN: app,
  };
}

/**
 * Resolve an app into exactly what a serve runs — pure, so a dry run and a real run cannot disagree.
 *
 *   offset       the resolved port offset
 *   tree         the served tree's absolute path
 *   skip         process ids not to run
 *   passthrough  extra argv for the PRIMARY process (`dev serve app -- --flag`)
 *   baseEnv      the environment the children inherit
 *   stackDir     this stack's own state dir (lib/stacks.mjs) — DEV_STACK_DIR / ${STACK_DIR}
 *   stackTmp     this stack's own short TMPDIR (lib/stacks.mjs stackTmp) — DEV_STACK_TMP
 *   stackLock    this stack's lock file (lib/stacks.mjs holdStackLock) — DEV_STACK_LOCK
 */
export function planApp(decl, appName, { offset, tree, skip = [], passthrough = [], baseEnv = {}, stackDir, stackTmp, stackLock }) {
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

  const holds = (when, proc) =>
    when === 'always' ||
    (when === 'offset' && offset > 0) ||
    (when === 'base' && offset === 0) ||
    (when === 'running' && !proc.skipped) ||
    (when === 'skipped' && proc.skipped);

  // The URL switches the app is opened with — and, as DEV_URL_QUERY, what every process of the stack is told: a
  // server rendering the app resolves exactly what the page it hydrates was opened with.
  const query = new URLSearchParams();
  for (const p of app.processes) {
    for (const u of p.url ?? []) if (holds(u.when ?? 'always', { skipped: skip.includes(p.id) })) query.set(u.param, subst(u.value, `apps.${appName}.${p.id}.url`));
  }

  const portEnv = Object.fromEntries(Object.entries(ports).map(([name, port]) => [envName(name), String(port)]));
  // The stack's own identity — set whole, never inherited: what an outer stack left in the environment is removed.
  const inherited = { ...baseEnv };
  for (const k of STACK_ENV) delete inherited[k];
  const stackEnv = {
    PORT_OFFSET: String(offset),
    ...(stackDir ? { DEV_STACK_DIR: stackDir } : {}),
    ...(stackTmp ? { DEV_STACK_TMP: stackTmp } : {}),
    ...(stackLock ? { DEV_STACK_LOCK: stackLock } : {}),
    ...(query.size ? { DEV_URL_QUERY: query.toString() } : {}),
  };

  const exportsOf = Object.fromEntries(
    app.processes.map((p) => [p.id, Object.fromEntries(Object.entries(p.exports ?? {}).map(([k, v]) => [k, subst(v, `apps.${appName}.${p.id}.exports.${k}`)]))]),
  );
  const dependencies = app.processes.filter((p) => p.dependency && !skip.includes(p.id));

  const probeOf = (p, where) => {
    if (!p.dependency && p.id !== primary.id) return null; // nothing asks: only the primary and a dependency are waited on
    const ready = p.ready ?? { http: '/' };
    if (ready.tcp !== undefined) return { tcp: p.ports[ready.tcp] + offset };
    if (ready.cmd !== undefined) return { cmd: subst(ready.cmd, `${where}.ready`) };
    const path = subst(ready.http, `${where}.ready`);
    return { http: `http://127.0.0.1:${Object.values(p.ports)[0] + offset}${path.startsWith('/') ? '' : '/'}${path}` };
  };

  const processes = app.processes.map((p) => {
    const where = `apps.${appName}.${p.id}`;
    const extra = p.id === primary.id ? passthrough : [];
    const added = {
      ...Object.assign({}, ...dependencies.filter((d) => d.id !== p.id).map((d) => exportsOf[d.id])),
      ...Object.fromEntries(Object.entries(p.env ?? {}).map(([k, v]) => [k, subst(v, `${where}.env.${k}`)])),
      ...portEnv,
      ...stackEnv,
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
      env: { ...inherited, ...added },
      exports: exportsOf[p.id],
      dependency: Boolean(p.dependency),
      ready: probeOf(p, where),
      readyTimeoutMs: (p.ready?.timeout ?? READY_TIMEOUT_S) * 1000,
    };
  });

  // A process's advice is about that process: a skipped one has nothing to say.
  const advice = [];
  app.processes.forEach((p) => {
    if (skip.includes(p.id)) return;
    for (const a of p.advice ?? []) advice.push({ when: a.when ?? 'always', text: subst(a.text, `apps.${appName}.${p.id}.advice`) });
  });

  const primaryPlan = processes.find((p) => p.primary);
  const primaryPort = Object.values(primaryPlan.ports)[0];
  const q = query.toString() ? `?${query}` : '';
  const running = processes.filter((p) => !p.skipped);
  const exports = {
    BASE_URL: `http://localhost:${primaryPort}`,
    DEV_URL: `http://localhost:${primaryPort}/${q}`,
    PORT_OFFSET: String(offset),
    ...(query.size ? { DEV_URL_QUERY: query.toString() } : {}),
    ...Object.fromEntries(running.flatMap((p) => Object.entries(p.ports)).map(([name, port]) => [envName(name), String(port)])),
    ...Object.assign({}, ...running.map((p) => p.exports)),
  };
  return {
    app: appName,
    ignoredSkips,
    processes,
    running,
    exports,
    primary: primaryPlan,
    primaryPort,
    query: q,
    localUrl: `http://localhost:${primaryPort}/${q}`,
    advice: advice.filter((a) => holds(a.when, {}) || a.when === 'contended'),
  };
}
