// The Supabase CLI as this launcher runs it, and the ONE place that reads its output. GENERATOR-OWNED.
//
// ITS OUTPUT IS AN ALPHA'S. A shape that moves on a CLI bump fails here, with a sentence, and `tools/test-supabase` says so first.
// `--agent no` on every call: under an AI agent the CLI wraps a result in { advisory, boundary, rows, warning }, whose text addresses
// the agent. The shape must not depend on who is running it.
//
// THE DOORS. Precedence is flag > shell > project `.env*` > config, so a SUPABASE_* in a project's `.env` overrides config, and moves a
// stack or a target; a PG* there does the same to a URL that does not name it, a port or an sslmode, whatever a deploy printed and
// confirmed. Scrubbing the shell's does not reach those files, and running elsewhere does not either (`--workdir` is what it reads
// them from), so `assertNoEnvFileOverride` refuses them. SUPABASE_HOME is a
// literal path computed here, never read from anywhere: an unexpanded `~` would make a directory of that name in the tree.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { ROOT, Refusal } from './layout.mjs';
import { holdFor } from './supabase-lock.mjs';
import { scrubbedEnv, tool } from './tools.mjs';

export const PINNED_VERSION = '{{SUPABASE_CLI_VERSION}}';
export const SUPABASE_DIR = join(ROOT, 'supabase');
export const MIGRATIONS = join(SUPABASE_DIR, 'migrations');
export const CONFIG = join(SUPABASE_DIR, 'config.toml');
/** The native runtime refuses a public port in 10000-19999, its backends', and allocates the two it does not let anyone pin (pgmeta, the realtime RPC) from 20000-32767. */
export const ALLOCATES_FROM = '10000-32767';

/** Every port the stack can pin: the name in dev.json and `dev run`, its base, and what pins it. */
const PINS = {
  postgres: [5432, 'SUPABASE_DB_PORT'],
  'db-shadow': [5433, 'SUPABASE_DB_SHADOW_PORT'],
  'db-pooler': [5434, 'SUPABASE_DB_POOLER_PORT'],
  'supabase-api': [5435, 'SUPABASE_API_PORT'],
  studio: [5436, 'SUPABASE_STUDIO_PORT'],
  analytics: [5437, 'SUPABASE_ANALYTICS_PORT'],
  mail: [5438, 'SUPABASE_LOCAL_SMTP_PORT'],
  'mail-smtp': [5439, 'SUPABASE_LOCAL_SMTP_SMTP_PORT'],
  'mail-pop3': [5440, 'SUPABASE_LOCAL_SMTP_POP3_PORT'],
  'functions-inspector': [5441, 'SUPABASE_EDGE_RUNTIME_INSPECTOR_PORT'],
};
export const PORTS = Object.fromEntries(Object.entries(PINS).map(([name, [port]]) => [name, port]));

/** A reported endpoint, as the port it answers on. Not every port has one until its service runs: the shadow only during a diff. */
const ENDPOINT_PORT = {
  'database.sql': 'postgres',
  'rest.http': 'supabase-api',
  'studio.http': 'studio',
  'analytics.http': 'analytics',
  'mail.http': 'mail',
  'mail.smtp': 'mail-smtp',
  'mail.pop3': 'mail-pop3',
  'functions.inspector': 'functions-inspector',
};

