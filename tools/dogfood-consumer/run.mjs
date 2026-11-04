#!/usr/bin/env node
/**
 * DOGFOOD A PAYLOAD RELEASE THE WAY A CONSUMER RECEIVES IT — in one step.
 *
 *   node tools/dogfood-consumer/run.mjs [--released=<ref>] [--toolkit=<path>] [--only=<steps>]
 *                                       [--workdir=<dir>] [--no-staging] [--keep]
 *   node tools/dogfood-consumer/run.mjs --self-test          (the upstream-cause recognisers on recorded output; offline)
 *
 * NETWORK, MINUTES (~20–45), npm registry + yarn installs. NOT CI and NOT the pre-push hook — a release gate a
 * human (or the agent doing the release) runs before bumping `engine/nx-tools/package.json`. Node built-ins only.
 *
 * ── WHY ────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The consumer dogfood used to be a hand recipe (docs/features/2026-10-07-house-firebase-handoff/impl/
 * DOGFOOD-CONSUMER.md, -2.md): build a project with the released toolkit, give it the shapes real projects grow,
 * upgrade it with the toolkit under test, read the result. It caught real bugs — and missed one that mattered:
 * `new --preset=angular --firebase` with the toolkit UNDER TEST was broken, and nobody saw it, because the hand
 * recipe only ever ran `new` with the RELEASED toolkit. A release has two consumer roads — an existing project
 * upgrading, and a new project being created — and this tool walks both, every time:
 *
 *   released  `house.sh new --preset=angular --firebase [--staging] coach web` from a temporary DETACHED worktree
 *             of --released (default `development`, the integration line: what consumers run today).
 *   seed      the shapes reporting projects actually grew, ONE COMMIT EACH (SEEDS below — data; a future reporting
 *             project's shape is one more entry).
 *   upgrade   on a work branch, `house.sh upgrade --local --yes .` with the toolkit UNDER TEST: UPGRADE_OK and none
 *             of UPGRADE_PARTIAL / _REFUSED / _FAILED; the stamp is the toolkit's version; every seed survived; a
 *             SECOND upgrade is a no-op (UPGRADE_OK, `UPGRADE_NEXT: none`, no commit, clean tree); then the
 *             upgraded workspace builds, lints and passes its tests (`UPGRADE_OK` says the run completed, never that its output
 *             compiles — house.sh says so itself, in UPGRADE_VERIFY).
 *   new-*     a real `house.sh new --local` with the toolkit under test for EVERY preset: agent, node, angular and
 *             angular + --firebase, each with its sanity facts, and build + lint + test where there is an app to build.
 *   new-postgres, new-postgres-node
 *             the `postgres` layer on each host (wrapper, node), from nothing: `new --local --add-layer=postgres`; the project
 *             gains a served app and an upgrade, so the GENERATORS seed its `.bespunky/dev.json`; then a real `nx serve` with
 *             the REAL pinned server and dbmate. A migration and a seed applied, the app received DATABASE_URL, the stop
 *             leaves nothing and frees every port.
 *   add-layer-postgres
 *             `add-layer --local postgres` on the upgraded consumer: what it had survives, a second upgrade is a no-op, it
 *             still builds, lints and passes its tests, and `postgres:start` boots there, with the real tools.
 *
 * The real tools come from tools/test-postgres/tools.mjs: the generated installer, unprivileged, into a cache
 * (POSTGRES_TOOLS_CACHE). So those steps need this checkout's `yarn install`, and a Debian the closures cover; anywhere else they
 * are SKIPs that say so. Their data stays under the workdir (XDG_DATA_HOME), never in this machine's `~/.local`.
 *
 * `--yes` is passed to the upgrades on purpose and is not the gate being satisfied by a machine: the upgrade
 * target is a throwaway fixture this run created seconds earlier, and running this tool IS the human's consent.
 *
 * Steps (--only, comma-separated; prerequisites are pulled in): released, seed, upgrade, add-layer-postgres, new-agent,
 * new-node, new-angular, new-angular-firebase, new-postgres, new-postgres-node; aliases `consumer` (= released,seed,upgrade),
 * `new` (= every new-*) and `postgres` (= every step above that wears the layer).
 *
 * ── WHEN THE RELEASED BASELINE IS BROKEN UPSTREAM ───────────────────────────────────────────────────────
 *
 * The released side resolves whatever the registry serves TODAY, so it can break for a reason that is neither the
 * released code's nor the change's: on 2026-10-07 firebase@13.0.0 shipped `@firebase/ai@3.0.0` with
 * `engines.node >=24.12.0`, and the released scaffold's `"firebase": "latest"` made the released `new` die in yarn's
 * engine check. A released-side failure is therefore CLASSIFIED by cause (UPSTREAM_CAUSES — a table of recognisers:
 * yarn's `The engine "node" is incompatible …`, npm's `EBADENGINE`, pnpm's `ERR_PNPM_UNSUPPORTED_ENGINE`; a new
 * upstream cause is one more entry). A recognised one is its own status, UPSTREAM — "baseline broken upstream: <pkg>
 * requires node <expected>, this Node is <got>" — never a FAIL of this run, and never a PASS either: the steps that
 * needed the baseline (seed, upgrade) are reported as NOT COVERED because of it, the verdict reads
 * `PASS (incomplete: …)`, and the summary prints the rerun that works around it where one exists (for an engine
 * break: `YARN_IGNORE_ENGINES=true node tools/dogfood-consumer/run.mjs <same args>`). Only the RELEASED side is
 * classified: the same signature in a `new --local` is the toolkit under test failing to pin a coherent set, and stays
 * a FAIL; an unrecognised released failure stays a FAIL too.
 *
 * Every command's full output goes to <workdir>/logs/NN-<check>.log; the path is printed. On exit (normal,
 * failure or Ctrl+C) the released worktree is removed, every process still running under the workdir is killed,
 * and — unless --keep — the scratch projects are deleted (the logs are kept). Nothing is ever written to
 * ~/projects: every `new` gets an explicit path and PROJECTS_DIR points into the workdir; the run checks it.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { connect, createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── arguments ─────────────────────────────────────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const USAGE = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 7).map((l) => l.replace(/^ \* ?/, '')).join('\n');

const opts = { released: 'development', toolkit: resolve(HERE, '../..'), only: null, workdir: null, staging: true, keep: false };
for (const a of process.argv.slice(2)) {
  const [k, v] = a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
  if (k === '--released' && v) opts.released = v;
  else if (k === '--toolkit' && v) opts.toolkit = resolve(v);
  else if (k === '--only' && v) opts.only = v.split(',').map((s) => s.trim()).filter(Boolean);
  else if (k === '--workdir' && v) opts.workdir = resolve(v);
  else if (k === '--no-staging') opts.staging = false;
  else if (k === '--keep') opts.keep = true;
  else if (k === '--self-test') opts.selfTest = true;
  else if (k === '--help' || k === '-h') { console.log(USAGE); process.exit(0); }
  else { console.error(`unknown argument '${a}'\n${USAGE}`); process.exit(2); }
}
// ── upstream causes ───────────────────────────────────────────────────────────────────────────────────────
// Why a RELEASED-side command failed, when the reason is the registry and not the code: one recogniser per cause.
// `match(out)` returns every instance found (deduplicated), each { pkg, expected, got }; `say` renders one; `rerun`
// (optional) is the env that works around it, per package manager. A cause with no workaround leaves `rerun` out.
const ENGINE_RERUN = { yarn: 'YARN_IGNORE_ENGINES=true', npm: 'npm_config_engine_strict=false', pnpm: 'npm_config_engine_strict=false' };
const UPSTREAM_CAUSES = [
  {
    id: 'engine', pm: 'yarn',
    // error @firebase/ai@3.0.0: The engine "node" is incompatible with this module. Expected version ">=24.12.0". Got "22.23.2"
    re: /(\S+): The engine "node" is incompatible with this module\. Expected version "([^"]+)"\. Got "([^"]+)"/g,
    pick: (m) => ({ pkg: m[1], expected: m[2], got: m[3] }),
  },
  {
    id: 'engine', pm: 'npm',
    // npm error notsup Not compatible with your version of node/npm: <pkg>
    // npm error notsup Required: {"node":">=24.12.0"}
    // npm error notsup Actual:   {"npm":"10.9.0","node":"v22.23.2"}
    re: /EBADENGINE[\s\S]*?Not compatible with your version of node\/npm: (\S+)[\s\S]*?Required: (\{[^\n]*\})[\s\S]*?Actual:\s*(\{[^\n]*\})/g,
    pick: (m) => ({ pkg: m[1], expected: jsonField(m[2], 'node'), got: jsonField(m[3], 'node') }),
  },
  {
    id: 'engine', pm: 'pnpm',
    // ERR_PNPM_UNSUPPORTED_ENGINE  Unsupported environment … Your Node version is incompatible with "<pkg>". Expected version: X Got: Y
    re: /ERR_PNPM_UNSUPPORTED_ENGINE[\s\S]*?incompatible with "([^"]+)"[\s\S]*?Expected version: (\S+)[\s\S]*?Got: (\S+)/g,
    pick: (m) => ({ pkg: m[1], expected: m[2], got: m[3] }),
  },
].map((c) => ({ ...c, rerun: c.id === 'engine' ? ENGINE_RERUN[c.pm] : undefined, say: (h) => `${h.pkg} requires node ${h.expected}, this Node is ${String(h.got).replace(/^v/, '')}` }));
function jsonField(text, key) { try { return JSON.parse(text)[key] ?? '?'; } catch { return '?'; } }

/** Every upstream cause recognised in a command's output: [{ cause, hit, text }], empty when none is. */
function classifyUpstream(out) {
  const found = [];
  for (const cause of UPSTREAM_CAUSES) {
    for (const m of out.matchAll(cause.re)) {
      const hit = cause.pick(m);
      const text = cause.say(hit);
      if (!found.some((f) => f.text === text)) found.push({ cause, hit, text });
    }
  }
  return found;
}

