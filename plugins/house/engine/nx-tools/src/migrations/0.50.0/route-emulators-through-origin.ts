// 0.50.0 — the browser reaches EVERY Firebase emulator through the app's own origin; the per-service `proxied`
// switch, and the browser's port offset, are gone.
//
// WHY. The browser is the one party that cannot know the emulators' ports: on the host, the editor forwards
// container ports to whatever host port is free (4200→4201, 8080→8081) without telling anything in the container,
// and a worktree's stack sits at basePort + offset. Auth and callables already went through the dev server's
// origin when `proxied` was set — but Firestore and Storage always dialled their ports, and 0.24.3 deliberately
// left `proxied` OFF for every project that predated it, so those dialled 9099 too. Now the generator-owned
// firebase.config.ts connects every emulated service to `location` in the browser and to the container address +
// PORT_OFFSET on a server, and proxy.conf.mjs relays all four. Whether a service is relayed is no longer a property
// of the service, so the switch is retired rather than flipped.
//
// WHAT IT CHANGES — each app the house wired for Firebase (it has src/app/firebase.config.ts):
//   - src/environments/*.ts (SEEDED, the project's own values): removes every `proxied` member from the
//     `emulators` block and its type, and the house's comment paragraphs explaining it. SURGICAL: hosts, ports,
//     `default`s and anything the project added stay byte-for-byte. The value files and the interface type each
//     other — an interface without `proxied` rejects a value file that still has it — so a directory is written
//     whole or not at all, and what it could not edit is reported. A `proxied: false` is reported by name: that
//     service dialled its port directly and is relayed now (there is no direct-dial option any more).
//   - The house's "Local emulator endpoints" comment, when it is still the verbatim text, is replaced: it told the
//     reader to keep the devcontainer's forwardPorts in step, which the browser no longer depends on.
//   - The generator-owned client glue (firebase*.config.ts, emulator-overrides.ts, proxy.conf.mjs) is rewritten to
//     the current templates — the 0.49 copies read `proxied`, and an UPGRADE_PARTIAL run skips the generator — and
//     proxy.local.mjs, the project's own routes that proxy.conf.mjs merges, is seeded beside it (once, never again).
//   - The app's dev server is pointed at proxy.conf.mjs when it names no proxy config. Before 0.50 only callables
//     depended on that relay; now EVERY emulated service does, so a dev server that does not use it is reported by
//     name with exactly what to add: one with a proxy config of its own (kept — it is theirs), or one the house
//     cannot configure.
//   - .bespunky/dev.json (project state): drops the `?portOffset=${OFFSET}` URL switch the house seeded on the
//     emulators process — the page no longer reads it — and gives that process the banner advice a new app gets:
//     where this stack's Emulator UI works (a host tab only on the base stack with same-number forwards).
//   - The house's own words that this change made false, where they still stand VERBATIM (anything reworded is the
//     project's, and stays): the .gitignore block's `<app>:serve --portOffset` (the flag is `--port-offset`), and
//     the devcontainer's dev-server port comment that said every Firebase port must forward to the SAME host number
//     (now only the Emulator UI wants that). Neither file is regenerated whole — the .gitignore block is appended
//     once and the devcontainer merge never rewrites a comment — so without this they would explain a world that
//     is gone, forever.
// WHAT IT REPORTS, never edits: the project's own code importing what the owned files no longer export
// (`emulatorFor`, `portOffset`, `offsetUrl`, `resolvePortOffset` → `emulatorEndpoint(service)`), a dev server
// served over https, where the SDK cannot reach an emulator through the page's origin, and a dev server that does
// not relay (above).
import { type Tree, getProjects, logger, readJson } from '@nx/devkit';
import { applyJsonChanges } from '../../generators/_utils/json-edits';
import { findAppRoots } from '../../generators/_utils/app-roots';
import { writeFirebaseClientGlue } from '../../generators/firebase-emulators/service-configs';
import { reportProxyWiring } from '../../generators/firebase-emulators/proxy-wiring';
import { EMULATOR_UI_ADVICE } from '../../generators/firebase-emulators/dev-fragment';
import { angular } from '../../adapters/angular';

