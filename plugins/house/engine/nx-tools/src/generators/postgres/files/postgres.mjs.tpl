// The Postgres launcher: every verb of the `postgres` project's targets. GENERATOR-OWNED (@bespunky/nx-tools:postgres);
// rewritten every upgrade. Never edit it in the project: your migrations and seeds are the project's part.
//
//   node tools/postgres/postgres.mjs start [--port-offset=<n>]     a stack of its own, in the foreground, until stopped
//   node tools/postgres/postgres.mjs migrate [--offset=<n>]        apply postgres/migrations to this tree's running server
//   node tools/postgres/postgres.mjs seed [--offset=<n>]           apply postgres/seed/world again
//   node tools/postgres/postgres.mjs reset [--offset=<n>]          drop the database, migrate, seed; boots a stack for it if none runs
//   node tools/postgres/postgres.mjs psql [--offset=<n>] [--sql=<statement>] [--file=<path>]
//   node tools/postgres/postgres.mjs new-migration --name=<lower_snake>
//   node tools/postgres/postgres.mjs deploy                        migrate the database POSTGRES_DEPLOY_URL names
//   node tools/postgres/postgres.mjs serve                         the server inside a dev stack (what dev.json's process runs)
//
// LOCAL VERBS TAKE NO URL. They compute the address from this tree's running stack, and check over the connection that the
// server there is the one that stack created. Only `deploy` reaches a URL it did not compute.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { BASE_PORT, DATABASE, DEPLOY_URL_VAR, DEV_ENGINE, LAUNCHER, NX, PORT_NAME, ROOT, ROLE, Refusal, dataHome, isLinkedWorktree } from './layout.mjs';
import { addressedStack, assertIdentity, runningStacks } from './stack.mjs';
import { applySeeds, dbmateMigrate, dropDatabase, ensureDatabase, localMigrate, newMigration, seedOnce } from './schema.mjs';
import { query, scrubbedEnv, tool } from './tools.mjs';
import { parseDeployUrl } from './url.mjs';
import { serve } from './server.mjs';

process.stdout.on('error', () => {}); // a reader that went away is not this launcher's failure
process.stderr.on('error', () => {});

/** `--name=value` flags and positionals; any other flag is refused, never ignored: a mistyped one must not mean something else. */
function parse(argv, allowed, { positionals = 0 } = {}) {
  const flags = {};
  const rest = [];
  for (const arg of argv) {
    const flag = /^--([a-z-]+)(?:=(.*))?$/s.exec(arg);
    if (flag && allowed.includes(flag[1]) && flag[2] !== undefined) flags[flag[1]] = flag[2];
    else if (arg.startsWith('-')) throw new Refusal(`${arg} is not an option here (${allowed.map((name) => `--${name}=…`).join(', ') || 'it takes none'}). A local verb takes no URL or host: it computes them from this tree's running stack.`);
    else if (rest.length < positionals) rest.push(arg);
    else throw new Refusal(`Unexpected argument: ${arg}`);
  }
  return { flags, rest };
}

function offsetOf(flags) {
  if (flags.offset !== undefined && !/^\d+$/.test(flags.offset)) throw new Refusal(`--offset is a stack's port offset, a whole number: ${flags.offset}`);
  return flags.offset;
}

async function addressed(argv, allowed = ['offset']) {
  const { flags } = parse(argv, allowed);
  const stack = addressedStack(offsetOf(flags));
  await assertIdentity(stack);
  return { stack, flags };
}

/**
 * Does Nx render this run as an agent's summary, nothing of a task until it ends? The serve executor's rule (executors/serve),
 * read from the paths because this launcher takes no Nx import. An --output-style flag is invisible from here.
 */
function silentUnderNx() {
  const { CLAUDECODE, NX_TASK_TARGET_PROJECT, NX_STREAM_OUTPUT, NX_TUI, NX_DEFAULT_OUTPUT_STYLE: style } = process.env;
  if (CLAUDECODE !== '1' || !NX_TASK_TARGET_PROJECT || NX_STREAM_OUTPUT === 'true' || NX_TUI === 'true' || (style && style !== 'summary')) return false;
  const lifeCycle = 'tasks-runner/life-cycles/summary-terminal-output-life-cycle.js';
  return ['node_modules/nx', '.nx/installation/node_modules/nx'].some((nx) => ['dist/src', 'src'].some((at) => existsSync(join(ROOT, nx, at, lifeCycle))));
}