if (opts.selfTest) {
  const cases = [
    ['yarn', 'error @firebase/ai@3.0.0: The engine "node" is incompatible with this module. Expected version ">=24.12.0". Got "22.23.2"\nerror Found incompatible module.',
      ['@firebase/ai@3.0.0 requires node >=24.12.0, this Node is 22.23.2'], 'YARN_IGNORE_ENGINES=true'],
    ['npm', 'npm error code EBADENGINE\nnpm error engine Unsupported engine\nnpm error notsup Not compatible with your version of node/npm: @firebase/ai@3.0.0\nnpm error notsup Required: {"node":">=24.12.0"}\nnpm error notsup Actual:   {"npm":"10.9.0","node":"v22.23.2"}',
      ['@firebase/ai@3.0.0 requires node >=24.12.0, this Node is 22.23.2'], 'npm_config_engine_strict=false'],
    ['pnpm', ' ERR_PNPM_UNSUPPORTED_ENGINE  Unsupported environment (bad pnpm and/or Node.js version)\n\nYour Node version is incompatible with "@firebase/ai@3.0.0".\n\nExpected version: >=24.12.0\nGot: v22.23.2',
      ['@firebase/ai@3.0.0 requires node >=24.12.0, this Node is 22.23.2'], 'npm_config_engine_strict=false'],
    ['yarn, twice + dedup', 'error a@1.0.0: The engine "node" is incompatible with this module. Expected version ">=24". Got "22.1.0"\nerror a@1.0.0: The engine "node" is incompatible with this module. Expected version ">=24". Got "22.1.0"\nerror b@2.0.0: The engine "node" is incompatible with this module. Expected version "^26". Got "22.1.0"',
      ['a@1.0.0 requires node >=24, this Node is 22.1.0', 'b@2.0.0 requires node ^26, this Node is 22.1.0'], 'YARN_IGNORE_ENGINES=true'],
    ['unrecognised', 'NX   Cannot find module @nx/angular\nerror Command failed with exit code 1.', [], undefined],
  ];
  let bad = 0;
  for (const [name, out, want, rerun] of cases) {
    const got = classifyUpstream(out);
    const okCase = JSON.stringify(got.map((g) => g.text)) === JSON.stringify(want) && (got[0]?.cause.rerun === rerun);
    if (!okCase) bad++;
    console.log(`${okCase ? 'ok  ' : 'FAIL'}  ${name}: ${JSON.stringify(got.map((g) => g.text))}${got[0]?.cause.rerun ? ` (rerun: ${got[0].cause.rerun})` : ''}`);
  }
  console.log(bad ? `${bad} self-test case(s) failed` : 'self-test: every upstream recogniser OK');
  process.exit(bad ? 1 : 0);
}

if (process.env.CI === 'true' || process.env.CI === '1') {
  console.error('dogfood-consumer: not a CI tool (network, minutes, and house.sh refuses upgrades in CI). Run it by hand.');
  process.exit(2);
}

// ── steps ─────────────────────────────────────────────────────────────────────────────────────────────────
const PRESETS = {
  'new-agent': { flags: [], app: null, layers: ['nx', 'agent'], host: 'wrapper' },
  'new-node': { flags: ['--preset=node'], app: null, layers: ['nx', 'agent', 'node'], host: 'node' },
  'new-angular': { flags: ['--preset=angular'], app: 'web', layers: ['angular', 'design-system', 'web'], host: 'node', verify: true },
  'new-angular-firebase': { flags: ['--preset=angular', '--firebase'], app: 'web', layers: ['angular', 'firebase'], host: 'node', verify: true, firebase: true },
};
// The `postgres` layer from nothing, on each host: a separate road because it does not stop at `new` (see stepNewPostgres).
const POSTGRES_ROADS = {
  'new-postgres': { flags: ['--add-layer=postgres'], layers: ['nx', 'agent', 'postgres'], host: 'wrapper' },
  'new-postgres-node': { flags: ['--preset=node', '--add-layer=postgres'], layers: ['nx', 'agent', 'node', 'postgres'], host: 'node' },
};
const STEP_ORDER = ['released', 'seed', 'upgrade', 'add-layer-postgres', ...Object.keys(PRESETS), ...Object.keys(POSTGRES_ROADS)];
const REQUIRES = { seed: ['released'], upgrade: ['seed'], 'add-layer-postgres': ['upgrade'] };
const ALIASES = { consumer: ['released', 'seed', 'upgrade'], new: [...Object.keys(PRESETS), ...Object.keys(POSTGRES_ROADS)], postgres: ['add-layer-postgres', ...Object.keys(POSTGRES_ROADS)] };

function selectSteps(only) {
  if (!only) return new Set(STEP_ORDER);
  const out = new Set();
  const add = (s) => {
    if (ALIASES[s]) return ALIASES[s].forEach(add);
    if (!STEP_ORDER.includes(s)) { console.error(`unknown step '${s}'. Steps: ${STEP_ORDER.join(', ')}; aliases: consumer, new`); process.exit(2); }
    out.add(s);
    (REQUIRES[s] ?? []).forEach(add);
  };
  only.forEach(add);
  return out;
}
const STEPS = selectSteps(opts.only);

// ── the workdir ───────────────────────────────────────────────────────────────────────────────────────────
const WORK = opts.workdir ?? mkdtempSync(join(tmpdir(), 'dogfood-consumer-'));
mkdirSync(WORK, { recursive: true });
const LOGS = join(WORK, 'logs');
const RELEASED_TREE = join(WORK, 'released');
const CONSUMERS = join(WORK, 'consumers'); // PROJECTS_DIR for every house.sh run
const TMP = join(WORK, 'tmp');             // TMPDIR for every child: whatever it leaves is ours to delete
const POSTGRES_DATA = join(TMP, 'xdg');    // XDG_DATA_HOME for a real server: never this machine's ~/.local
for (const d of [LOGS, CONSUMERS, TMP]) mkdirSync(d, { recursive: true });
for (const d of [RELEASED_TREE]) if (existsSync(d)) { console.error(`${d} already exists — use a fresh --workdir.`); process.exit(2); }

const TOOLKIT = opts.toolkit;
const HOUSE = (root) => join(root, 'plugins/house/engine/house.sh');
if (!existsSync(HOUSE(TOOLKIT))) { console.error(`--toolkit: no house.sh under ${TOOLKIT}`); process.exit(2); }
const TOOLKIT_VERSION = JSON.parse(readFileSync(join(TOOLKIT, 'plugins/house/engine/nx-tools/package.json'), 'utf8')).version;
const HOME_PROJECTS = join(homedir(), 'projects');
const homeProjectsBefore = listOrNull(HOME_PROJECTS);

const ENV = {
  ...process.env,
  PROJECTS_DIR: CONSUMERS,
  TMPDIR: TMP,
  NX_DAEMON: 'false',       // a daemon outlives the command that started it
  NX_TUI: 'false',
  NX_NO_CLOUD: 'true',
  NX_INTERACTIVE: 'false',
  GIT_AUTHOR_NAME: 'dogfood', GIT_AUTHOR_EMAIL: 'dogfood@localhost',
  GIT_COMMITTER_NAME: 'dogfood', GIT_COMMITTER_EMAIL: 'dogfood@localhost',
};
ENV.FORCE_COLOR = '0';   // logs a human reads in an editor, and verdict lines matched by regex
ENV.NO_COLOR = '1';

// ── running things ────────────────────────────────────────────────────────────────────────────────────────
let logSeq = 0;
let current = null; // the running child, killed (whole group) on a signal

/** Run a command to its own log file. Resolves { code, out, ms, log }. The child leads its own process group so a
 *  timeout or a Ctrl+C takes down everything it started, not just the shell. */
