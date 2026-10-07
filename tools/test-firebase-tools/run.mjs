// The firebase-tools TRIPWIRE: what the emulator safety rests on, checked against the REAL firebase-tools the house
// pins (FIREBASE_TOOLS_VERSION) — never a fake. Network (npm install) and ~1–3 min, so it is NOT on every push and NOT
// in the pre-push hook: weekly, on demand, and whenever the code that depends on it — or the pinned version — moves
// (.github/workflows/firebase-tools-tripwire.yml). Re-run it by hand on every FIREBASE_TOOLS_VERSION bump.
//
// What it guards, each an upstream behaviour the house relies on WITHOUT a documented contract:
//   1. tools/emulator-secrets.cjs's PORT of firebase-tools' dotenv parser (lib/functions/env.js) agrees with the real
//      one — parse, the key rules, the strict parse — over a corpus of awkward files. The port decides what is a
//      production copy and what the emulator can be given; if it drifts, both decisions drift silently.
//   2. CLOUD_SECRET_MANAGER_URL — an undocumented origin override (lib/api.js secretManagerOrigin) — still moves the
//      Secret Manager origin. It is the sink under the emulator; a rename would quietly remove it.
//   3. END TO END: the real Functions emulator, under the house's offline `demo-` project id, with firebase.json's
//      `configDir` and the inert file the house places: a function sees the PLACEHOLDER for its declared secret and the
//      `.env.local` param value; a secret the placeholders miss is NOT served (fetched against a project that cannot
//      exist, through the sink); firebase-tools announces the demo project. This is the guarantee as a user meets it.
//
//   node tools/test-firebase-tools/run.mjs            (FIREBASE_TOOLS_CACHE=<dir> to reuse an install; KEEP=1 keeps the project)
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const GEN = join(ROOT, 'plugins/house/engine/nx-tools/src/generators');
const versions = readFileSync(join(GEN, '_utils/versions.ts'), 'utf8');
const pin = (name) => new RegExp(`export const ${name} = '([^']+)'`).exec(versions)?.[1];
const FT_VERSION = pin('FIREBASE_TOOLS_VERSION');
const FUNCTIONS_VERSION = pin('FIREBASE_FUNCTIONS_VERSION');
const ADMIN_VERSION = pin('FIREBASE_ADMIN_VERSION');