const TAG = '[0.50.0 route-emulators-through-origin]';
const DEV_JSON = '.bespunky/dev.json';
const INTERFACE = 'environment.interface.ts';
const RETIRED_EXPORTS = ['emulatorFor', 'portOffset', 'offsetUrl', 'resolvePortOffset'];
/** The generator-owned client files — rewritten in full by this rung (and the generator), so never scanned. */
const OWNED = /^(firebase(-[a-z]+)?\.config|emulator-overrides)\.ts$/;

/**
 * The house's pre-0.50 comments above `emulators` — one is replaced only when it is still exactly its text. Both
 * shipped and both tell the reader to keep the devcontainer's forwardPorts in step: the per-service one (703ca41 …
 * 0.49), and the pre-toggle one (6106999 … 703ca41~1), which 0.24.3 converted the values beneath but never rewrote.
 */
const OLD_ENDPOINTS_COMMENTS: Array<{ old: string[]; next: () => string[] }> = [
  {
    next: () => NEW_ENDPOINTS_COMMENT,
    old: [
      '// Local emulator endpoints (match firebase.json at the workspace root — change a port there and',
      "// change it here too, AND in the devcontainer's forwardPorts). Each entry's `default` comes from",
      '// EMULATE above; the endpoint is always present so a runtime `?emulate=<service>` can switch a',
      '// defaulted-off service back on.',
    ],
  },
  {
    // The pre-toggle file has no EMULATE map (0.24.3 wrote literal `default`s), so its replacement says nothing of it.
    next: () => NEW_ENDPOINTS_COMMENT.slice(NEW_ENDPOINTS_COMMENT.indexOf('//') + 1),
    old: [
      '// Emulator endpoints. Match `firebase.json` at the workspace root — if you',
      "// change a port there, change it here too, AND in the devcontainer's",
      '// `forwardPorts` (all three speak about the same local emulator suite;',
      "// there's no auto-sync).",
    ],
  },
];
const NEW_ENDPOINTS_COMMENT = [
  "// Each emulated service's `default` comes from EMULATE above; the entry is always present so a runtime",
  '// `?emulate=<service>` can switch a defaulted-off service back on.',
  '//',
  "// THE BROWSER NEVER DIALS THESE ADDRESSES. In the browser every emulator is reached through the dev server's",
  "// OWN origin — its proxy.conf.mjs relays each one to the suite inside the container, shifted for a worktree's",
  '// stack — so a host browser needs only the port the app loaded on, whatever the editor forwarded it to. The',
  '// addresses below are where the suite listens INSIDE the container: what server-side code (SSR) dials, shifted',
  "// by the stack's PORT_OFFSET. Keep them in step with firebase.json at the workspace root.",
];

export default function routeEmulatorsThroughOrigin(tree: Tree): void {
  if (!tree.exists('firebase.json')) return;
  const apps = findAppRoots(tree, (root) => tree.exists(`${root}/src/app/firebase.config.ts`));
  for (const root of apps) {
    const prefix = root === '.' ? '' : `${root}/`;
    migrateEnvironments(tree, `${prefix}src/environments`);
    // The owned client glue is rewritten HERE, not left to the per-app generator: an UPGRADE_PARTIAL run skips that
    // generator, and the 0.49 clients read `proxied` — with it gone they would silently dial :9099/:5001 again.
    const proxy = writeFirebaseClientGlue(tree, root === '.' ? '.' : root);
    const project = projectAt(tree, root);
    if (project) reportProxyWiring(TAG.slice(1, -1), project, proxy, angular.devServer!.useProxy(tree, project, proxy));
    reportRetiredImports(tree, `${prefix}src`);
  }
  reportHttpsDevServers(tree, apps);
  migrateDevDeclaration(tree);
  retellRetiredText(tree);
}

/** The project whose root is `root` — the app the dev server belongs to — or undefined when Nx knows none there. */
function projectAt(tree: Tree, root: string): string | undefined {
  for (const [name, config] of getProjects(tree)) if ((config.root || '.') === root) return name;
  return undefined;
}