function run(label, cmd, args, { cwd, env = {}, timeoutMs = 30 * 60_000 } = {}) {
  const log = join(LOGS, `${String(++logSeq).padStart(2, '0')}-${label.replace(/[^a-z0-9.-]+/gi, '_')}.log`);
  writeFileSync(log, `$ (cd ${cwd ?? process.cwd()} && ${[cmd, ...args].join(' ')})\n\n`);
  const fd = openSync(log, 'a');
  const t0 = Date.now();
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd, env: { ...ENV, ...env }, stdio: ['ignore', fd, fd], detached: true });
    current = child;
    const timer = setTimeout(() => { appendFileSync(log, `\n[dogfood] TIMEOUT after ${timeoutMs / 1000}s — killed\n`); killGroup(child.pid); }, timeoutMs);
    const finish = (code) => {
      clearTimeout(timer); current = null; closeSync(fd);
      const ms = Date.now() - t0;
      appendFileSync(log, `\n[dogfood] exit ${code} in ${(ms / 1000).toFixed(1)}s\n`);
      done({ code, out: readFileSync(log, 'utf8'), ms, log });
    };
    child.on('error', (e) => { appendFileSync(log, `\n[dogfood] spawn error: ${e.message}\n`); finish(127); });
    child.on('exit', (code, sig) => finish(code ?? (sig ? 128 : 1)));
  });
}
/** Start something that stays up, to its own log file. The caller stops it the way a consumer would; a run that dies is `cleanup`'s. */
const services = new Set();
function background(label, cmd, args, { cwd, env = {} } = {}) {
  const log = join(LOGS, `${String(++logSeq).padStart(2, '0')}-${label.replace(/[^a-z0-9.-]+/gi, '_')}.log`);
  writeFileSync(log, `$ (cd ${cwd} && ${[cmd, ...args].join(' ')})\n\n`);
  const fd = openSync(log, 'a');
  const child = spawn(cmd, args, { cwd, env: { ...ENV, ...env }, stdio: ['ignore', fd, fd], detached: true });
  closeSync(fd);
  const handle = { pid: child.pid, log, code: undefined, ended: false, out: () => readFileSync(log, 'utf8') };
  services.add(handle);
  const finish = (code) => { handle.code = code; handle.ended = true; services.delete(handle); };
  child.on('error', (e) => { appendFileSync(log, `\n[dogfood] spawn error: ${e.message}\n`); finish(127); });
  child.on('exit', (code, sig) => finish(code ?? (sig ? 128 : 1)));
  return handle;
}
const git = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { env: ENV, encoding: 'utf8' });
const gitOut = (cwd, ...args) => { const r = git(cwd, ...args); if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.trim()}`); return r.stdout.trim(); };
const nx = (cwd) => (existsSync(join(cwd, 'package.json')) ? ['npx', ['--no-install', 'nx']] : ['./nx', []]);

function killGroup(pid) { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } }

/** Every process (not us) whose cwd is inside the workdir — what a run must never leave behind. */
function straysUnder(dir) {
  const out = [];
  for (const p of readdirSync('/proc')) {
    if (!/^\d+$/.test(p) || Number(p) === process.pid) continue;
    try {
      const cwd = readlinkSync(`/proc/${p}/cwd`);
      if (cwd === dir || cwd.startsWith(dir + '/')) out.push({ pid: Number(p), cmd: readFileSync(`/proc/${p}/cmdline`, 'utf8').replace(/\0/g, ' ').trim().slice(0, 120) });
    } catch { /* raced or not ours */ }
  }
  return out;
}

// ── the record ────────────────────────────────────────────────────────────────────────────────────────────
const results = [];
const upstream = []; // every upstream cause recognised on the released side: [{ cause, hit, text, step, check }]
// BASE: a failure of the RELEASED toolkit's own output (the seeded consumer before the upgrade) — the reference the
// toolkit under test is compared against, reported but never a failure of this run: the released code cannot be fixed.
// UPSTREAM: a RELEASED-side failure whose output `released` a recogniser in UPSTREAM_CAUSES explains — the registry
// broke the baseline, not any code; reported apart, never a FAIL, and what it left uncovered is said (`lostCoverage`).
// Only a released-side caller passes `released`: the toolkit under test never gets an upstream excuse.
function record(step, check, ok, { ms = 0, detail = '', log = '', reference = false, released = null, notCovered = false } = {}) {
  const causes = ok === false && released !== null ? classifyUpstream(released) : [];
  if (causes.length) {
    upstream.push(...causes.map((c) => ({ ...c, step, check })));
    detail = `baseline broken upstream: ${causes.map((c) => c.text).join('; ')}`;
  }
  const status = ok === null ? 'SKIP' : ok ? 'PASS' : causes.length ? 'UPSTREAM' : reference ? 'BASE' : 'FAIL';
  results.push({ step, check, status, ms, detail, log, notCovered });
  console.log(`  ${status.padEnd(8)}  ${step} · ${check}${detail ? ` — ${detail}` : ''}`);
  return ok;
}
/** Why a step that needs the released baseline did not run: the upstream break when there is one (coverage LOST,
 *  never quietly skipped), else the plain reason. */
function skipFor(step, check, reason) {
  return upstream.length
    ? record(step, check, null, { detail: `NOT COVERED — baseline broken upstream (${upstream[0].text})`, notCovered: true })
    : record(step, check, null, { detail: reason });
}
/** The line of a log that says why — a house.sh verdict token, an error, else the last line. */
function why(out) {
  const lines = out.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('[dogfood]'));
  // The CAUSE — Nx's error banner (`NX   <message>`), a package manager's `error <message>`, house.sh's `ERROR:` — is
  // preferred over the consequence printed after it (`NX   Command failed`, `UPGRADE_FAILED`, `error Command failed`).
  const cause = [...lines].reverse().find((l) =>
    (/^NX\s{2,}/.test(l) && !/^NX\s+(Generating|Running target|Successfully|Pass --verbose|Command failed)|success/i.test(l))
    || (/^error /.test(l) && !/^error (Command failed|Found incompatible)/.test(l))
    || /^ERROR\b/.test(l));
  const hit = cause ?? [...lines].reverse().find((l) => /^(UPGRADE_[A-Z]+|NEW_OK|BACKUP_ABORT)\b|✖|failed/i.test(l));
  return (hit ?? lines.at(-1) ?? '').slice(0, 140);
}
function stamp(dir) {
  const s = (readFileSync(join(dir, 'HOUSE.md'), 'utf8').match(/@bespunky\/house-tooling:stamp[^>]*/) ?? [''])[0];
  return { nxTools: (s.match(/nx-tools=(\S+)/) ?? [])[1], layers: ((s.match(/layers=([a-z0-9,-]+)/) ?? [])[1] ?? '').split(',').filter(Boolean) };
}
function listOrNull(d) { try { return readdirSync(d).sort().join(','); } catch { return null; } }
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
const editJson = (p, fn) => { const v = readJson(p); fn(v); writeJson(p, v); };
function must(cond, msg) { if (!cond) throw new Error(msg); }

// ── the consumer's seeds ──────────────────────────────────────────────────────────────────────────────────
// The shapes reporting projects grew by hand (DOGFOOD-CONSUMER.md, DOGFOOD-CONSUMER-2.md), each ONE COMMIT on the
// integration line before the upgrade. A seed is data: `apply` makes the shape (throwing when the released scaffold
// no longer has what it edits — a stale seed is a FAIL, never a silent no-op), `commit` false for a gitignored file,
// and `survives` (optional) states what of the user's own content the upgrade must keep. A new reporting project's
// shape is one more entry here.
const SEEDS = [
  {
    id: 'branch-model',
    message: 'chore: declare the branch model (deploys notes)',
    async apply(c) {
      // Written with the RELEASED branches.mjs, the way the project wrote it. The form is the one it accepts: `write` has
      // refused a bare-string `deploys` since 0.50.0.
      const b = join(RELEASED_TREE, 'plugins/workflow/skills/branch-and-release/scripts/branches.mjs');
      const stages = c.staging ? 'staging,main' : 'main';
      const ex = spawnSync('node', [b, 'expand', '--preset', c.staging ? 'three-line' : 'two-line', '--stages', stages], { cwd: c.dir, env: ENV, encoding: 'utf8' });
      must(ex.status === 0, `branches.mjs expand: ${ex.stderr.trim()}`);
      const model = JSON.parse(ex.stdout);
      for (const s of model.stages) {
        s.deploys = {
          note: s.branch === 'main'
            ? `App Hosting backend ${c.name}-web tracks main (GitHub-linked); functions deployed by hand: nx run functions:deploy`
            : `App Hosting backend ${c.name}-${s.branch} tracks ${s.branch}; functions deployed by hand: nx run functions:deploy -P ${s.branch}`,
        };
      }
      // The lines the model declares exist, as in the reporting projects, and the seeds land on the integration line.
      const head = gitOut(c.dir, 'rev-parse', 'HEAD');
      for (const b of [model.integration.branch, ...model.stages.map((s) => s.branch)]) {
        if (git(c.dir, 'rev-parse', '--verify', '-q', `refs/heads/${b}`).status !== 0) gitOut(c.dir, 'branch', b, head);
      }
      gitOut(c.dir, 'checkout', '-q', model.integration.branch);
      const draft = join(TMP, 'branches.draft.json');
      writeJson(draft, model);
      const w = spawnSync('node', [b, 'write', draft], { cwd: c.dir, env: ENV, encoding: 'utf8' });
      must(w.status === 0, `branches.mjs write: ${w.stderr.trim()}`);
    },
    survives: (c) => {
      const m = readJson(join(c.dir, '.bespunky/branches.json'));
      return [m.stages.every((s) => JSON.stringify(s.deploys ?? '').includes('deployed by hand')), 'every stage keeps its deploys note (any form)'];
    },
  },
  {
    id: 'functions-deploy-inputs',
    message: 'fix(functions): deploy sees root firebase files (hand-added inputs)',
    apply(c) {
      editJson(join(c.dir, 'apps/functions/project.json'), (p) => {
        must(p.targets?.deploy, 'apps/functions has no deploy target');
        p.targets.deploy.inputs = ['default', '^default', '{workspaceRoot}/firebase.json', '{workspaceRoot}/.firebaserc', `{workspaceRoot}/apps/functions/.env.${c.name}-prod`];
      });
    },
    survives: (c) => {
      const i = readJson(join(c.dir, 'apps/functions/project.json')).targets?.deploy?.inputs ?? [];
      return [['{workspaceRoot}/.firebaserc', `{workspaceRoot}/apps/functions/.env.${c.name}-prod`].every((x) => i.includes(x)), 'functions:deploy keeps the hand inputs'];
    },
  },
  {
    id: 'firebase-deploy-target',
    message: 'feat(firebase): hand-added rules deploy target',
    apply(c) {
      editJson(join(c.dir, 'firebase/project.json'), (p) => {
        must(p.targets, 'firebase/project.json has no targets');
        p.targets.deploy = {
          executor: 'nx:run-commands',
          inputs: ['{workspaceRoot}/firebase.json', '{workspaceRoot}/firestore.rules', '{workspaceRoot}/firestore.indexes.json', '{workspaceRoot}/storage.rules'],
          options: { command: 'firebase deploy --only firestore:rules,firestore:indexes,storage', cwd: '{workspaceRoot}' },
        };
      });
    },
    survives: (c) => {
      const i = readJson(join(c.dir, 'firebase/project.json')).targets?.deploy?.inputs ?? [];
      return [i.includes('{workspaceRoot}/storage.rules'), 'firebase:deploy keeps its hand inputs'];
    },
  },
  {
    id: 'root-rules',
    message: 'chore(firebase): firebase init firestore storage (root rules)',
    apply(c) {
      writeFileSync(join(c.dir, 'firestore.rules'), "rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /inquiries/{id} { allow create: if true; allow read: if request.auth != null; }\n  }\n}\n");
      writeFileSync(join(c.dir, 'firestore.indexes.json'), '{"indexes":[],"fieldOverrides":[]}\n');
      writeFileSync(join(c.dir, 'storage.rules'), "rules_version = '2';\nservice firebase.storage { match /b/{bucket}/o { match /{allPaths=**} { allow read, write: if request.auth != null; } } }\n");
      editJson(join(c.dir, 'firebase.json'), (f) => {
        f.firestore = { rules: 'firestore.rules', indexes: 'firestore.indexes.json' };
        f.storage = { rules: 'storage.rules' };
      });
    },
    survives: (c) => {
      const f = readJson(join(c.dir, 'firebase.json'));
      return [f.firestore?.rules === 'firestore.rules' && f.storage?.rules === 'storage.rules' && existsSync(join(c.dir, 'firestore.rules')), 'root rules files stay declared'];
    },
  },
  {
    id: 'secret-trigger',
    message: 'feat(functions): telegram notification on inquiry',
    apply(c) {
      const main = join(c.dir, 'apps/functions/src/main.ts');
      must(existsSync(main), 'apps/functions/src/main.ts is missing');
      appendFileSync(main, `
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';