let failed = 0;
const ok = (name, pass, detail = '') => {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${!pass && detail ? `\n         ${detail}` : ''}`);
  if (!pass) failed++;
};

// ── the real firebase-tools (and the functions SDK the emulator runs), installed once per version ─────────────────
const CACHE = process.env.FIREBASE_TOOLS_CACHE ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'bespunky-test', `firebase-tools-${FT_VERSION}`);
if (!existsSync(join(CACHE, 'node_modules/firebase-tools/package.json'))) {
  console.log(`installing firebase-tools@${FT_VERSION} (+ firebase-functions ${FUNCTIONS_VERSION}, firebase-admin ${ADMIN_VERSION}) into ${CACHE} …`);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(join(CACHE, 'package.json'), '{ "private": true }\n');
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', `firebase-tools@${FT_VERSION}`, `firebase-functions@${FUNCTIONS_VERSION}`, `firebase-admin@${ADMIN_VERSION}`], { cwd: CACHE, stdio: 'inherit' });
}
const req = createRequire(join(CACHE, 'package.json'));
const installed = req('firebase-tools/package.json').version;
console.log(`firebase-tools ${installed} (house pin ${FT_VERSION})`);
ok(`the installed firebase-tools is the pinned one`, installed === FT_VERSION, installed);

// The house modules, rendered as the generator renders them.
const work = mkdtempSync(join(tmpdir(), 'fbt-tripwire-'));
const since = /export const CONFIG_DIR_SINCE = '([^']+)'/.exec(readFileSync(join(GEN, 'firebase-emulators/generator.ts'), 'utf8'))[1];
mkdirSync(join(work, 'tools'), { recursive: true });
writeFileSync(join(work, 'tools/emulator-secrets.cjs'), readFileSync(join(GEN, 'firebase-emulators/emulator-secrets.cjs.tpl'), 'utf8').split('{{configDirSince}}').join(since));
const port = createRequire(import.meta.url)(join(work, 'tools/emulator-secrets.cjs'));

// ── 1. the parser port agrees with the real one ───────────────────────────────────────────────────────────────────
console.log('\n1. the dotenv port (tools/emulator-secrets.cjs) vs lib/functions/env.js');
const real = req('firebase-tools/lib/functions/env');
const CORPUS = [
  'A=1\nB=two\n',
  'A=1   # comment\nB="quoted" #x\nC=\'single\'\n',
  'export A=1\n  B = spaced  \n',
  'A="esc \\"q\\" \\n nl \\t tab \\\\ bs"\nB=\'no \\n esc\'\n',
  'A="multi\nline"\nB=after\n',
  '# only a comment\n\n\n',
  'A=1\r\nB=2\r\nC=3\r\n',
  'A=\nB=""\nC=#notvalue\n',
  'bad line\nA=1\n',
  'A=x=y=z\nB=http://h/p?q=1#frag\n',
  'lower=1\nFIREBASE_X=1\nX_GOOGLE_Y=2\nEXT_Z=3\nKIT_W=4\nFIREBASE_SECRET_REF_OK=5\nGCLOUD_PROJECT=6\nPORT=7\nEXT_SELECTED_EVENTS=8\n',
  'A.B=1\nC/D=2\n',
];
for (const [i, text] of CORPUS.entries()) {
  ok(`parse #${i}`, JSON.stringify(port.parse(text)) === JSON.stringify(real.parse(text)), `port ${JSON.stringify(port.parse(text))} real ${JSON.stringify(real.parse(text))}`);
  const outcome = (fn) => {
    try {
      return `ok:${JSON.stringify(fn(text))}`;
    } catch {
      return 'threw';
    }
  };
  ok(`parseStrict #${i}`, outcome(port.parseStrict) === outcome(real.parseStrict), `port ${outcome(port.parseStrict)} real ${outcome(real.parseStrict)}`);
}
const KEYS = ['A', 'A_1', '_X', 'a', 'A-B', '1A', 'FIREBASE_CONFIG', 'FIREBASE_X', 'FIREBASE_SECRET_REF_', 'FIREBASE_SECRET_REF_X', 'EXT_SELECTED_EVENTS', 'EXT_SELECTED_EVENTSX', 'EXT_MIGRATED_SYSTEM_A', 'X_GOOGLE_A', 'KIT_A', 'K_SERVICE', 'PORT', 'PORTS'];
for (const key of KEYS) {
  let refused = false;
  try {
    real.validateKey(key);
  } catch {
    refused = true;
  }
  ok(`key rule: ${key}`, Boolean(port.keyProblem(key)) === refused, `port "${port.keyProblem(key)}", real ${refused ? 'refuses' : 'accepts'}`);
}
for (const value of ['plain', 'with "quotes" and \'apos\'', 'nl\nand\ttab', 'back\\slash', '#hash', ' padded ']) {
  const line = port.formatLine('K', value);
  ok(`formatLine round-trips ${JSON.stringify(value)}`, real.parseStrict(line).K === value, `${line} → ${JSON.stringify(real.parseStrict(line).K)}`);
}

// ── 2. the sink ──────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n2. CLOUD_SECRET_MANAGER_URL (lib/api.js secretManagerOrigin)');
process.env.CLOUD_SECRET_MANAGER_URL = port.SINK;
const api = req('firebase-tools/lib/api');
ok('secretManagerOrigin() honours CLOUD_SECRET_MANAGER_URL', api.secretManagerOrigin?.() === port.SINK, String(api.secretManagerOrigin?.()));
delete process.env.CLOUD_SECRET_MANAGER_URL;

// ── 3. end to end: the real Functions emulator under the offline id ──────────────────────────────────────────────
console.log('\n3. the real Functions emulator, offline id, configDir, the placed inert file');
const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port: p } = s.address();
      s.close(() => resolve(p));
    });
  });