// ── the house's words this change made false ────────────────────────────────────────────────────────────────

/**
 * Each: the file, every shape the house shipped of the retired lines (verbatim, any indentation — each shape named by
 * the sha that wrote it), and what replaces them at that indentation. A file is appended to once and never rewritten,
 * so the OLDEST shape lives on as long as the newest.
 */
const RETIRED_TEXT: Array<{ file: string; old: string[][]; next: string[]; what: string }> = [
  {
    file: '.gitignore',
    what: 'the port-offset stacks comment (the flag is --port-offset now)',
    old: [
      ['# Isolated port-offset stacks (`<app>:serve --portOffset`): each gets its own data dir'], // 60bd79f (0.3.0) → 0.49
      ['# Isolated port-offset stacks (`<app>:serve-worktree --portOffset`): each gets its own data dir'], // ec7abcb (0.2.x)
    ],
    next: ['# Isolated port-offset stacks (`nx serve <app> --port-offset=N`): each gets its own data dir'],
  },
  {
    file: '.devcontainer/devcontainer.json',
    what: 'the dev-server port comment (the app no longer needs its emulator ports on the same host number)',
    old: [
      [
        // 0.36 → 0.49
        '// Firebase forwards the dev server + emulator ports to the SAME host port: the Firebase SDK inside a',
        '// host-loaded page dials hardcoded localhost:<port> addresses that only resolve if the port is identical.',
        '// KNOWN LIMITATION: several Firebase devcontainers in parallel collide on these host ports (first come wins;',
        '// real Google OAuth is pinned to whichever holds the dev-server port). The shared browser runs INSIDE the',
        '// container and reaches them on loopback, so it works for every container.',
      ],
      [
        // 7aafe46 (0.35.0 – 0.36.x): layers/firebase.ts, wrapped on `:4200`
        '// Firebase forwards the dev server + emulator ports to the SAME host port: the Firebase SDK inside a',
        '// host-loaded page dials hardcoded localhost:<port> addresses that only resolve if the port is identical.',
        '// KNOWN LIMITATION: several Firebase devcontainers in parallel collide on these host ports (first come wins;',
        '// real Google OAuth is pinned to whichever holds :4200). The shared browser runs INSIDE the container and',
        '// reaches them on loopback, so it works for every container.',
      ],
    ],
    next: [
      "// The app reaches every Firebase emulator through the dev server's own origin (proxy.conf.mjs relays it),",
      '// so the app works on whatever host port this is forwarded to. The emulator ports below are for the',
      '// Emulator UI: its page dials each emulator directly, so the UI is complete in a host tab only while they',
      '// forward to the same number. Real Google OAuth is registered for one origin (the base dev-server port);',
      '// the shared browser runs INSIDE the container and reaches everything on loopback.',
    ],
  },
];

function retellRetiredText(tree: Tree): void {
  for (const { file, old: shapes, next, what } of RETIRED_TEXT) {
    if (!tree.exists(file)) continue;
    const text = tree.read(file, 'utf8') ?? '';
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(eol);
    let old: string[] = [];
    const at = lines.findIndex((_, i) => (old = shapes.find((shape) => shape.every((line, k) => lines[i + k]?.trim() === line)) ?? []).length > 0);
    if (at < 0) continue;
    const indent = /^[ \t]*/.exec(lines[at])![0];
    lines.splice(at, old.length, ...next.map((line) => `${indent}${line}`));
    tree.write(file, lines.join(eol));
    logger.info(`${TAG} ${file}: rewrote ${what}.`);
  }
}

// ── environment files ────────────────────────────────────────────────────────────────────────────────────────

interface Plan {
  path: string;
  content: string;
  removed: string[];
  direct: string[];
}