const TELEGRAM_BOT_TOKEN = defineSecret('TELEGRAM_BOT_TOKEN');

/** Notifies the coach on Telegram when an inquiry arrives. */
export const onInquiryCreated = onDocumentCreated(
  { document: 'inquiries/{id}', secrets: [TELEGRAM_BOT_TOKEN] },
  async (event) => {
    logger.info('would notify telegram', { id: event.params.id, tokenLength: TELEGRAM_BOT_TOKEN.value().length });
  },
);
`);
      const ex = join(c.dir, 'apps/functions/.secret.local.example');
      must(existsSync(ex), 'apps/functions/.secret.local.example is missing');
      appendFileSync(ex, 'TELEGRAM_BOT_TOKEN=PASTE_TELEGRAM_BOT_TOKEN_HERE\n');
    },
    survives: (c) => [
      readFileSync(join(c.dir, 'apps/functions/.secret.local.example'), 'utf8').includes('TELEGRAM_BOT_TOKEN=')
        && readFileSync(join(c.dir, 'apps/functions/src/main.ts'), 'utf8').includes("defineSecret('TELEGRAM_BOT_TOKEN')"),
      'the trigger and its example key stay',
    ],
  },
  {
    id: 'secret-local',
    commit: false, // gitignored by the scaffold — a production secret on disk the upgrade must never touch
    apply(c) {
      const p = join(c.dir, 'apps/functions/.secret.local');
      writeFileSync(p, 'TELEGRAM_BOT_TOKEN=prod-FAKE-1234567890:do-not-read\n');
      must(git(c.dir, 'check-ignore', '-q', 'apps/functions/.secret.local').status === 0, '.secret.local is not gitignored');
    },
    survives: (c) => [readFileSync(join(c.dir, 'apps/functions/.secret.local'), 'utf8') === 'TELEGRAM_BOT_TOKEN=prod-FAKE-1234567890:do-not-read\n', '.secret.local byte-identical'],
  },
  {
    id: 'apphosting-runconfig',
    message: 'chore(apphosting): size the backend',
    apply(c) {
      const p = join(c.dir, 'apphosting.yaml');
      const src = readFileSync(p, 'utf8');
      const next = src.replace(/# runConfig:\n#\s+cpu: 1\n#\s+memoryMiB: 512\n#\s+minInstances: 0\n/, 'runConfig:\n  cpu: 1\n  memoryMiB: 1024\n  minInstances: 1\n');
      must(next !== src, "apphosting.yaml has no commented '# runConfig:' block to edit");
      writeFileSync(p, next);
    },
    survives: (c) => [/^runConfig:\n {2}cpu: 1\n {2}memoryMiB: 1024\n {2}minInstances: 1$/m.test(readFileSync(join(c.dir, 'apphosting.yaml'), 'utf8')), 'the edited runConfig is kept'],
  },
  {
    id: 'brand-lib',
    message: 'feat(brand): a brand library used by the app, made with Nx\'s own generator',
    async apply(c) {
      // Through Nx's own generator, as the project did — born untagged (no --tags), imported by the app. Then what such a
      // project does next: `nx sync`, the command the firewall's guidance names. The RELEASED toolkit decides what that means,
      // so the shape stays true on both sides of the firewall: released WITH it, the sync generator tags the library (a tagged
      // lint baseline; a project cannot stay untagged and green); released WITHOUT it, the sync has nothing to do, the library
      // reaches the upgrade untagged, and the 0.50.0 rung must classify it. `survives` asserts the tag either way.
      const [bin, pre] = nx(c.dir);
      const r = await run('seed-brand-lib-generate', bin, [...pre, 'g', '@nx/angular:library', '--directory=packages/brand', '--name=brand',
        `--importPath=@${c.name}/brand`, '--prefix=lib', '--unitTestRunner=none', '--linter=eslint', '--style=css', '--no-interactive'], { cwd: c.dir, timeoutMs: 10 * 60_000 });
      must(r.code === 0, `nx g @nx/angular:library failed (${r.log})`);
      const app = join(c.dir, `apps/${c.app}/src/app/app.ts`);
      const src = readFileSync(app, 'utf8');
      must(/imports: \[RouterModule/.test(src), `${app} has no 'imports: [RouterModule' to extend`);
      writeFileSync(app, `import { Brand } from '@${c.name}/brand';\n` + src.replace(/imports: \[RouterModule/, 'imports: [RouterModule, Brand'));
      appendFileSync(join(c.dir, `apps/${c.app}/src/app/app.html`), '\n<lib-brand></lib-brand>\n');
      const sync = await run('seed-brand-lib-sync', bin, [...pre, 'sync'], { cwd: c.dir, timeoutMs: 5 * 60_000 });
      must(sync.code === 0, `nx sync failed (${sync.log})`);
    },
    survives: (c) => [
      readFileSync(join(c.dir, `apps/${c.app}/src/app/app.ts`), 'utf8').includes(`from '@${c.name}/brand'`)
        && (readJson(join(c.dir, 'packages/brand/project.json')).tags ?? []).includes('platform:web'),
      'the app still imports the brand lib, and it is classified platform:web',
    ],
  },
  {
    id: 'web-e2e-compact',
    message: 'test(web-e2e): an e2e target that needs the running app',
    apply(c) {
      // Hand-written COMPACT JSON on purpose: the upgrade must not need it pretty, and should not re-serialise it.
      mkdirSync(join(c.dir, `apps/${c.app}-e2e`), { recursive: true });
      writeFileSync(join(c.dir, `apps/${c.app}-e2e/project.json`), `{
  "name": "${c.app}-e2e",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "application",
  "sourceRoot": "apps/${c.app}-e2e/src",
  "implicitDependencies": ["${c.app}"],
  "targets": {
    "e2e": {
      "executor": "nx:run-commands",
      "dependsOn": [{ "projects": ["${c.app}"], "target": "serve" }],
      "options": {
        "command": "node -e \\"console.log('e2e would run against ${c.app}')\\"",
        "devServerTarget": "${c.app}:serve"
      }
    }
  }
}
`);
    },
    survives: (c) => {
      const e = readJson(join(c.dir, `apps/${c.app}-e2e/project.json`)).targets?.e2e;
      return [(e?.dependsOn ?? []).some((d) => d.projects?.includes(c.app)), `${c.app}-e2e:e2e still depends on the running ${c.app}`];
    },
  },
];

// ── the steps ─────────────────────────────────────────────────────────────────────────────────────────────
const consumer = { name: 'coach', app: 'web', staging: opts.staging, dir: join(CONSUMERS, 'coach'), integration: null };
const ok = { released: false, seed: false, upgrade: false };
let baseline = null; // { build: Set<failed task>, lint: … } from the seeded consumer, before the upgrade

async function stepReleased() {
  const step = 'released';
  const sha = git(TOOLKIT, 'rev-parse', '--verify', `${opts.released}^{commit}`);
  if (sha.status !== 0) return record(step, `resolve --released=${opts.released}`, false, { detail: sha.stderr.trim() });
  const add = await run('released-worktree', 'git', ['-C', TOOLKIT, 'worktree', 'add', '--detach', RELEASED_TREE, sha.stdout.trim()]);
  if (!record(step, `worktree of ${opts.released} @ ${sha.stdout.trim().slice(0, 7)}`, add.code === 0, { ms: add.ms, log: add.log, detail: add.code ? why(add.out) : '' })) return false;
  const relVer = readJson(join(RELEASED_TREE, 'plugins/house/engine/nx-tools/package.json')).version;
  const flags = ['--preset=angular', '--firebase', ...(consumer.staging ? ['--staging'] : [])];
  const r = await run('released-new', 'bash', [HOUSE(RELEASED_TREE), 'new', ...flags, consumer.dir, consumer.app], { cwd: CONSUMERS });
  const good = r.code === 0 && /^NEW_OK /m.test(r.out) && existsSync(join(consumer.dir, 'HOUSE.md'));
  record(step, `new ${flags.join(' ')} (nx-tools ${relVer})`, good, { ms: r.ms, log: r.log, detail: good ? '' : `exit ${r.code}: ${why(r.out)}`, released: r.out });
  if (good) consumer.integration = gitOut(consumer.dir, 'branch', '--show-current');
  return (ok.released = good);
}

async function stepSeed() {
  const step = 'seed';
  if (!ok.released) return skipFor(step, 'seeds', 'no released consumer');
  let all = true;
  for (const s of SEEDS) {
    const t0 = Date.now();
    try {
      await s.apply(consumer);
      if (s.commit !== false) {
        gitOut(consumer.dir, 'add', '-A');
        gitOut(consumer.dir, 'commit', '-q', '-m', `${s.message}\n\n[dogfood-consumer seed: ${s.id}]`);
      }
      record(step, s.id, true, { ms: Date.now() - t0, detail: s.commit === false ? 'gitignored, not committed' : '' });
    } catch (e) {
      all = false;
      record(step, s.id, false, { ms: Date.now() - t0, detail: e.message.slice(0, 160) });
      git(consumer.dir, 'reset', '-q', '--hard'); git(consumer.dir, 'clean', '-qfd');
    }
  }
  const status = gitOut(consumer.dir, 'status', '--porcelain');
  record(step, 'tree clean after seeding', status === '', { detail: status ? status.split('\n').slice(0, 3).join(' | ') : '' });
  ok.seed = all && status === '';
  // The same build + lint + test the upgraded workspace gets, BEFORE the upgrade: what fails here was already broken in what
  // consumers have, so the upgrade's own rows can say which failures it introduced.
  if (ok.seed) baseline = await verify('seed', consumer.dir, 'baseline: ');
  return ok.seed;
}

function upgradeVerdict(out) {
  const bad = ['UPGRADE_PARTIAL', 'UPGRADE_REFUSED', 'UPGRADE_FAILED'].filter((t) => new RegExp(`^${t}\\b`, 'm').test(out));
  return { okLine: /^UPGRADE_OK /m.test(out), bad, next: (out.match(/^UPGRADE_NEXT: (\S+)/m) ?? [])[1] };
}

async function stepUpgrade() {
  const step = 'upgrade';
  if (!ok.seed) return skipFor(step, 'upgrade', 'the seeded consumer is not ready');
  const c = consumer;
  gitOut(c.dir, 'checkout', '-q', '-b', 'chore/house-upgrade'); // the preflight refuses a protected line, rightly
  const base = gitOut(c.dir, 'rev-parse', 'HEAD');

  const r1 = await run('upgrade-1', 'bash', [HOUSE(TOOLKIT), 'upgrade', '--local', '--yes', '.'], { cwd: c.dir });
  const v1 = upgradeVerdict(r1.out);
  const good = r1.code === 0 && v1.okLine && v1.bad.length === 0;
  record(step, `upgrade --local --yes (nx-tools ${TOOLKIT_VERSION})`, good, {
    ms: r1.ms, log: r1.log, detail: good ? `UPGRADE_NEXT: ${v1.next}, ${gitOut(c.dir, 'rev-list', '--count', `${base}..HEAD`)} commits` : `exit ${r1.code}${v1.bad.length ? ` ${v1.bad.join(' ')}` : ''}: ${why(r1.out)}`,
  });
  if (!good) return false;
  const st = stamp(c.dir);
  record(step, 'HOUSE.md stamped with the toolkit version', st.nxTools === TOOLKIT_VERSION, { detail: `nx-tools=${st.nxTools}` });
  const reports = r1.out.split('\n').filter((l) => /re-apply if it was yours|re-classify|override/i.test(l)).length;
  if (gitOut(c.dir, 'status', '--porcelain')) { gitOut(c.dir, 'add', '-A'); gitOut(c.dir, 'commit', '-q', '-m', 'chore: house upgrade (generator output)'); }
  for (const s of SEEDS.filter((x) => x.survives)) {
    let res;
    try { res = s.survives(c); } catch (e) { res = [false, e.message.slice(0, 120)]; }
    record(step, `survives: ${s.id}`, res[0], { detail: res[1] });
  }

  const head = gitOut(c.dir, 'rev-parse', 'HEAD');
  const r2 = await run('upgrade-2-idempotent', 'bash', [HOUSE(TOOLKIT), 'upgrade', '--local', '--yes', '.'], { cwd: c.dir });
  const v2 = upgradeVerdict(r2.out);
  const dirty = gitOut(c.dir, 'status', '--porcelain');
  const moved = gitOut(c.dir, 'rev-parse', 'HEAD') !== head;
  const idem = r2.code === 0 && v2.okLine && !v2.bad.length && v2.next === 'none' && !dirty && !moved;
  record(step, 'second upgrade is a no-op', idem, {
    ms: r2.ms, log: r2.log,
    detail: idem ? 'UPGRADE_NEXT: none, no commit, clean tree'
      : [r2.code && `exit ${r2.code}`, v2.bad.join(' '), v2.next !== 'none' && `UPGRADE_NEXT: ${v2.next}`, moved && 'new commits', dirty && `dirty: ${dirty.split('\n').slice(0, 3).join(' | ')}`, !v2.okLine && why(r2.out)].filter(Boolean).join('; '),
  });
  console.log(`        (first upgrade printed ${reports} report line(s) — read them in ${r1.log})`);
  await verify(step, c.dir, '', baseline);
  await verifyDsComponent(step, c.dir);
  return (ok.upgrade = true);
}

/** The check UPGRADE_OK / NEW_OK is not: the workspace builds, lints and passes its tests. `run-many` over every project (a fresh
 *  fixture has no cache to make `affected` cheaper), static output so the log reads top to bottom. */
async function verify(step, dir, prefix = '', before = null) {
  const [bin, pre] = nx(dir);
  const failedSets = {};
  for (const target of ['build', 'lint', 'test']) {
    const r = await run(`${step}-${prefix ? 'baseline-' : ''}${target}`, bin, [...pre, 'run-many', '-t', target, '--output-style=static'], { cwd: dir, timeoutMs: 20 * 60_000 });
    const failed = r.code ? failedTasks(r.out) : [];
    failedSets[target] = new Set(failed);
    // Nx exits 0 when no project has the target: nothing was checked, so it passes nothing. Every verified workspace has one for each.
    if (!r.code && /No tasks were run/.test(r.out)) {
      record(step, `${prefix}nx run-many -t ${target}`, false, { ms: r.ms, log: r.log, detail: 'no project has this target', reference: !!prefix, released: prefix ? r.out : null });
      continue;
    }
    let detail = (r.out.match(/Successfully ran target \S+ for (\d+ projects?)/) ?? [, ''])[1];
    if (r.code) {
      detail = failed.length ? `failed: ${failed.join(', ')}` : why(r.out);
      if (before?.[target]) {
        const fresh = failed.filter((t) => !before[target].has(t));
        detail += fresh.length === failed.length ? ' (all new since the baseline)' : fresh.length ? ` (NEW since the baseline: ${fresh.join(', ')})` : ' (every one already failed before the upgrade)';
      }
    }
    record(step, `${prefix}nx run-many -t ${target}`, r.code === 0, { ms: r.ms, log: r.log, detail, reference: !!prefix, released: prefix ? r.out : null });
  }
  return failedSets;
}
/** What `verify` cannot see: the first ds-component builds, lints and tests, and `nx test` is red on a failing spec in it. It runs after
 *  the road's checks and leaves no trace. It installs nothing, so it tests this checkout even before the version bump. */
async function verifyDsComponent(step, dir) {
  const [bin, pre] = nx(dir);
  const nxRun = (name, ...args) => run(`${step}-ds-component-${name}`, bin, [...pre, ...args], { cwd: dir, timeoutMs: 20 * 60_000 });
  const g = await nxRun('generate', 'g', '@bespunky/nx-tools:ds-component', 'card', '--no-interactive');
  if (!record(step, 'nx g ds-component card', g.code === 0, { ms: g.ms, log: g.log, detail: g.code ? why(g.out) : '' })) return;
  for (const target of ['build', 'lint', 'test']) {
    const r = await nxRun(target, target, 'design-system', '--output-style=static');
    record(step, `nx ${target} design-system, with a component`, r.code === 0, { ms: r.ms, log: r.log, detail: r.code ? why(r.out) : '' });
  }
  const spec = gitOut(dir, 'ls-files', '--others', '--exclude-standard', '*/card/src/card.spec.ts');
  if (!record(step, 'ds-component wrote card/src/card.spec.ts', !!spec)) return;
  writeFileSync(join(dir, spec), "it('fails', () => { expect(1).toBe(2); });\n");
  const failing = await nxRun('failing-spec', 'test', 'design-system', '--output-style=static');
  record(step, 'nx test design-system is red on a failing spec in the entry', failing.code !== 0, { ms: failing.ms, log: failing.log, detail: failing.code ? '' : 'exit 0 past a failing spec' });
  gitOut(dir, 'checkout', '-q', '.');
  gitOut(dir, 'clean', '-fdq');
}
/** The navigation kernel: no preset wears it, so `verify` never sees it. `nx test` is green on a kernel with no spec and red on a failing one.
 *  Its generator installs @nx/vitest for real, and after `--local` an install would fetch this unpublished toolkit from the registry, so the
 *  manifest first points at a pack of the build already installed. It leaves no trace in git. */
async function verifyNavigationCore(step, dir) {
  const [bin, pre] = nx(dir);
  const nxRun = (name, ...args) => run(`${step}-navigation-${name}`, bin, [...pre, ...args], { cwd: dir, timeoutMs: 20 * 60_000 });
  const pack = await run(`${step}-navigation-pack`, 'npm', ['pack', '--silent', '--pack-destination', TMP], { cwd: join(dir, 'node_modules/@bespunky/nx-tools') });
  if (!record(step, 'pack the installed toolkit', pack.code === 0, { ms: pack.ms, log: pack.log, detail: pack.code ? why(pack.out) : '' })) return;
  const manifest = readJson(join(dir, 'package.json'));
  manifest.devDependencies['@bespunky/nx-tools'] = `file:${join(TMP, pack.out.match(/^\S+\.tgz$/m)[0])}`;
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const g = await nxRun('generate', 'g', '@bespunky/nx-tools:navigation-core', '--no-interactive');
  if (!record(step, 'nx g navigation-core', g.code === 0, { ms: g.ms, log: g.log, detail: g.code ? why(g.out) : '' })) return;
  const green = await nxRun('test', 'test', 'navigation-core', '--output-style=static');
  record(step, 'nx test navigation-core passes with no spec', green.code === 0, { ms: green.ms, log: green.log, detail: green.code ? why(green.out) : '' });
  const root = gitOut(dir, 'ls-files', '--others', '--exclude-standard', '*/navigation-core/vite.config.mts').replace(/\/vite\.config\.mts$/, '');
  writeFileSync(join(dir, root, 'src/failing.spec.ts'), "import { it, expect } from 'vitest';\nit('fails', () => { expect(1).toBe(2); });\n");
  const failing = await nxRun('failing-spec', 'test', 'navigation-core', '--output-style=static');
  // Red for the spec's own reason: a target that cannot even start is red too.
  const red = failing.code !== 0 && failing.out.includes('failing.spec.ts');
  record(step, 'nx test navigation-core is red on a failing spec', red, { ms: failing.ms, log: failing.log, detail: red ? '' : failing.code ? why(failing.out) : 'exit 0 past a failing spec' });
  gitOut(dir, 'checkout', '-q', '.');
  gitOut(dir, 'clean', '-fdq');
}
/** Nx's own "Failed tasks:" list, as task ids. */
function failedTasks(out) {
  const at = out.indexOf('Failed tasks:');
  return at < 0 ? [] : [...out.slice(at).matchAll(/^- (\S+)$/gm)].map((m) => m[1]);
}

async function stepNew(id) {
  const p = PRESETS[id];
  const dir = join(CONSUMERS, id);
  const r = await run(id, 'bash', [HOUSE(TOOLKIT), 'new', '--local', ...p.flags, dir, ...(p.app ? [p.app] : [])], { cwd: CONSUMERS });
  const good = r.code === 0 && /^NEW_OK /m.test(r.out);
  if (!record(id, `new --local ${p.flags.join(' ') || '(default: agent)'}`, good, { ms: r.ms, log: r.log, detail: good ? '' : `exit ${r.code}: ${why(r.out)}` })) return;
  const st = existsSync(join(dir, 'HOUSE.md')) ? stamp(dir) : { layers: [] };
  record(id, 'HOUSE.md stamped with the toolkit version', st.nxTools === TOOLKIT_VERSION, { detail: `nx-tools=${st.nxTools ?? 'none'}` });
  const missing = p.layers.filter((l) => !st.layers.includes(l));
  record(id, `layers include ${p.layers.join(',')}`, missing.length === 0, { detail: `stamped ${st.layers.join(',') || 'none'}` });
  const facts = [
    ['a git repo with a clean tree', git(dir, 'status', '--porcelain').stdout === '' && git(dir, 'rev-parse', 'HEAD').status === 0],
    p.host === 'wrapper' ? ['wrapper host: ./nx and no package.json', existsSync(join(dir, 'nx')) && !existsSync(join(dir, 'package.json'))]
      : ['node host: package.json pins @bespunky/nx-tools', readJson(join(dir, 'package.json')).devDependencies?.['@bespunky/nx-tools'] === TOOLKIT_VERSION],
    ...(p.app ? [[`apps/${p.app}/project.json`, existsSync(join(dir, `apps/${p.app}/project.json`))]] : []),
    ...(p.firebase ? [['firebase.json + apps/functions', existsSync(join(dir, 'firebase.json')) && existsSync(join(dir, 'apps/functions/project.json'))]] : []),
  ];
  for (const [what, yes] of facts) record(id, what, yes);
  if (p.verify) {
    await verify(id, dir);
    await verifyDsComponent(id, dir);
    await verifyNavigationCore(id, dir);
  }
}

// ── the postgres layer, for real ──────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let postgresEnv;
/** The environment the real pinned server and dbmate run under, or { skip: why } on a machine the closures do not cover. */
async function realPostgres() {
  if (postgresEnv) return postgresEnv;
  const { NoClosureHere, ensureTools } = await import(join(TOOLKIT, 'tools/test-postgres/tools.mjs'));
  try {
    postgresEnv = { ...(await ensureTools()), XDG_DATA_HOME: POSTGRES_DATA, DEV_OWNER: process.env.DEV_OWNER || 'dogfood-consumer' };
  } catch (error) {
    if (!(error instanceof NoClosureHere)) throw error;
    postgresEnv = { skip: error.message };
  }
  return postgresEnv;
}

const canBind = (port) => new Promise((done) => {
  const server = createServer();
  server.once('error', () => done(false));
  server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
});
const canConnect = (port) => new Promise((done) => {
  const socket = connect({ port, host: '127.0.0.1' });
  const end = (answer) => { socket.destroy(); done(answer); };
  socket.once('connect', () => end(true));
  socket.once('error', () => end(false));
});
/** A random offset whose every base port lands on a free one: never a base port, and never one a forwarded server holds. */
async function freeOffset(...bases) {
  for (let tries = 0; tries < 50; tries++) {
    const offset = 20000 + Math.floor(Math.random() * 25000);
    if ((await Promise.all(bases.map((base) => canBind(base + offset)))).every(Boolean)) return offset;
  }
  throw new Error('no free port block found');
}
async function until(what, ms = 180_000, every = 250) {
  const deadline = Date.now() + ms;
  for (;;) {
    const answer = await what();
    if (answer || Date.now() > deadline) return answer;
    await sleep(every);
  }
}
const psqlIn = (tools, url, sql) => spawnSync('psql', ['-X', '-At', url, '-c', sql], { env: { ...ENV, ...tools, PGCONNECT_TIMEOUT: '5' }, encoding: 'utf8' });
const devEngine = (dir, tools, ...args) => spawnSync('node', ['tools/dev/dev.mjs', ...args], { cwd: dir, env: { ...ENV, ...tools }, encoding: 'utf8' });
const stacksIn = (dir, tools) => { try { return JSON.parse(devEngine(dir, tools, 'ps', '--json').stdout); } catch { return null; } };
/** Whatever of a real server's or this project's is still running: what the stop must not leave. */
function leftBehind(dir) {
  const out = [...straysUnder(dir), ...straysUnder(POSTGRES_DATA)];
  return [...new Map(out.map((s) => [s.pid, s])).values()];
}
/** Stop a stack by its handle, the way a consumer does, and hold it to everything a stop promises. Kills what it left, so one failure stays one red row. */
async function assertStops(step, dir, tools, app, offset, ports, handle) {
  const stop = devEngine(dir, tools, 'stop', app, `--offset=${offset}`);
  record(step, `tools/dev/dev stop ${app} exits 0`, stop.status === 0, { detail: stop.status === 0 ? '' : `exit ${stop.status}: ${(stop.stdout + stop.stderr).trim().split('\n').at(-1)?.slice(0, 140)}` });
  await until(() => handle.ended, 30_000);
  record(step, 'the stack it stopped ended cleanly', handle.ended && handle.code === 0, { log: handle.log, detail: handle.ended ? (handle.code ? `exit ${handle.code}` : '') : 'still running after 30s' });
  const stacks = stacksIn(dir, tools);
  record(step, 'tools/dev/dev ps shows nothing', stacks?.length === 0, { detail: stacks?.length ? stacks.map((row) => `${row.key} ${row.state}`).join(', ') : '' });
  const listening = (await Promise.all(ports.map(async (port) => ((await canConnect(port)) ? port : null)))).filter(Boolean);
  record(step, 'every port it held is free', listening.length === 0, { detail: listening.length ? `still listening: ${listening.join(', ')}` : '' });
  const left = leftBehind(dir);
  record(step, 'no process left, and no server on its data', left.length === 0, { detail: left.map((s) => `${s.pid} ${s.cmd}`).join(' | ').slice(0, 200) });
  for (const { pid } of left) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  if (!handle.ended) killGroup(handle.pid);
}

/** A served app no stack knows: the dev-server a Python or Go project would have, with a `port`, so the generators can seed it. It says what it was handed. */
function writeServedFixture(dir, name) {
  mkdirSync(join(dir, 'apps', name), { recursive: true });
  writeJson(join(dir, 'apps', name, 'project.json'), {
    name,
    root: `apps/${name}`,
    targets: { 'dev-server': { executor: 'nx:run-commands', options: { command: `node apps/${name}/server.mjs`, port: 4310 } } },
  });
  writeFileSync(join(dir, 'apps', name, 'server.mjs'), `import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const port = Number(process.argv.find((arg) => arg.startsWith('--port='))?.slice(7));
