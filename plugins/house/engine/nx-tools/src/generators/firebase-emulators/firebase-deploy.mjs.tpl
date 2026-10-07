#!/usr/bin/env node
// The Firebase deploy runner — and the road to a FIRST deploy. Generator-owned (@bespunky/nx-tools
// firebase-emulators): rewritten on every upgrade, never hand-edit.
//
//   node tools/firebase-deploy.mjs --check                   where this machine stands on the road to a first deploy
//   node tools/firebase-deploy.mjs --only functions [args]   what `nx run {{functionsProject}}:deploy` runs
//
// Arguments reach this file through Nx run-commands, which joins them into one SHELL command line, each double-quoted:
// `$` and backticks in an argument are expanded before they get here — escape them with a backslash. This file
// itself never uses a shell (the CLI is spawned with an argument vector).
//   import { deploy } from './firebase-deploy.mjs'           what tools/firebase-deploy-rules.mjs (firebase:deploy) runs
//
// Every deploy target runs the project's pinned Firebase CLI through here, so a deploy that fails for want of a
// login, a project alias or the CI identity does not end on Firebase's bare "have you run firebase login?": it ends on
// the whole road — log in, pick the project, deploy, then hand deploys to CI — with what this machine already has
// ticked, and how to tell each step worked. Nothing here is a gate: the CLI always runs, and only its failure prints
// the road, so a credential source this file does not know about can never block a deploy.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FUNCTIONS = '{{functionsProject}}';

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
};

/** How this repo invokes Nx — so every command printed here can be pasted as it is. */
function nx() {
  if (existsSync(join(ROOT, 'nx')) && !existsSync(join(ROOT, 'package.json'))) return './nx';
  if (existsSync(join(ROOT, 'yarn.lock'))) return 'yarn nx';
  if (existsSync(join(ROOT, 'pnpm-lock.yaml'))) return 'pnpm nx';
  if (existsSync(join(ROOT, 'bun.lockb')) || existsSync(join(ROOT, 'bun.lock'))) return 'bunx nx';
  return 'npx nx';
}

/** The Firebase project the arguments name (`-P x`, `--project x`, `--project=x`), if any. */
function projectArg(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--project=')) return arg.slice('--project='.length);
    if ((arg === '-P' || arg === '--project') && args[i + 1]) return args[i + 1];
  }
  return undefined;
}

/**
 * What this machine has — local facts only (no network, no CLI call), each one a step of the road, read where the
 * Firebase CLI itself reads them (firebase-tools 15: lib/command.js, lib/requireAuth.js, google-auth-library):
 *   credentials  a `firebase login` (configstore — `$XDG_CONFIG_HOME`, else ~/.config — `configstore/firebase-tools.json`),
 *                FIREBASE_TOKEN, a credential file in GOOGLE_APPLICATION_CREDENTIALS (what CI's auth step exports), or
 *                gcloud's application-default login — which the CLI reads ONLY at $HOME/.config/gcloud (not from
 *                `CLOUDSDK_CONFIG`, where gcloud may have written it: that one is named, as not seen by Firebase);
 *   project      `-P` / `--project`, else the ACTIVE project `firebase use` set for this directory (configstore
 *                `activeProjects`, nearest enclosing directory), else the only alias in .firebaserc, else its
 *                `default` — the CLI's own order.
 */