function migrateEnvironments(tree: Tree, dir: string): void {
  if (!tree.exists(dir) || tree.isFile(dir)) return;
  const files = tree
    .children(dir)
    .filter((name) => /^environment.*\.ts$/.test(name))
    .map((name) => `${dir}/${name}`);
  const plans: Plan[] = [];
  for (const path of files) {
    const source = tree.read(path, 'utf8') ?? '';
    const plan = planFile(path, source, !path.endsWith(`/${INTERFACE}`));
    if (plan === null) {
      // Half a directory does not compile (see the header) — leave all of it, and say what to do by hand.
      logger.warn(
        `${TAG} Left ${dir} unchanged — ${path} mentions \`proxied\` in a shape this rung cannot edit safely. ` +
          `Remove every \`proxied\` member from the \`emulators\` block of the environment files AND from its type in ` +
          `${INTERFACE} by hand: the switch is gone (every emulator is reached through the dev server's origin), and ` +
          `the generator-owned firebase.config.ts no longer reads it.`,
      );
      return;
    }
    if (plan) plans.push(plan);
  }
  for (const plan of plans) {
    tree.write(plan.path, plan.content);
    logger.info(
      `${TAG} ${plan.path}: ${plan.removed.length ? `removed \`proxied\` from ${plan.removed.join(', ')}` : 'updated the emulator comments'} — the browser now reaches ` +
        `every emulator through the dev server's own origin, so there is no per-service switch.`,
    );
    for (const service of plan.direct) {
      logger.warn(
        `${TAG} ${plan.path}: \`${service}\` had \`proxied: false\` — it dialled its emulator port directly. It is relayed ` +
          `through the dev server's origin now, like every service (there is no direct-dial option): the host browser ` +
          `needs only the app's port.`,
      );
    }
  }
}

/**
 * The edited file, `undefined` when there is nothing to do, `null` when it mentions `proxied` as code somewhere this
 * rung cannot reach (the directory is then left whole).
 */