const envName = (port) => `PORT_${port.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

export const supabaseHome = () => join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'supabase');

const cliEnv = (pins = {}, extra = {}) => ({ ...scrubbedEnv(extra), SUPABASE_HOME: supabaseHome(), SUPABASE_NO_KEYRING: '1', DO_NOT_TRACK: '1', ...pins });

/**
 * Run the CLI to its end, in its own session: a Ctrl+C for the group must not reach a `start` or a `db reset` halfway, which is what
 * wedges a stack. Output captured; `echo` also passes stderr on as it comes, since a first start downloads for a minute. Never
 * rejects on an exit code.
 */
export function cli(args, { pins, env, echo = false, input, onSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const argv = [tool('supabase'), ...args, '--workdir', ROOT, '--agent', 'no'];
    // With input, through `cat`: Node's child stdin is a socket, and the CLI cannot open /dev/stdin on one ("PermissionDenied").
    const [command, ...rest] = input === undefined ? argv : ['/bin/sh', '-c', 'cat | "$@"', 'sh', ...argv];
    const child = spawn(command, rest, { cwd: ROOT, env: cliEnv(pins, env), detached: true, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    if (input !== undefined) child.stdin.end(input);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (echo) process.stderr.write(chunk);
    });
    if (child.pid) {
      holdFor(child.pid);
      onSpawn?.(child.pid);
      current = child.pid;
    }
    child.on('error', reject);
    child.on('close', (code) => {
      current = undefined;
      resolve({ code, stdout, stderr });
    });
  });
}

/** This process's CLI call underway. A reset is never one: it runs in supabase-reset.mjs, a process of its own, which nothing here reaches. */
let current;

/** End the CLI call underway, its whole session: what a download or a stalled start needs, and what nothing else may do. */
export function endCliCall() {
  const pid = current;
  if (!pid) return false;
  const signal = (name) => {
    try {
      process.kill(-pid, name);
    } catch {
      // gone
    }
  };
  signal('SIGTERM');
  setTimeout(() => signal('SIGKILL'), 5000).unref();
  return true;
}

/** The artifacts this CLI needs, for a first start: a download (1.7 GB), with nothing started or created. At once when they are there. */
export function installArtifacts() {
  return cli(['stack', 'install', '--runtime', 'native', '--output-format', 'json'], { echo: true });
}

const said = ({ stderr, stdout }) => (stderr.trim() || stdout.trim()).split('\n').slice(-12).join('\n');

function parsed({ stdout }, what) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Refusal(`supabase ${what} did not print JSON, which CLI ${PINNED_VERSION} does: ${stdout.slice(0, 300)}`);
  }
}

/** Throws a sentence naming `what`. */
async function jsonOf(args, what, options) {
  const result = await cli([...args, '--output-format', 'json'], options);
  if (result.code !== 0) throw new Refusal(`supabase ${what} failed: ${said(result)}`);
  return parsed(result, what);
}

export function assertPinnedVersion() {
  const version = spawnSync(tool('supabase'), ['--version'], { env: cliEnv(), encoding: 'utf8' }).stdout?.trim();
  if (version !== PINNED_VERSION) throw new Refusal(`The Supabase CLI on PATH is ${version || 'unreadable'}, and this project runs ${PINNED_VERSION}: its local stack is alpha, so exactly that one. Rebuild the devcontainer (.devcontainer/house.packages.sh on an image of your own).`);
}

/**
 * The env files this CLI reads, from `supabase/` then the root, as its source has them with SUPABASE_ENV at its default, which is the
 * only one here: the launcher scrubs that from the shell. `.env.example` and its like it never opens. generators/supabase/env-doors.ts
 * reports the same, at the moment a project adds the layer; tools/test-generators holds the two together.
 */
const ENV_FILES = ['.env.development.local', '.env.local', '.env.development', '.env'];
const ENV_DOOR = /^\s*(?:export\s+)?(SUPABASE_\w+|PG[A-Z]+)\s*(?:=|:\s)/m;

/** What the CLI would read in place of config, or of what a deploy's URL leaves unsaid: a SUPABASE_* or PG* assignment in a file it opens. */
export function assertNoEnvFileOverride() {
  for (const dir of [SUPABASE_DIR, ROOT]) {
    for (const name of ENV_FILES) {
      let body;
      try {
        body = readFileSync(join(dir, name), 'utf8');
      } catch {
        continue;
      }
      const found = ENV_DOOR.exec(body)?.[1];
      if (found) {
        throw new Refusal(`${relative(ROOT, join(dir, name))} sets ${found}. The CLI lets a project's env file override config.toml and what a URL leaves unsaid, so a value there can move this stack, a command's target or how a deploy connects. Refusing. Rename it: config.toml's env() takes any name.`);
      }
    }
  }
}