const [fnPort, hubPort, logPort] = [await freePort(), await freePort(), await freePort()];
const project = join(CACHE, `e2e-${process.pid}`); // inside the install, so the function resolves firebase-functions
const src = join(project, 'functions');
const dist = join(project, 'dist');
mkdirSync(src, { recursive: true });
mkdirSync(dist, { recursive: true });
writeFileSync(join(project, 'firebase.json'), JSON.stringify({
  functions: [{ source: 'dist', configDir: 'functions', codebase: 'default', ignore: ['*.local'] }],
  emulators: { functions: { port: fnPort, host: '127.0.0.1' }, hub: { port: hubPort, host: '127.0.0.1' }, logging: { port: logPort, host: '127.0.0.1' }, ui: { enabled: false }, singleProjectMode: true },
}, null, 2));
const dep = (name) => JSON.parse(readFileSync(join(CACHE, 'node_modules', name, 'package.json'), 'utf8')).version;
writeFileSync(join(dist, 'package.json'), JSON.stringify({
  name: 'fns',
  main: 'main.js',
  engines: { node: String(process.versions.node.split('.')[0]) },
  dependencies: { 'firebase-functions': dep('firebase-functions'), 'firebase-admin': dep('firebase-admin') },
}));
writeFileSync(join(dist, 'main.js'), `
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const S1 = defineSecret('S1');
const S2 = defineSecret(['S', '2'].join('')); // named dynamically: no scan can see it
const CHAT = defineString('CHAT_ID');
exports.declared = onRequest({ secrets: [S1] }, (req, res) => res.json({ S1: process.env.S1, CHAT: CHAT.value() }));
exports.missed = onRequest({ secrets: [S2] }, (req, res) => res.json({ S2: process.env.S2 ?? null }));
`);
writeFileSync(join(src, '.secret.local.example'), 'S1=PASTE_S1\n');
writeFileSync(join(src, '.secret.local'), 'S1=prod-s1\n'); // production's — must never be what a function sees
writeFileSync(join(src, '.env'), 'CHAT_ID=-100prod\n');
writeFileSync(join(src, '.env.local'), 'CHAT_ID=-100test\n');
// S2 is named dynamically, so the placed file cannot cover it — the case only the offline id and the sink stand for.
execFileSync(process.execPath, [join(work, 'tools/emulator-secrets.cjs'), 'place', '--mode=inert', `--source=${src}`, `--dist=${dist}`], { cwd: CACHE, stdio: 'inherit' });
const placed = readFileSync(join(dist, '.secret.local'), 'utf8');
ok('the placed file passes the real strict parser', (() => { try { return real.parseStrict(placed).S1 === 'EMULATOR_INERT_S1'; } catch { return false; } })(), placed);

const log = join(project, 'emulator.log');
const child = spawn(process.execPath, [req.resolve('firebase-tools/lib/bin/firebase.js'), 'emulators:start', '--only', 'functions', '--project', 'demo-tripwire', '--debug'], {
  cwd: project,
  env: { ...process.env, CLOUD_SECRET_MANAGER_URL: port.SINK },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let output = '';
child.stdout.on('data', (d) => (output += d));
child.stderr.on('data', (d) => (output += d));
const until = async (cond, ms) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
try {
  const up = await until(() => /All emulators ready/.test(output), 120000);
  ok('the emulator came up', up, output.slice(-1500));
  if (up) {
    ok('firebase-tools announces the demo project', /Detected demo project ID "demo-tripwire"/.test(output));
    const call = async (fn) => {
      const r = await fetch(`http://127.0.0.1:${fnPort}/demo-tripwire/us-central1/${fn}`);
      return r.ok ? r.json() : { status: r.status, body: await r.text() };
    };
    const declared = await call('declared');
    ok('a declared secret is the inert placeholder, not production', declared.S1 === 'EMULATOR_INERT_S1', JSON.stringify(declared));
    ok('.env.local overrides .env through configDir', declared.CHAT === '-100test', JSON.stringify(declared));
    const missed = await call('missed');
    ok('a secret the placeholders miss is not served', !missed.S2, JSON.stringify(missed));
    await until(() => /Unable to access secret/.test(output), 15000);
    ok('…its Secret Manager fetch failed, in the log', /Unable to access secret/.test(output), output.slice(-2500));
    // (Where the fetch went is part 2's check: without a login — CI — firebase-tools fails before it dials anything.)
    ok('…and never at secretmanager.googleapis.com', !/secretmanager\.googleapis\.com/.test(output), output.slice(-2500));
  }
} finally {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {}
  await until(() => child.exitCode !== null || child.signalCode !== null, 15000);
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {}
  writeFileSync(log, output);
  if (!process.env.KEEP) rmSync(project, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
}

console.log(failed ? `\nFAILED: ${failed} check(s)` : '\nok: firebase-tools behaves as the emulator safety assumes');
process.exit(failed ? 1 : 0);