function planFile(path: string, source: string, isValueFile: boolean): Plan | null | undefined {
  const masked = mask(source);
  const block = emulatorsBlock(masked);
  const removed: string[] = [];
  const direct: string[] = [];
  let content = source;

  if (block) {
    // Members of the emulators block: `<service>: { … }` (value) or `<service>?: { … }` (type).
    const member = /([A-Za-z_$][\w$]*)\s*\??\s*:\s*\{/g;
    member.lastIndex = block.open + 1;
    const edits: Array<{ start: number; end: number }> = [];
    for (let m = member.exec(masked); m && m.index < block.close; m = member.exec(masked)) {
      const open = m.index + m[0].length - 1;
      const close = matchBrace(masked, open);
      if (close < 0 || close > block.close) return null;
      const body = masked.slice(open + 1, close);
      const prop = /(^|[,;{\s])(proxied\s*\??\s*:\s*([^,;{}()\n]+?))\s*(?=[,;}]|$)/.exec(body);
      if (prop) {
        const start = open + 1 + prop.index + prop[1].length;
        const end = start + prop[2].length;
        edits.push(separatorAware(masked, start, end, open, close));
        removed.push(m[1]);
        if (isValueFile && source.slice(start, end).replace(/\s+/g, '').endsWith(':false')) direct.push(m[1]);
      }
      member.lastIndex = close + 1;
    }
    for (const { start, end } of edits.sort((a, b) => b.start - a.start)) content = content.slice(0, start) + content.slice(end);
  }

  content = dropProxiedParagraphs(content);
  if (isValueFile) content = replaceEndpointsComment(content);

  // Anything still naming `proxied` as CODE is a shape this rung did not understand.
  if (/\bproxied\b/.test(mask(content))) return null;
  if (content === source) return undefined;
  return { path, content, removed, direct };
}

/** Widen a member's span to take exactly one separator with it, so `{ a, proxied: x }` and `{ proxied: x, a }` both stay valid. */
function separatorAware(masked: string, start: number, end: number, open: number, close: number): { start: number; end: number } {
  let after = end;
  while (after < close && /\s/.test(masked[after])) after++;
  if (masked[after] === ',' || masked[after] === ';') {
    let next = after + 1;
    while (next < close && masked[next] === ' ') next++;
    return { start, end: next };
  }
  // Last member: take the separator BEFORE it instead.
  let before = start - 1;
  while (before > open && /\s/.test(masked[before])) before--;
  if (masked[before] === ',' || masked[before] === ';') {
    // Keep the whitespace before `}` as it was (`… , proxied: true }` → `… }`).
    return { start: before, end };
  }
  return { start, end };
}

/**
 * The house's explanation of `proxied`: in a run of `//` lines, the paragraph that starts with "// `proxied`" and runs
 * to the end of that run (every house version wrote it directly above the member it describes).
 */
function dropProxiedParagraphs(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\/\/ `proxied`/.test(lines[i])) {
      while (i + 1 < lines.length && /^\s*\/\//.test(lines[i + 1])) i++;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}

function replaceEndpointsComment(content: string): string {
  const lines = content.split('\n');
  for (const { old, next } of OLD_ENDPOINTS_COMMENTS) {
    for (let i = 0; i + old.length <= lines.length; i++) {
      if (old.every((text, k) => lines[i + k].trim() === text)) {
        const indent = /^\s*/.exec(lines[i])![0];
        lines.splice(i, old.length, ...next().map((text) => `${indent}${text}`));
        return lines.join('\n');
      }
    }
  }
  return content;
}

/** The `{ … }` of the `emulators` member (value or type), in masked coordinates. */
function emulatorsBlock(masked: string): { open: number; close: number } | null {
  const m = /(^|[\s;,{])emulators\s*\??\s*:\s*\{/.exec(masked);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchBrace(masked, open);
  return close < 0 ? null : { open, close };
}

function matchBrace(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Comments and string bodies blanked to spaces (newlines kept), so structure can be read off the text by position. */
function mask(source: string): string {
  let out = '';
  for (let i = 0; i < source.length; ) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      while (i < source.length && source[i] !== '\n') (out += ' '), i++;
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? source.length : end + 2;
      for (; i < stop; i++) out += source[i] === '\n' ? '\n' : ' ';
    } else if (source[i] === "'" || source[i] === '"' || source[i] === '`') {
      const quote = source[i];
      out += quote;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') (out += ' '), i++;
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < source.length) (out += quote), i++;
    } else {
      out += source[i++];
    }
  }
  return out;
}

// ── reports ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The project's own code importing what the owned client files no longer export. */
function reportRetiredImports(tree: Tree, srcDir: string): void {
  const walk = (dir: string): void => {
    if (!tree.exists(dir) || tree.isFile(dir)) return;
    for (const child of tree.children(dir)) {
      if (child.startsWith('.') || child === 'node_modules') continue;
      const path = `${dir}/${child}`;
      if (!tree.isFile(path)) {
        walk(path);
        continue;
      }
      if (!/\.(ts|mts|tsx)$/.test(child) || OWNED.test(child)) continue;
      const source = tree.read(path, 'utf8') ?? '';
      const imports = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"][^'"]*\/(?:firebase\.config|emulator-overrides)['"]/g;
      const named = new Set<string>();
      for (let m = imports.exec(source); m; m = imports.exec(source)) {
        for (const spec of m[1].split(',')) {
          const name = spec.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0];
          if (RETIRED_EXPORTS.includes(name)) named.add(name);
        }
      }
      if (named.size) {
        logger.warn(
          `${TAG} ${path} imports ${[...named].map((n) => `\`${n}\``).join(', ')}, which the generator-owned Firebase ` +
            `client files no longer export: the browser reaches every emulator through the dev server's origin, so it ` +
            `needs no port and no offset. Use \`emulatorEndpoint(service)\` from firebase.config.ts — the { host, port, ` +
            `origin } to connect a service to, for the browser and the server alike — or drop the import.`,
        );
      }
    }
  };
  walk(srcDir);
}

/** A dev server served over https cannot reach the emulators through its origin (the SDK dials them over http). */
function reportHttpsDevServers(tree: Tree, roots: string[]): void {
  for (const root of roots) {
    const projectJson = `${root === '.' ? '' : `${root}/`}project.json`;
    if (!tree.exists(projectJson)) continue;
    let targets: Record<string, { options?: { ssl?: unknown } }> = {};
    try {
      targets = readJson(tree, projectJson).targets ?? {};
    } catch {
      continue;
    }
    for (const name of ['dev-server', 'serve']) {
      if (targets[name]?.options?.ssl === true) {
        logger.warn(
          `${TAG} ${projectJson}: \`${name}\` serves over https (\`ssl: true\`). The browser now reaches every emulator ` +
            `through the page's own origin, and the Firebase SDK can dial an emulator over plain http only — so the ` +
            `emulated services will not connect (the console says so at bootstrap). Drop \`ssl\` for local ` +
            `development, or open the app with ?emulate=none to use the real backend.`,
        );
      }
    }
  }
}