/** A migration's file name, by the CLI's own pattern. Any other it skips, with a message and an exit of 0. */
const MIGRATION_NAME = /^\d+_.*\.sql$/;
export const hasMigrations = () => existsSync(MIGRATIONS) && readdirSync(MIGRATIONS).some((name) => MIGRATION_NAME.test(name));

/** What the CLI does not guard, on every road that runs a migration: a file it would skip in silence, and a non-empty down, which runs AS PART of the migration. */
export function checkMigrations() {
  if (!existsSync(MIGRATIONS)) return;
  for (const name of readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql'))) {
    const where = `supabase/migrations/${name}`;
    if (!MIGRATION_NAME.test(name)) throw new Refusal(`${where}: the CLI runs only <digits>_<name>.sql, and would skip this one without failing.`);
    const body = readFileSync(join(MIGRATIONS, name), 'utf8');
    const down = /^-- migrate:down\b.*$/m.exec(body);
    if (down && body.slice(down.index + down[0].length).trim()) throw new Refusal(`${where}: migrations are forward-only, and the CLI would run what follows \`-- migrate:down\` as part of this migration, reporting no error. To undo a migration, write the next one.`);
  }
}

/** The ports this stack was given, from the engine's PORT_<NAME>. A served app's dev.json must declare them all. */
export function requestedPorts() {
  const missing = Object.keys(PINS).filter((name) => !process.env[envName(name)]);
  if (missing.length) throw new Refusal(`This stack declares no port for ${missing.join(', ')}. The keeper pins every port, or the CLI moves the rest somewhere nothing claimed: run the house upgrade, which declares them in .bespunky/dev.json.`);
  return Object.fromEntries(Object.keys(PINS).map((name) => [name, Number(process.env[envName(name)])]));
}

const pinsOf = (ports) => Object.fromEntries(Object.entries(ports).map(([name, port]) => [PINS[name][1], String(port)]));

/** A stack URL, validated: an empty port silently means 5432 elsewhere in the CLI. */
export function loopbackPort(url, what) {
  let parts;
  try {
    parts = new URL(url);
  } catch {
    throw new Refusal(`${what} is not a URL: ${url}`);
  }
  if (parts.hostname !== '127.0.0.1' || !/^\d+$/.test(parts.port)) throw new Refusal(`${what} is not a loopback URL with an explicit port: ${parts.hostname}:${parts.port}`);
  return Number(parts.port);
}

/** A `start`'s outcome: `{ code, text }` when it failed, else `{ id, runtime, ports, env }`. Pins go ONLY here: every other command finds the stack itself. */
export async function startStack(ports) {
  const result = await cli(['start', '--runtime', 'native', '--output-format', 'json'], { pins: pinsOf(ports), echo: true });
  if (result.code !== 0) return { code: result.code, text: `${result.stderr}\n${result.stdout}` };
  const out = parsed(result, 'start');
  const reported = {};
  for (const [endpoint, name] of Object.entries(ENDPOINT_PORT)) {
    if (out.endpoints?.[endpoint]?.port) reported[name] = out.endpoints[endpoint].port;
  }
  if (!reported.postgres) throw new Refusal(`supabase start reported no database endpoint: ${result.stdout.slice(0, 300)}`);
  if (loopbackPort(out.env?.DB_URL ?? '', 'start\'s DB_URL') !== reported.postgres) throw new Refusal('supabase start reports two ports for the database: its endpoint and its DB_URL disagree.');
  return { id: out.id, runtime: out.runtime, ports: reported, mcpUrl: out.env?.MCP_URL, apiUrl: out.env?.API_URL };
}

/** Names of the ports that came back other than asked. */
export const portGap = (requested, reported) => Object.keys(reported).filter((name) => reported[name] !== requested[name]).map((name) => `${name} ${reported[name]} (asked ${requested[name]})`);

export async function stopStack() {
  const result = await cli(['stop', '--output-format', 'json']);
  if (result.code !== 0) throw new Refusal(`supabase stop failed: ${said(result)}`);
}