/** A stack of its own, through the engine: it claims the port block and hands the server its lock, like any process of a serve. */
function start(argv) {
  if (process.env.DEV_STACK_DIR) {
    parse(argv, []);
    return serve();
  }
  const { flags } = parse(argv, ['port-offset']);
  if (silentUnderNx()) {
    throw new Refusal(`Under an AI agent Nx shows nothing of this while it runs (no port, no stop handle), so it would block silently until the tool call times out. Run the launcher itself, which prints both: node tools/postgres/postgres.mjs start`);
  }
  return ownStack('serve', flags['port-offset'], 'Postgres, run on its own');
}

/**
 * This launcher's `verb` as a stack of its own: the engine claims the block and hands it the lock. A linked worktree asks for
 * `auto` when nothing was said, which is a block of its own and the same one every time: the base block is the main tree's.
 */
function ownStack(verb, offset, label) {
  const spec = offset ?? (isLinkedWorktree() ? 'auto' : undefined);
  const child = spawn(process.execPath, [DEV_ENGINE, 'run', PORT_NAME, `--label=${label}`, `--ports=${PORT_NAME}=${BASE_PORT}`, ...(spec !== undefined ? [`--port-offset=${spec}`] : []), '--', process.execPath, LAUNCHER, verb], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  // A Ctrl+C reaches the whole group, the engine included: forwarding it would be a second one. A signal aimed at this process
  // alone reaches only this process, so it is passed on, as the one signal the engine reads as "aimed at me".
  process.on('SIGINT', () => {});
  for (const name of ['SIGTERM', 'SIGHUP']) process.on(name, () => child.kill('SIGTERM'));
  return new Promise((resolve) => child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0))));
}

async function migrate(argv) {
  const { stack } = await addressed(argv);
  await localMigrate(stack.port);
  console.log(`[postgres] ${stack.key} is migrated.`);
  return 0;
}

async function seed(argv) {
  const { stack } = await addressed(argv);
  const applied = await applySeeds(stack.port);
  console.log(applied ? `[postgres] applied ${applied} seed file(s) to ${stack.key}.` : '[postgres] postgres/seed/world holds no .sql files.');
  return 0;
}

async function reset(argv) {
  const { flags } = parse(argv, ['offset']);
  const offset = offsetOf(flags);
  // Nothing to address is what a failed start leaves, and the moment this verb is needed most: boot for it, then stop again.
  if (!runningStacks().some((stack) => offset === undefined || stack.offset === Number(offset))) return ownStack('serve-reset', offset, 'Postgres, resetting');
  const { stack } = await addressed(argv);
  await dropDatabase(stack.port);
  await ensureDatabase(stack.port);
  await localMigrate(stack.port);
  await seedOnce(stack.port);
  console.log(`[postgres] ${stack.key} is reset: migrated and seeded from nothing.`);
  return 0;
}

async function psql(argv) {
  const { stack, flags } = await addressed(argv, ['offset', 'sql', 'file']);
  mkdirSync(dataHome(), { recursive: true }); // where PSQL_HISTORY points, in the house's devcontainer
  // A statement to run names no startup file: a `\\connect` in one would move it off the server just checked. A session is a human's own.
  const args = ['-h', '127.0.0.1', '-p', String(stack.port), '-U', ROLE, '-d', DATABASE, ...(flags.sql !== undefined || flags.file !== undefined ? ['-X'] : []), ...(flags.sql !== undefined ? ['-v', 'ON_ERROR_STOP=1', '-c', flags.sql] : []), ...(flags.file !== undefined ? ['-v', 'ON_ERROR_STOP=1', '-f', flags.file] : [])];
  process.on('SIGINT', () => {}); // Ctrl+C cancels the query in psql, and must not end this parent
  const child = spawn(tool('psql'), args, { cwd: ROOT, env: scrubbedEnv(), stdio: 'inherit' });
  return new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
}

function createMigration(argv) {
  const { flags, rest } = parse(argv, ['name'], { positionals: 1 });
  console.log(`[postgres] created ${newMigration(flags.name ?? rest[0])}. Write the up. The down stays empty: migrations are forward-only.`);
  return 0;
}