writeFileSync('apps/${name}/received.json', JSON.stringify({ port, DATABASE_URL: process.env.DATABASE_URL, DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL }));
const server = createServer((_request, response) => response.end('up'));
server.listen(port, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => server.close(() => process.exit(0)));
`);
  writeFileSync(join(dir, '.gitignore'), `${readFileSync(join(dir, '.gitignore'), 'utf8').trimEnd()}\napps/${name}/received.json\n`);
}

const commitAll = (dir, message) => {
  gitOut(dir, 'add', '-A');
  if (gitOut(dir, 'status', '--porcelain')) gitOut(dir, 'commit', '-q', '-m', message);
};

/** A second upgrade changes nothing. The road's own idempotence, separately from the Angular consumer's. */
async function assertUpgradeIsNoOp(step, dir, args = []) {
  const head = gitOut(dir, 'rev-parse', 'HEAD');
  const r = await run(`${step}-upgrade-again`, 'bash', [HOUSE(TOOLKIT), 'upgrade', '--local', '--yes', '.', ...args], { cwd: dir });
  const v = upgradeVerdict(r.out);
  const dirty = gitOut(dir, 'status', '--porcelain');
  const moved = gitOut(dir, 'rev-parse', 'HEAD') !== head;
  const idem = r.code === 0 && v.okLine && !v.bad.length && v.next === 'none' && !dirty && !moved;
  record(step, 'a second upgrade is a no-op', idem, {
    ms: r.ms, log: r.log,
    detail: idem ? '' : [r.code && `exit ${r.code}`, v.bad.join(' '), v.next !== 'none' && `UPGRADE_NEXT: ${v.next}`, moved && 'new commits', dirty && `dirty: ${dirty.split('\n').slice(0, 3).join(' | ')}`, !v.okLine && why(r.out)].filter(Boolean).join('; '),
  });
}

/** `new`, then the day the project gains a served app and upgrades, then a real serve of what the generators declared. */
async function stepNewPostgres(id) {
  const road = POSTGRES_ROADS[id];
  const dir = join(CONSUMERS, id);
  const app = 'fixture';
  const r = await run(id, 'bash', [HOUSE(TOOLKIT), 'new', '--local', ...road.flags, dir], { cwd: CONSUMERS });
  const good = r.code === 0 && /^NEW_OK /m.test(r.out);
  if (!record(id, `new --local ${road.flags.join(' ')}`, good, { ms: r.ms, log: r.log, detail: good ? '' : `exit ${r.code}: ${why(r.out)}` })) return;
  const st = stamp(dir);
  record(id, 'HOUSE.md stamped with the toolkit version', st.nxTools === TOOLKIT_VERSION, { detail: `nx-tools=${st.nxTools}` });
  const missing = road.layers.filter((l) => !st.layers.includes(l));
  record(id, `layers include ${road.layers.join(',')}`, missing.length === 0, { detail: `stamped ${st.layers.join(',')}` });
  record(id, `${road.host} host`, road.host === 'wrapper' ? existsSync(join(dir, 'nx')) && !existsSync(join(dir, 'package.json')) : existsSync(join(dir, 'package.json')));
  record(id, 'the launcher, the targets and the seeded major', ['tools/postgres/postgres.mjs', 'tools/dev/dev.mjs', 'postgres/project.json', '.bespunky/postgres.json'].every((f) => existsSync(join(dir, f))));
  record(id, 'nothing served yet: no .bespunky/dev.json', !existsSync(join(dir, '.bespunky/dev.json')));

  // The project gains an app with a dev-server, and the next upgrade attaches the server to it.
  gitOut(dir, 'checkout', '-q', '-b', 'feat/served-app');
  writeServedFixture(dir, app);
  commitAll(dir, 'feat: an app with a dev-server');
  const up = await run(`${id}-upgrade`, 'bash', [HOUSE(TOOLKIT), 'upgrade', '--local', '--yes', '.', app], { cwd: dir });
  const v = upgradeVerdict(up.out);
  const upgraded = up.code === 0 && v.okLine && !v.bad.length;
  if (!record(id, `upgrade --local --yes . ${app}`, upgraded, { ms: up.ms, log: up.log, detail: upgraded ? '' : `exit ${up.code}${v.bad.length ? ` ${v.bad.join(' ')}` : ''}: ${why(up.out)}` })) return;
  commitAll(dir, 'chore: house upgrade (generator output)');
  const declared = existsSync(join(dir, '.bespunky/dev.json')) ? readJson(join(dir, '.bespunky/dev.json')).apps?.[app]?.processes ?? [] : [];
  const server = declared.find((p) => p.id === 'postgres');
  const primary = declared.find((p) => p.id === 'app');
  const seeded = server?.dependency === true && !server.primary && primary?.primary === true && Boolean(server.exports?.DATABASE_URL) && Boolean(server.exports?.DIRECT_DATABASE_URL);
  if (!record(id, 'the generators seeded the app, with the server as its dependency', seeded, { detail: seeded ? '' : `declared: ${declared.map((p) => p.id).join(', ') || 'nothing'}` })) return;
  await assertUpgradeIsNoOp(id, dir, [app]);

  const tools = await realPostgres();
  if (tools.skip) return record(id, 'a real boot', null, { detail: tools.skip });
  const [bin, pre] = nx(dir);

  // A migration made by the project's own verb, with the project's own seed.
  const made = await run(`${id}-new-migration`, bin, [...pre, 'run', 'postgres:new-migration', 'thing'], { cwd: dir, env: tools });
  const file = listOrNull(join(dir, 'postgres/migrations'))?.split(',').find((name) => name.endsWith('_thing.sql'));
  if (!record(id, 'nx run postgres:new-migration thing', made.code === 0 && Boolean(file), { ms: made.ms, log: made.log, detail: made.code ? why(made.out) : '' })) return;
  writeFileSync(join(dir, 'postgres/migrations', file), '-- migrate:up\nCREATE TABLE thing (id int PRIMARY KEY, name text);\n\n-- migrate:down\n');
  writeFileSync(join(dir, 'postgres/seed/world/01_things.sql'), "INSERT INTO thing VALUES (1, 'seeded');\n");

  const offset = await freeOffset(4310, 5432);
  const ports = [4310 + offset, 5432 + offset];
  const received = join(dir, 'apps', app, 'received.json');
  const t0 = Date.now();
  // Stream, as the executor's own refusal says: this tool is often an agent's, and Nx shows an agent nothing of a static serve.
  const serve = background(`${id}-serve`, bin, [...pre, 'serve', app, `--port-offset=${offset}`, '--no-shared-browser'], { cwd: dir, env: { ...tools, NX_DEFAULT_OUTPUT_STYLE: 'stream' } });
  const up2 = await until(async () => serve.ended || (existsSync(received) && (await canConnect(ports[0]))));
  const booted = !serve.ended && Boolean(up2);
  if (!record(id, `nx serve ${app} comes up, its server first`, booted, { ms: Date.now() - t0, log: serve.log, detail: booted ? '' : serve.ended ? `ended, exit ${serve.code}: ${why(serve.out())}` : 'not up after 3 minutes' })) {
    killGroup(serve.pid);
    return;
  }
  const seen = readJson(received);
  const url = `postgresql://postgres:postgres@127.0.0.1:${ports[1]}/app?sslmode=disable`;
  record(id, 'the app received DATABASE_URL, at its own stack\'s port', seen.DATABASE_URL === url, { detail: seen.DATABASE_URL === url ? '' : `received ${seen.DATABASE_URL}` });
  record(id, 'and DIRECT_DATABASE_URL', seen.DIRECT_DATABASE_URL === url, { detail: seen.DIRECT_DATABASE_URL === url ? '' : `received ${seen.DIRECT_DATABASE_URL}` });
  record(id, 'the app is on its own stack\'s port', seen.port === ports[0], { detail: `${seen.port}` });
  const row = psqlIn(tools, seen.DATABASE_URL, 'SELECT name FROM thing');
  record(id, 'the migration and the seed applied, read through that URL', row.status === 0 && row.stdout.trim() === 'seeded', { detail: row.status === 0 ? row.stdout.trim() : row.stderr.trim().slice(0, 140) });
  const stamped = psqlIn(tools, seen.DATABASE_URL, 'SELECT version FROM schema_migrations');
  record(id, 'dbmate recorded the migration', stamped.stdout.trim() === file.split('_')[0], { detail: stamped.stdout.trim().slice(0, 40) });
  const stack = stacksIn(dir, tools)?.find((candidate) => candidate.offset === offset);
  record(id, 'tools/dev/dev ps names the stack, live, with both ports', stack?.state === 'live' && stack.ports?.app === ports[0] && stack.ports?.postgres === ports[1], { detail: stack ? `${stack.key} ${stack.state}` : 'no such stack' });
  await assertStops(id, dir, tools, app, offset, ports, serve);
}