export async function destroyStack() {
  const result = await cli(['stack', 'destroy', '--yes']);
  if (result.code !== 0) throw new Refusal(`supabase stack destroy failed: ${said(result)}`);
}

/** Never proof of the database's health: `status` says healthy with a half-built database, and with its shared memory gone. */
export async function stackStatus() {
  const out = await jsonOf(['status'], 'status');
  return { id: out.identity?.id, owner: out.owner, lifecycle: out.lifecycle, dbPort: out.env?.DB_URL ? loopbackPort(out.env.DB_URL, 'status\'s DB_URL') : undefined };
}

/** `{ id, root }` of every stack on this machine's SUPABASE_HOME. */
export async function allStacks() {
  const out = await jsonOf(['stack', 'list'], 'stack list');
  return (out.stacks ?? []).map(({ id, project_root: root }) => ({ id, root }));
}

/** Rows, each query on a connection of its own. */
export async function dbQuery(sql) {
  const rows = await jsonOf(['db', 'query', sql], `db query \`${sql}\``);
  if (!Array.isArray(rows)) throw new Refusal(`supabase db query did not return rows, as CLI ${PINNED_VERSION} does: ${JSON.stringify(rows).slice(0, 200)}`);
  return rows;
}

/**
 * Is this stack's owner running? `status` has no pid and a CLI per poll costs 135 MB, so this reads the CLI's internal `owner.json`:
 * the one such read, and `tools/test-supabase` checks it. The name in the process table is what tells a pid from a reused one.
 */
export function ownerRunning(id) {
  try {
    const { pid } = JSON.parse(readFileSync(join(supabaseHome(), 'stacks', id, 'owner.json'), 'utf8'));
    return readFileSync(`/proc/${pid}/cmdline`, 'latin1').includes('__supabase_stack_host__');
  } catch {
    return false;
  }
}

/** The types of the running stack, as the CLI prints them: stdout alone, its notes go to stderr. Throws rather than return half a file. */
export async function genTypes({ lang, schema }) {
  const result = await cli(['gen', 'types', '--lang', lang, ...(schema ? ['--schema', schema] : [])]);
  if (result.code !== 0 || !result.stdout.trim()) throw new Refusal(`supabase gen types failed: ${said(result)}`);
  return result.stdout;
}

/** The names `[db.vault]` holds. `db push` writes these into the hosted vault before it migrates, resolved from the environment here. */
export function vaultSecrets() {
  const lines = readFileSync(CONFIG, 'utf8').split('\n');
  const start = lines.findIndex((line) => /^\s*\[db\.vault\]/.test(line));
  if (start < 0) return [];
  const names = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[/.test(line)) break;
    const name = /^\s*"?([\w.-]+)"?\s*=/.exec(line)?.[1];
    if (name) names.push(name);
  }
  return names;
}

/** Does `[db.migrations] enabled = false` say this stack keeps no ledger? A line-level read. */
export function migrationsEnabled() {
  const lines = readFileSync(CONFIG, 'utf8').split('\n');
  const start = lines.findIndex((line) => /^\s*\[db\.migrations\]/.test(line));
  if (start < 0) return true;
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[/.test(line)) return true;
    if (/^\s*enabled\s*=\s*false\b/.test(line)) return false;
  }
  return true;
}

/** The `[db.seed] sql_paths` patterns of config.toml, in order, as a line-level read. */
export function seedPatterns() {
  const lines = readFileSync(CONFIG, 'utf8').split('\n');
  const start = lines.findIndex((line) => /^\s*\[db\.seed\]/.test(line));
  if (start < 0) return [];
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[/.test(line) && !body.length && !/^\s*\["/.test(line)) break;
    if (body.length || /^\s*sql_paths\s*=/.test(line)) body.push(line.replace(/^\s*sql_paths\s*=/, ''));
    if (body.length && body.join('').includes(']')) break;
  }
  return [...body.join('').matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((match) => match[1] ?? match[2]);
}
