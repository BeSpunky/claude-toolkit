// The firebase-tools TRIPWIRE: what the emulator safety rests on, checked against the REAL firebase-tools the house
// pins (FIREBASE_TOOLS_VERSION) — never a fake. Network (npm install) and ~1–3 min, so it is NOT on every push and NOT
// in the pre-push hook: weekly, on demand, and whenever the code that depends on it — or the pinned version — moves
// (.github/workflows/firebase-tools-tripwire.yml). Re-run it by hand on every FIREBASE_TOOLS_VERSION bump.
//
// What it guards, each an upstream behaviour the house relies on WITHOUT a documented contract:
//   1. tools/emulator-secrets.cjs's PORT of firebase-tools' dotenv parser (lib/functions/env.js) agrees with the real
//      one — parse, the key rules, the strict parse — over a corpus of awkward files. The port decides what is a
//      production copy and what the emulator can be given; if it drifts, both decisions drift silently.
//   2. CLOUD_SECRET_MANAGER_URL — an undocumented origin override — still moves WHERE THE EMULATOR'S SECRET MANAGER
//      FETCH DIALS. Not a getter (lib/api.js secretManagerOrigin): lib/gcp/secretManager.js captures the origin into a
//      module-level client when it loads, so the check is the launch's own (tools/emulator-secrets.cjs sinkHonoured):
//      a fresh process, the variable set before firebase-tools loads, the emulator's own `accessSecretVersion` call
//      against a local listener — which must receive it.
//   3. END TO END: the real Functions emulator, under the house's offline `demo-` project id, with firebase.json's
//      `configDir` and the inert file the house places: a function sees the PLACEHOLDER for its declared secret and the
//      `.env.local` param value; a secret the placeholders miss is NOT served; firebase-tools announces the demo
//      project — and, every outbound request routed through a recording proxy, NO request reaches a Google API.
//   4. THE SINK UNDER A REAL ID, where it is load-bearing: the same emulator under a non-`demo-` id, with a (fake)
//      login so firebase-tools gets past auth and really dials. The missed secret's fetch goes to the house's sink
//      host, and nothing is sent to secretmanager.googleapis.com. (Without a login firebase-tools fails at auth before
//      dialling anything — which is why a check without one proves nothing.)
//
//   node tools/test-firebase-tools/run.mjs            (FIREBASE_TOOLS_CACHE=<dir> to reuse an install; KEEP=1 keeps the project)
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import http from 'node:http';
import { createConnection, createServer } from 'node:net';
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
console.log('\n2. CLOUD_SECRET_MANAGER_URL moves where the emulator\'s Secret Manager fetch dials (module-load capture)');
const sink = port.sinkHonoured(CACHE);
ok('accessSecretVersion, in a fresh process, dials the listener CLOUD_SECRET_MANAGER_URL names', sink.ok, sink.why);

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

// Every outbound request the emulator makes through firebase-tools' HTTP client goes through this recording proxy
// (HTTPS_PROXY): loopback is relayed, anything else is RECORDED and refused — so "nothing leaves" is observed, not
// assumed, and nothing does leave. It also answers a fake login's token exchange (part 4), as the token endpoint.
const loopback = (host) => /^(127\.|localhost$|\[?::1\]?$)/.test(host);
const left = [];
const recorder = http.createServer((rq, rs) => {
  if (/^https?:\/\//.test(rq.url)) {
    const u = new URL(rq.url);
    if (!loopback(u.hostname)) {
      left.push(u.host);
      rs.writeHead(403);
      return rs.end();
    }
    const fwd = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: rq.method, headers: rq.headers }, (r) => {
      rs.writeHead(r.statusCode, r.headers);
      r.pipe(rs);
    });
    fwd.on('error', () => rs.destroy());
    return rq.pipe(fwd);
  }
  if (rq.url.startsWith('/oauth2/v3/token')) {
    rs.writeHead(200, { 'content-type': 'application/json' });
    return rs.end(JSON.stringify({ access_token: 'tripwire-fake-access-token', expires_in: 3600, token_type: 'Bearer' }));
  }
  rs.writeHead(404);
  rs.end();
});
recorder.on('connect', (rq, sock) => {
  const [host, p] = rq.url.split(/:(?=\d+$)/);
  if (!loopback(host)) {
    left.push(rq.url);
    return sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  }
  const up = createConnection(Number(p), host, () => {
    sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    up.pipe(sock);
    sock.pipe(up);
  });
  up.on('error', () => sock.destroy());
  sock.on('error', () => up.destroy());
});
await new Promise((r) => recorder.listen(0, '127.0.0.1', r));
const proxy = `http://127.0.0.1:${recorder.address().port}`;
const configHome = mkdtempSync(join(tmpdir(), 'fbt-config-')); // no `firebase login` of whoever runs this is read

