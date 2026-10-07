#!/usr/bin/env node
/**
 * DOGFOOD A PAYLOAD RELEASE THE WAY A CONSUMER RECEIVES IT — in one step.
 *
 *   node tools/dogfood-consumer/run.mjs [--released=<ref>] [--toolkit=<path>] [--only=<steps>]
 *                                       [--workdir=<dir>] [--no-staging] [--keep]
 *
 * NETWORK, MINUTES (~20–40), npm registry + yarn installs. NOT CI and NOT the pre-push hook — a release gate a
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
 *             upgraded workspace builds and lints (`UPGRADE_OK` says the run completed, never that its output
 *             compiles — house.sh says so itself, in UPGRADE_VERIFY).
 *   new-*     a real `house.sh new --local` with the toolkit under test for EVERY preset: agent, node, angular and
 *             angular + --firebase, each with its sanity facts, and build + lint where there is an app to build.
 *
 * `--yes` is passed to the upgrades on purpose and is not the gate being satisfied by a machine: the upgrade
 * target is a throwaway fixture this run created seconds earlier, and running this tool IS the human's consent.
 *
 * Steps (--only, comma-separated; prerequisites are pulled in): released, seed, upgrade, new-agent, new-node,
 * new-angular, new-angular-firebase; aliases `consumer` (= released,seed,upgrade) and `new` (= every new-*).
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
  else if (k === '--help' || k === '-h') { console.log(USAGE); process.exit(0); }
  else { console.error(`unknown argument '${a}'\n${USAGE}`); process.exit(2); }
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
const STEP_ORDER = ['released', 'seed', 'upgrade', ...Object.keys(PRESETS)];
const REQUIRES = { seed: ['released'], upgrade: ['seed'] };
const ALIASES = { consumer: ['released', 'seed', 'upgrade'], new: Object.keys(PRESETS) };

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
function run(label, cmd, args, { cwd, timeoutMs = 30 * 60_000 } = {}) {
  const log = join(LOGS, `${String(++logSeq).padStart(2, '0')}-${label.replace(/[^a-z0-9.-]+/gi, '_')}.log`);
  writeFileSync(log, `$ (cd ${cwd ?? process.cwd()} && ${[cmd, ...args].join(' ')})\n\n`);
  const fd = openSync(log, 'a');
  const t0 = Date.now();
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd, env: ENV, stdio: ['ignore', fd, fd], detached: true });
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
function record(step, check, ok, { ms = 0, detail = '', log = '' } = {}) {
  const status = ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL';
  results.push({ step, check, status, ms, detail, log });
  console.log(`  ${status.padEnd(4)}  ${step} · ${check}${detail ? ` — ${detail}` : ''}`);
  return ok;
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
    message: 'chore: declare the branch model (string deploys notes)',
    async apply(c) {
      // Written with the RELEASED branches.mjs, the way the project wrote it, with the legacy STRING `deploys`.
      const b = join(RELEASED_TREE, 'plugins/workflow/skills/branch-and-release/scripts/branches.mjs');
      const stages = c.staging ? 'staging,main' : 'main';
      const ex = spawnSync('node', [b, 'expand', '--preset', c.staging ? 'three-line' : 'two-line', '--stages', stages], { cwd: c.dir, env: ENV, encoding: 'utf8' });
      must(ex.status === 0, `branches.mjs expand: ${ex.stderr.trim()}`);
      const model = JSON.parse(ex.stdout);
      for (const s of model.stages) {
        s.deploys = s.branch === 'main'
          ? `App Hosting backend ${c.name}-web tracks main (GitHub-linked); functions deployed by hand: nx run functions:deploy`
          : `App Hosting backend ${c.name}-${s.branch} tracks ${s.branch}; functions deployed by hand: nx run functions:deploy -P ${s.branch}`;
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
    message: 'feat(brand): untagged brand library used by the app',
    async apply(c) {
      // Through Nx's own generator, as the project did — untagged (no --tags), imported by the app.
      const [bin, pre] = nx(c.dir);
      const r = await run('seed-brand-lib-generate', bin, [...pre, 'g', '@nx/angular:library', '--directory=packages/brand', '--name=brand',
        `--importPath=@${c.name}/brand`, '--prefix=lib', '--unitTestRunner=none', '--linter=eslint', '--style=css', '--no-interactive'], { cwd: c.dir, timeoutMs: 10 * 60_000 });
      must(r.code === 0, `nx g @nx/angular:library failed (${r.log})`);
      const app = join(c.dir, `apps/${c.app}/src/app/app.ts`);
      const src = readFileSync(app, 'utf8');
      must(/imports: \[RouterModule/.test(src), `${app} has no 'imports: [RouterModule' to extend`);
      writeFileSync(app, `import { Brand } from '@${c.name}/brand';\n` + src.replace(/imports: \[RouterModule/, 'imports: [RouterModule, Brand'));
      appendFileSync(join(c.dir, `apps/${c.app}/src/app/app.html`), '\n<lib-brand></lib-brand>\n');
    },
    survives: (c) => [readFileSync(join(c.dir, `apps/${c.app}/src/app/app.ts`), 'utf8').includes(`from '@${c.name}/brand'`) && existsSync(join(c.dir, 'packages/brand/project.json')), 'the app still imports the brand lib'],
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
const ok = { released: false, seed: false };
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
  record(step, `new ${flags.join(' ')} (nx-tools ${relVer})`, good, { ms: r.ms, log: r.log, detail: good ? '' : `exit ${r.code}: ${why(r.out)}` });
  if (good) consumer.integration = gitOut(consumer.dir, 'branch', '--show-current');
  return (ok.released = good);
}

async function stepSeed() {
  const step = 'seed';
  if (!ok.released) return record(step, 'seeds', null, { detail: 'no released consumer' });
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
  // The same build + lint the upgraded workspace gets, BEFORE the upgrade: what fails here was already broken in what
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
  if (!ok.seed) return record(step, 'upgrade', null, { detail: 'the seeded consumer is not ready' });
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
  return true;
}

/** The check UPGRADE_OK / NEW_OK is not: the workspace builds and lints. `run-many` over every project (a fresh
 *  fixture has no cache to make `affected` cheaper), static output so the log reads top to bottom. */