/**
 * Nx loads these files into a task's environment, so a value in one reaches `deploy` looking like an explicit variable. Which of
 * them sets `variable`? Read by dotenv's own grammar, which takes `NAME: value` as well as `NAME=value`.
 */
function envFileSetting(variable) {
  for (const dir of [ROOT, join(ROOT, 'postgres')]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!/^\.env($|\.)|^\..*\.env$/.test(name)) continue;
      let body;
      try {
        body = readFileSync(join(dir, name), 'utf8');
      } catch {
        continue;
      }
      if (new RegExp(`^\\s*(export\\s+)?${variable}(\\s*=|:\\s)`, 'm').test(body)) return join(dir, name);
    }
  }
  return undefined;
}

async function humanConfirms(target) {
  // What runners set, and from nowhere else: the prompt is the only thing a stray `CI=false` or a project file could remove.
  if (process.env.CI === 'true' || process.env.CI === '1') return;
  if (!process.stdin.isTTY) {
    throw new Refusal(`Outside CI, a deploy asks a human, and there is no terminal to ask on. Run it yourself in a terminal, or let CI run it.`);
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(`This migrates ${target.display}. Type the database's name (${target.database}) to go on: `);
  prompt.close();
  if (answer.trim() !== target.database) throw new Refusal('Not confirmed; nothing ran.');
}

async function deploy(argv) {
  parse(argv, []);
  // First, and whatever CI says: an agent can set CI itself, and it reaches a database nobody asked it to migrate.
  if (process.env.CLAUDECODE === '1') throw new Refusal(`A deploy is not an agent's to run: a human runs it, or CI does. Hand the user this command to run in a terminal: ${DEPLOY_URL_VAR}=<direct URL> ${NX} run postgres:deploy`);
  const file = envFileSetting(DEPLOY_URL_VAR);
  if (file) throw new Refusal(`${DEPLOY_URL_VAR} is set in ${file}. A deploy's URL comes from CI or from a variable you set yourself, never from a file: remove it.`);
  const skipsThePrompt = envFileSetting('CI');
  if (skipsThePrompt) throw new Refusal(`CI is set in ${skipsThePrompt}, and it would skip a deploy's confirmation. Only the runner says it is CI: remove it.`);
  const url = process.env[DEPLOY_URL_VAR];
  if (!url) throw new Refusal(`${DEPLOY_URL_VAR} is not set. CI sets it from the environment's secret, ${DEPLOY_URL_VAR}_<ENVIRONMENT>; by hand: ${DEPLOY_URL_VAR}=<direct URL> ${NX} run postgres:deploy`);
  let target;
  try {
    target = parseDeployUrl(url);
  } catch (error) {
    throw new Refusal(`${DEPLOY_URL_VAR} is refused: ${error.message}`);
  }
  if (target.pooled) throw new Refusal(`${DEPLOY_URL_VAR} names a transaction pooler (${target.display}). Migrations need a direct connection: use the host's direct URL.`);
  console.log(`[postgres] deploying migrations to ${target.display}${target.sslmode ? ` (sslmode=${target.sslmode})` : ''}`);
  await humanConfirms(target);
  // In the environment, not on the command line: a URL with a password in argv is readable by every process on the machine.
  const hide = (text) => {
    const withoutUrl = text.split(url).join('***');
    return target.password ? withoutUrl.split(target.password).join('***') : withoutUrl;
  };
  await dbmateMigrate({ args: ['--env', 'DATABASE_URL'], env: { DATABASE_URL: url } }, { onOutput: hide });
  console.log(`[postgres] ${target.display} is migrated.`);
  return 0;
}

const VERBS = { start, serve: (argv) => (parse(argv, []), serve()), 'serve-reset': (argv) => (parse(argv, []), serve({ resetThenStop: true })), migrate, seed, reset, psql, 'new-migration': createMigration, deploy };

const [verb, ...argv] = process.argv.slice(2);
try {
  if (!VERBS[verb]) throw new Refusal(`Usage: node tools/postgres/postgres.mjs <${Object.keys(VERBS).join(' | ')}> (${verb ? `not ${verb}` : 'none given'})`);
  process.exit(await VERBS[verb](argv));
} catch (error) {
  console.error(error instanceof Refusal ? `[postgres] ${error.message}` : error);
  process.exit(1);
}