export function readiness(args = []) {
  const config = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  const store = readJson(join(config, 'configstore', 'firebase-tools.json'));
  const login = store?.user && store?.tokens?.refresh_token ? store.user.email || 'a Firebase login' : undefined;
  const home = process.env.HOME || homedir();
  const adc = existsSync(join(home, '.config', 'gcloud', 'application_default_credentials.json'));
  const credentials =
    (process.env.FIREBASE_TOKEN && 'FIREBASE_TOKEN') ||
    login ||
    (process.env.GOOGLE_APPLICATION_CREDENTIALS && 'GOOGLE_APPLICATION_CREDENTIALS') ||
    (adc ? 'gcloud application-default login' : undefined);
  // gcloud honours CLOUDSDK_CONFIG; the Firebase CLI does not — an ADC login there is invisible to a deploy.
  const sdk = process.env.CLOUDSDK_CONFIG;
  const strandedAdc = !adc && sdk && existsSync(join(sdk, 'application_default_credentials.json')) ? join(sdk, 'application_default_credentials.json') : undefined;

  const rc = readJson(join(ROOT, '.firebaserc'));
  const aliases = Object.keys(rc?.projects ?? {});
  const named = projectArg(args);
  const project = named ?? activeProject(store) ?? (aliases.length === 1 ? aliases[0] : undefined) ?? (rc?.projects?.default ? 'default' : undefined);

  const ci = readJson(join(ROOT, '.bespunky', 'ci.json'));
  const workflow = existsSync(join(ROOT, '.github', 'workflows', 'deploy.yml')) && Array.isArray(ci?.files) && ci.files.includes('.github/workflows/deploy.yml');
  const environments = Object.keys(ci?.cloud?.firebase ?? {});
  return { credentials, strandedAdc, aliases, project, named, ci: ci ? { workflow, pending: ci.pending, environments } : undefined };
}

/** The project `firebase use` made active for this directory — the nearest enclosing directory's, as the CLI looks it up. */
function activeProject(store) {
  const active = store?.activeProjects ?? {};
  for (let dir = ROOT; ; dir = dirname(dir)) {
    if (active[dir]) return active[dir];
    if (dirname(dir) === dir) return undefined;
  }
}

/** The road to a first deploy, as lines: each step ticked from `state`, with how to tell it worked. */
export function road(state) {
  const NX = nx();
  const mark = (done) => (done ? '✓' : '·');
  const envs = state.ci?.environments.length ? state.ci.environments.join(' | ') : '<environment>';
  const lines = [
    'The road to a first deploy (✓ = this machine already has it):',
    '',
    `  ${mark(state.credentials)} 1. Log in — a human, in a terminal (it opens a browser):  npx firebase login`,
    `       Worked when: \`npx firebase login:list\` names your account.${state.credentials ? `  Here: ${state.credentials}.` : ''}`,
    ...(state.strandedAdc
      ? [`       (gcloud's application-default login is at ${state.strandedAdc} — CLOUDSDK_CONFIG — where the Firebase CLI never looks.)`]
      : []),
    '       (Logins live in ~/.config, which the devcontainer keeps across rebuilds — once per project is enough.)',
    `  ${mark(state.aliases.length)} 2. Pick the Firebase project:  npx firebase use --add`,
    '       It lists your account\'s projects; choose one and give it an ALIAS (`prod`, `staging`, …). It writes',
    '       .firebaserc — commit it. No project yet? Create one first (console, or `npx firebase projects:create <id>`).',
    `       Worked when: .firebaserc lists the alias and \`npx firebase use\` prints it.${state.aliases.length ? `  Here: ${state.aliases.join(', ')}${state.project ? ` (in use: ${state.project})` : ''}.` : ''}`,
    `    3. Deploy by hand — every deploy target takes the alias:`,
    `         ${NX} run ${FUNCTIONS}:deploy -P <alias>     builds and lints ${FUNCTIONS}, then \`firebase deploy --only functions\``,
    `         ${NX} run firebase:deploy -P <alias>      the Firestore / Storage rules and indexes firebase.json declares`,
    `         ${NX} run-many -t deploy --project=<alias>  both   (\`nx run\` takes --project itself, so use -P there)`,
    '       Worked when: the Firebase CLI ends with "Deploy complete!" and a console link;',
    '       `npx firebase functions:list -P <alias>` lists what is live.',
    '',
    '  Then hand deploys to CI (optional — every push to a bound branch deploys what it changed):',
    `  ${mark(state.ci?.workflow)} 4. Add the ci layer:  /bespunky-house:add-layer ci   (in Claude Code)`,
    '       It needs a branch model with a `ci` binding — the line that deploys, and the GitHub environment it',
    '       deploys in (the bespunky-workflow:branch-and-release skill sets one).',
    `       Worked when: .github/workflows/deploy.yml exists.${state.ci && !state.ci.workflow && state.ci.pending ? `  Here, pending: ${state.ci.pending}` : ''}`,
    '    5. Grant CI its keyless identity — a HUMAN runs it (it grants IAM; Claude never does). First, in a terminal,',
    '       log gcloud in as an account that may grant IAM in the project:  gcloud auth login',
    '       Then, in Claude Code with `!` (or any terminal):',
    `         ! bash tools/setup-gcp.sh --dry-run --environment ${envs}     every call it would make, nothing changed`,
    `         ! bash tools/setup-gcp.sh --environment ${envs}`,
    '       Worked when: it ends by printing the `gh` commands for step 6.',
    '    6. Run the `gh` lines step 5 printed — the GitHub environment\'s protection and its two variables (not secrets) —',
    '       and commit the record it wrote (.bespunky/gcp/<environment>.tsv).',
    `       Worked when: \`gh variable list --env ${envs}\` shows both; then GitHub → Actions → Deploy → Run workflow`,
    '       (scope `all`) is the first CI deploy, and it goes green.',
    '',
    `Re-check any time:  node tools/firebase-deploy.mjs --check     (HOUSE.md → "Deploying the backend" has it all.)`,
  ];
  return lines;
}