async function verify(step, dir, prefix = '', before = null) {
  const [bin, pre] = nx(dir);
  const failedSets = {};
  for (const target of ['build', 'lint']) {
    const r = await run(`${step}-${prefix ? 'baseline-' : ''}${target}`, bin, [...pre, 'run-many', '-t', target, '--output-style=static'], { cwd: dir, timeoutMs: 20 * 60_000 });
    const failed = r.code ? failedTasks(r.out) : [];
    failedSets[target] = new Set(failed);
    let detail = (r.out.match(/Successfully ran target \S+ for (\d+ projects?)/) ?? [, ''])[1];
    if (r.code) {
      detail = failed.length ? `failed: ${failed.join(', ')}` : why(r.out);
      if (before?.[target]) {
        const fresh = failed.filter((t) => !before[target].has(t));
        detail += fresh.length === failed.length ? ' (all new since the baseline)' : fresh.length ? ` (NEW since the baseline: ${fresh.join(', ')})` : ' (every one already failed before the upgrade)';
      }
    }
    record(step, `${prefix}nx run-many -t ${target}`, r.code === 0, { ms: r.ms, log: r.log, detail });
  }
  return failedSets;
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
  if (p.verify) await verify(id, dir);
}

// ── cleanup ───────────────────────────────────────────────────────────────────────────────────────────────
let cleaned = false;
function cleanup() {
  if (cleaned) return; cleaned = true;
  if (current) killGroup(current.pid);
  for (const s of straysUnder(WORK)) { try { process.kill(s.pid, 'SIGKILL'); } catch { /* gone */ } }
  if (existsSync(RELEASED_TREE)) {
    spawnSync('git', ['-C', TOOLKIT, 'worktree', 'remove', '--force', RELEASED_TREE], { env: ENV });
    rmSync(RELEASED_TREE, { recursive: true, force: true });
  }
  spawnSync('git', ['-C', TOOLKIT, 'worktree', 'prune'], { env: ENV });
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
  const line = (a, b, c, d, e) => `${a.padEnd(w.step)}  ${b.padEnd(w.check)}  ${c.padEnd(4)}  ${d.padStart(7)}  ${e}`;
  console.log(`\n${line('STEP', 'CHECK', 'RES', 'TIME', 'DETAIL')}\n${'-'.repeat(w.step + w.check + 24)}`);
  for (const r of results) console.log(line(r.step, r.check, r.status, r.ms ? fmt(r.ms) : '', r.detail));
  const n = (s) => results.filter((r) => r.status === s).length;
  console.log(`\n${n('FAIL') ? 'FAIL' : 'PASS'} — ${n('PASS')} passed, ${n('FAIL')} failed, ${n('SKIP')} skipped in ${fmt(Date.now() - T0)}`);
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
  for (const id of Object.keys(PRESETS)) if (STEPS.has(id)) await stepNew(id);
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