const until = async (cond, ms) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
/** Start the real emulator under `projectId`, run `checks(call, output)`, stop it; the log is kept beside the project. */
async function withEmulator(projectId, extraEnv, checks) {
  const env = { ...process.env, CLOUD_SECRET_MANAGER_URL: port.SINK, HTTPS_PROXY: proxy, HTTP_PROXY: proxy, XDG_CONFIG_HOME: configHome, ...extraEnv };
  for (const k of ['https_proxy', 'http_proxy', 'NO_PROXY', 'no_proxy', 'GOOGLE_APPLICATION_CREDENTIALS', ...(extraEnv.FIREBASE_TOKEN ? [] : ['FIREBASE_TOKEN'])]) delete env[k];
  const child = spawn(process.execPath, [req.resolve('firebase-tools/lib/bin/firebase.js'), 'emulators:start', '--only', 'functions', '--project', projectId, '--debug'], {
    cwd: project,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  try {
    const up = await until(() => /All emulators ready/.test(output), 120000);
    ok(`${projectId}: the emulator came up`, up, output.slice(-1500));
    if (up) {
      const call = async (fn) => {
        const r = await fetch(`http://127.0.0.1:${fnPort}/${projectId}/us-central1/${fn}`);
        return r.ok ? r.json() : { status: r.status, body: await r.text() };
      };
      await checks(call, () => output);
    }
  } finally {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
    await until(() => child.exitCode !== null || child.signalCode !== null, 15000);
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
    writeFileSync(join(project, `emulator-${projectId}.log`), output);
  }
}

try {
  await withEmulator('demo-tripwire', {}, async (call, output) => {
    ok('firebase-tools announces the demo project', /Detected demo project ID "demo-tripwire"/.test(output()));
    const declared = await call('declared');
    ok('a declared secret is the inert placeholder, not production', declared.S1 === 'EMULATOR_INERT_S1', JSON.stringify(declared));
    ok('.env.local overrides .env through configDir', declared.CHAT === '-100test', JSON.stringify(declared));
    const missed = await call('missed');
    ok('a secret the placeholders miss is not served', !missed.S2, JSON.stringify(missed));
    await until(() => /Unable to access secret/.test(output()), 15000);
    ok('…its Secret Manager fetch failed, in the log', /Unable to access secret/.test(output()), output().slice(-2500));
    // firebase-tools' own housekeeping does try to leave (an update check at registry.npmjs.org, its public config at
    // firebase-public.firebaseio.com, google-auth's metadata-server probe) — none addresses a project. What must never
    // leave is a call to a Google API (*.googleapis.com), where a project's data lives.
    ok('…and NO request went to a Google API (every outbound attempt is recorded by the proxy)', !left.some((h) => /googleapis\.com/.test(h)), left.join(', '));
    console.log(`         (outbound attempts, all refused by the proxy: ${left.join(', ') || 'none'})`);
  });

  console.log('\n4. the sink under a REAL id (a fake login, so firebase-tools really dials)');
  left.length = 0;
  const realId = 'bespunky-tripwire-sink';
  await withEmulator(realId, { FIREBASE_TOKEN: 'tripwire-fake-refresh-token', FIREBASE_TOKEN_URL: proxy }, async (call, output) => {
    const missed = await call('missed');
    ok('a secret the placeholders miss is not served', !missed.S2, JSON.stringify(missed));
    const sinkHost = `${new URL(port.SINK).hostname}:443`;
    await until(() => left.includes(sinkHost), 15000);
    ok(`…its Secret Manager fetch dialled the house's sink (${sinkHost})`, left.includes(sinkHost), `outbound attempts: ${left.join(', ') || 'none'}`);
    ok('…and nothing was sent to secretmanager.googleapis.com', !left.some((h) => /secretmanager\.googleapis\.com/.test(h)), left.join(', '));
    ok('…the declared secret is still the placeholder', (await call('declared')).S1 === 'EMULATOR_INERT_S1');
    console.log(`         (outbound attempts, all refused by the proxy: ${left.join(', ') || 'none'})`);
  });
} finally {
  recorder.close();
  rmSync(configHome, { recursive: true, force: true });
  if (!process.env.KEEP) rmSync(project, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
}

console.log(failed ? `\nFAILED: ${failed} check(s)` : '\nok: firebase-tools behaves as the emulator safety assumes');
process.exit(failed ? 1 : 0);