/**
 * Deploy `only` (a `firebase deploy --only` value) with the project's pinned CLI and the caller's arguments. On a
 * failure, the road — so the next step is on screen, whoever ran it (a developer, Claude, or CI).
 */
export function deploy(only, args, label) {
  const say = (line) => console.log(`[${label}] ${line}`);
  // The project's pinned Firebase CLI first — Nx puts node_modules/.bin on PATH; this keeps a direct run equal.
  const env = { ...process.env, PATH: [join(ROOT, 'node_modules', '.bin'), process.env.PATH].filter(Boolean).join(delimiter) };
  const argv = ['deploy', '--only', only, ...args];
  say(`firebase ${argv.join(' ')}`);
  const result = spawnSync('firebase', argv, { cwd: ROOT, stdio: 'inherit', env });
  if (result.error) {
    console.error(`[${label}] could not run the Firebase CLI: ${result.error.message} — install the dependencies (it is this project's own firebase-tools).`);
    return 1;
  }
  if (result.status === 0) return 0;
  const state = readiness(args);
  console.error('');
  console.error(`[${label}] The deploy failed — Firebase's own message is above.`);
  if (!state.credentials) console.error(`[${label}] This machine has no Firebase login: step 1 below.`);
  else if (!state.project)
    console.error(`[${label}] No project was named, none is active here (\`firebase use\`) and .firebaserc names no single or default one: step 2 below, then pass -P <alias>.`);
  else if (state.named && state.aliases.length && !state.aliases.includes(state.named))
    console.error(`[${label}] "${state.named}" is not an alias in .firebaserc (${state.aliases.join(', ')}) — Firebase took it as a project id.`);
  else console.error(`[${label}] Login (${state.credentials}) and project (${state.project}) are set, so the cause is in Firebase's message.`);
  console.error('');
  for (const line of road(state)) console.error(line);
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === '--check') {
    for (const line of road(readiness(args.slice(1)))) process.stdout.write(`${line}\n`);
    process.exit(0);
  }
  if (args[0] !== '--only' || !args[1]) {
    console.error('usage: node tools/firebase-deploy.mjs --check | --only <targets> [firebase args…]');
    process.exit(2);
  }
  process.exit(deploy(args[1], args.slice(2), `${args[1] === 'functions' ? FUNCTIONS : 'firebase'}:deploy`));
}
