// The Supabase CLI as this launcher runs it, and the ONE place that reads its output. GENERATOR-OWNED.
//
// ITS OUTPUT IS AN ALPHA'S. A shape that moves on a CLI bump fails here, with a sentence, and `tools/test-supabase` says so first.
// `--agent no` on every call: under an AI agent the CLI wraps a result in { advisory, boundary, rows, warning }, whose text addresses
// the agent. The shape must not depend on who is running it.
//
// THE DOORS. Precedence is flag > shell > project `.env*` > config, so a SUPABASE_* in a project's `.env` overrides config, and moves a
// stack or a target. Scrubbing the shell's does not reach those files, so `assertNoEnvFileOverride` refuses them. SUPABASE_HOME is a
// literal path computed here, never read from anywhere: an unexpanded `~` would make a directory of that name in the tree.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { ROOT, Refusal } from './layout.mjs';
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
export function cli(args, { pins, env, echo = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(tool('supabase'), [...args, '--workdir', ROOT, '--agent', 'no'], { cwd: ROOT, env: cliEnv(pins, env), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (echo) process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
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

/** What the CLI would read in place of config: any SUPABASE_* assignment in a project env file. */
export function assertNoEnvFileOverride() {
  for (const dir of [ROOT, SUPABASE_DIR]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!/^\.env($|\.)/.test(name)) continue;
      let body;
      try {
        body = readFileSync(join(dir, name), 'utf8');
      } catch {
        continue;
      }
      const found = /^\s*(?:export\s+)?(SUPABASE_\w+)\s*(?:=|:\s)/m.exec(body)?.[1];
      if (found) {
        throw new Refusal(`${relative(ROOT, join(dir, name))} sets ${found}. The CLI lets a project's env file override config.toml, so a value there can move this stack, or a command's target. Refusing. Rename it: config.toml's env() takes any name.`);
      }
    }
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