/** The layer added to a project with history: the upgraded Firebase + Angular consumer. */
async function stepAddLayerPostgres() {
  const step = 'add-layer-postgres';
  if (!ok.upgrade) return skipFor(step, 'add-layer postgres', 'the upgraded consumer is not ready');
  const c = consumer;
  const declaredBefore = readJson(join(c.dir, '.bespunky/dev.json')).apps?.[c.app]?.processes?.map((p) => p.id) ?? [];
  const r = await run(step, 'bash', [HOUSE(TOOLKIT), 'add-layer', '--local', '--yes', 'postgres', '.', c.app], { cwd: c.dir });
  const v = upgradeVerdict(r.out);
  const good = r.code === 0 && v.okLine && !v.bad.length;
  if (!record(step, 'add-layer --local --yes postgres', good, { ms: r.ms, log: r.log, detail: good ? `UPGRADE_NEXT: ${v.next}` : `exit ${r.code}${v.bad.length ? ` ${v.bad.join(' ')}` : ''}: ${why(r.out)}` })) return;
  commitAll(c.dir, 'chore: add the postgres layer');
  const st = stamp(c.dir);
  record(step, 'the stamp wears postgres, and every layer it had', ['postgres', 'firebase', 'angular', 'web'].every((l) => st.layers.includes(l)), { detail: st.layers.join(',') });
  for (const s of SEEDS.filter((x) => x.survives)) {
    let res;
    try { res = s.survives(c); } catch (e) { res = [false, e.message.slice(0, 120)]; }
    record(step, `survives: ${s.id}`, res[0], { detail: res[1] });
  }
  const processes = readJson(join(c.dir, '.bespunky/dev.json')).apps?.[c.app]?.processes ?? [];
  const ids = processes.map((p) => p.id);
  const kept = declaredBefore.every((id) => ids.includes(id));
  const server = processes.find((p) => p.id === 'postgres');
  record(step, `${c.app} keeps what it served, and gains the server as a dependency`, kept && server?.dependency === true, { detail: ids.join(', ') });
  const firewall = existsSync(join(c.dir, 'eslint.config.mjs')) ? readFileSync(join(c.dir, 'eslint.config.mjs'), 'utf8') : '';
  record(step, 'the firewall bans the database driver from a browser bundle', /['"]pg['"]/.test(firewall));
  const packages = readFileSync(join(c.dir, '.devcontainer/house.packages.sh'), 'utf8');
  record(step, 'the image installs the server and dbmate', packages.includes('\ndbmate ') && packages.includes('\ntool postgres '));
  await assertUpgradeIsNoOp(step, c.dir, [c.app]);
  await verify(step, c.dir, '', baseline);

  const tools = await realPostgres();
  if (tools.skip) return record(step, 'a real boot', null, { detail: tools.skip });
  const [bin, pre] = nx(c.dir);
  const offset = await freeOffset(5432);
  const key = `postgres@${offset}`;
  const t0 = Date.now();
  const start = background(`${step}-start`, bin, [...pre, 'run', 'postgres:start', `--port-offset=${offset}`], { cwd: c.dir, env: { ...tools, NX_DEFAULT_OUTPUT_STYLE: 'stream' } });
  const up = await until(() => start.ended || existsSync(join(c.dir, '.bespunky/run', key, 'postgres.ready')));
  const booted = !start.ended && Boolean(up);
  if (!record(step, 'nx run postgres:start boots there, on the real server', booted, { ms: Date.now() - t0, log: start.log, detail: booted ? '' : start.ended ? `ended, exit ${start.code}: ${why(start.out())}` : 'not up after 3 minutes' })) {
    killGroup(start.pid);
    return;
  }
  const answer = psqlIn(tools, `postgresql://postgres@127.0.0.1:${5432 + offset}/app?sslmode=disable`, 'SELECT 1');
  record(step, 'and answers', answer.stdout.trim() === '1', { detail: answer.status === 0 ? '' : answer.stderr.trim().slice(0, 140) });
  await assertStops(step, c.dir, tools, 'postgres', offset, [5432 + offset], start);
}

// ── cleanup ───────────────────────────────────────────────────────────────────────────────────────────────
let cleaned = false;
function cleanup() {
  if (cleaned) return; cleaned = true;
  if (current) killGroup(current.pid);
  for (const service of services) killGroup(service.pid);
  for (const s of straysUnder(WORK)) { try { process.kill(s.pid, 'SIGKILL'); } catch { /* gone */ } }
  if (existsSync(RELEASED_TREE)) {
    spawnSync('git', ['-C', TOOLKIT, 'worktree', 'remove', '--force', RELEASED_TREE], { env: ENV });
    rmSync(RELEASED_TREE, { recursive: true, force: true });
  }
  rmSync(TMP, { recursive: true, force: true });
  if (!opts.keep) rmSync(CONSUMERS, { recursive: true, force: true });
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { console.error(`\n[dogfood] ${sig} — cleaning up`); cleanup(); summary(); process.exit(130); });
}

function fmt(ms) {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}
function summary() {
  const w = { step: Math.max(4, ...results.map((r) => r.step.length)), check: Math.max(5, ...results.map((r) => r.check.length)) };
  const line = (a, b, c, d, e) => `${a.padEnd(w.step)}  ${b.padEnd(w.check)}  ${c.padEnd(8)}  ${d.padStart(7)}  ${e}`;
  console.log(`\n${line('STEP', 'CHECK', 'RES', 'TIME', 'DETAIL')}\n${'-'.repeat(w.step + w.check + 28)}`);
  for (const r of results) console.log(line(r.step, r.check, r.status, r.ms ? fmt(r.ms) : '', r.detail));
  const n = (s) => results.filter((r) => r.status === s).length;
  const lost = results.filter((r) => r.notCovered);
  const broken = [...new Set(upstream.map((u) => u.text))];
  // Lost coverage is never a clean PASS: the verdict itself names it.
  const verdict = n('FAIL') ? 'FAIL' : broken.length ? `PASS (incomplete: baseline broken upstream — ${lost.map((r) => r.step).join(', ') || 'the released consumer'} not covered)` : 'PASS';
  console.log(`\n${verdict} — ${n('PASS')} passed, ${n('FAIL')} failed, ${n('SKIP') - lost.length} skipped${lost.length ? `, ${lost.length} NOT COVERED (baseline broken upstream)` : ''}${n('UPSTREAM') ? `, ${n('UPSTREAM')} UPSTREAM (the released baseline broken by the registry, not by any code)` : ''}${n('BASE') ? `, ${n('BASE')} failing in the RELEASED baseline only (reference, not this run's)` : ''} in ${fmt(Date.now() - T0)}`);
  if (broken.length) {
    console.log(`upstream: ${broken.join('; ')}`);
    const reruns = [...new Set(upstream.map((u) => u.cause.rerun).filter(Boolean))];
    if (reruns.length) {
      const args = process.argv.slice(2).map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ');
      console.log(`rerun (engine breaks only — it tells the package manager to skip its engine check):\n  ${reruns.join(' ')} node tools/dogfood-consumer/run.mjs${args ? ` ${args}` : ''}`);
    }
  }
  console.log(`toolkit under test: ${TOOLKIT} (nx-tools ${TOOLKIT_VERSION}); released: ${opts.released}`);
  console.log(`logs: ${LOGS}${opts.keep ? `\nkept projects: ${CONSUMERS}` : ''}`);
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────────────────
const T0 = Date.now();
console.log(`dogfood-consumer: toolkit ${TOOLKIT} (nx-tools ${TOOLKIT_VERSION}), released ${opts.released}, steps ${[...STEPS].join(',')}`);
console.log(`workdir ${WORK}\n`);
try {
  if (STEPS.has('released')) await stepReleased();
  if (STEPS.has('seed')) await stepSeed();
  if (STEPS.has('upgrade')) await stepUpgrade();
  if (STEPS.has('add-layer-postgres')) await stepAddLayerPostgres();
  for (const id of Object.keys(PRESETS)) if (STEPS.has(id)) await stepNew(id);
  for (const id of Object.keys(POSTGRES_ROADS)) if (STEPS.has(id)) await stepNewPostgres(id);
} catch (e) {
  record('run', 'tool error', false, { detail: e.stack?.split('\n').slice(0, 2).join(' ') ?? String(e) });
} finally {
  const strays = straysUnder(WORK);
  record('run', 'no process left under the workdir', strays.length === 0, { detail: strays.map((s) => `${s.pid} ${s.cmd}`).join(' | ').slice(0, 200) });
  record('run', 'nothing written to ~/projects', listOrNull(HOME_PROJECTS) === homeProjectsBefore, { detail: homeProjectsBefore === null && existsSync(HOME_PROJECTS) ? `${HOME_PROJECTS} was created` : '' });
  cleanup();
  summary();
}
process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