// ── dev.json ─────────────────────────────────────────────────────────────────────────────────────────────────

interface UrlSwitch {
  param?: unknown;
  value?: unknown;
  when?: unknown;
}

interface DeclaredProcess {
  id?: string;
  cmd?: unknown;
  ports?: Record<string, unknown>;
  url?: UrlSwitch[];
  advice?: Array<{ text?: unknown; when?: unknown }>;
}

/** The emulators process the house seeded: its id, and a command that runs the workspace's `firebase:emulators`. */
const isHouseEmulators = (process: DeclaredProcess): boolean =>
  process?.id === 'emulators' &&
  (Array.isArray(process.cmd) ? process.cmd.join(' ') : String(process.cmd ?? '')).includes('firebase:emulators');

function migrateDevDeclaration(tree: Tree): void {
  if (!tree.exists(DEV_JSON)) return;
  let decl: { apps?: Record<string, { processes?: DeclaredProcess[] }> };
  try {
    decl = readJson(tree, DEV_JSON);
  } catch {
    return; // The project's file, unreadable: nothing here depends on the switch being gone, so leave it.
  }
  let changed = false;
  for (const [app, entry] of Object.entries(decl.apps ?? {})) {
    for (const process of entry?.processes ?? []) {
      changed = dropPortOffsetSwitch(app, process) || changed;
      changed = adviseOnTheEmulatorUi(app, process) || changed;
    }
  }
  // In place: only the members it changed — dev.json is the project's to edit, in its own form.
  if (changed) tree.write(DEV_JSON, applyJsonChanges(tree.read(DEV_JSON, 'utf8')!, readJson(tree, DEV_JSON), decl));
}

function dropPortOffsetSwitch(app: string, process: DeclaredProcess): boolean {
  if (!Array.isArray(process?.url)) return false;
  const kept = process.url.filter((u) => !(u?.param === 'portOffset' && u.value === '${OFFSET}' && u.when === 'offset'));
  if (kept.length === process.url.length) {
    if (process.url.some((u) => u?.param === 'portOffset')) {
      logger.info(
        `${TAG} ${DEV_JSON}: apps.${app}.${process.id ?? '?'} declares a \`portOffset\` URL switch of its own shape — ` +
          `left as declared. The house's Firebase client no longer reads ?portOffset=.`,
      );
    }
    return false;
  }
  if (kept.length) process.url = kept;
  else delete process.url;
  logger.info(
    `${TAG} ${DEV_JSON}: apps.${app}.${process.id ?? '?'} — dropped the ?portOffset= URL switch; the page reaches a ` +
      `shifted stack's emulators through the dev server, which relays them with the stack's PORT_OFFSET.`,
  );
  return true;
}

/**
 * The serve banner's word on where this stack's Emulator UI works — what a new app's emulators process is seeded
 * with. Only on the house's own process, only with a `ui` port to name (the advice substitutes it: without one the
 * engine would refuse the declaration), and never twice.
 */
function adviseOnTheEmulatorUi(app: string, process: DeclaredProcess): boolean {
  if (!isHouseEmulators(process) || process.ports?.ui === undefined) return false;
  const advice = Array.isArray(process.advice) ? process.advice : [];
  const missing = EMULATOR_UI_ADVICE.filter(({ text }) => !advice.some((a) => a?.text === text));
  if (!missing.length) return false;
  process.advice = [...advice, ...missing];
  logger.info(
    `${TAG} ${DEV_JSON}: apps.${app}.emulators — the serve banner now says where this stack's Emulator UI works ` +
      `(its page dials each emulator directly, so a host tab is complete only on the base stack).`,
  );
  return true;
}
