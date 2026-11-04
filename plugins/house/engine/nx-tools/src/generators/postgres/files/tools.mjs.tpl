// Running the tools: what every child of the launcher is handed, and how it is run. GENERATOR-OWNED.
//
// THE ENVIRONMENT IS SCRUBBED FOR EVERY CHILD. libpq honours PGHOST, PGSERVICE and friends, and dbmate honours DBMATE_* even
// beside a URL: a variable left over in a shell, or one Nx loaded from a `.env`, could otherwise move a local verb to another
// server, past everything else this launcher checks.
import { spawn } from 'node:child_process';
import { accessSync, constants, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { Refusal, DATABASE, ROLE } from './layout.mjs';

const SCRUBBED = /^(PG[A-Z]|DBMATE_)|^(DATABASE_URL|DIRECT_DATABASE_URL|POSTGRES_DEPLOY_URL)$/;

export function scrubbedEnv(extra = {}) {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !SCRUBBED.test(name))), ...extra };
}

/**
 * A tool's path. They come with the image (`postgres` and `dbmate`), or in CI with the deploy job's own checked step.
 * NEVER FROM node_modules/.bin, which Nx puts first on PATH: an npm package with a `dbmate` bin is not the pinned tool, and
 * would be handed the deploy's URL.
 */
export function tool(name) {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (/[\\/]node_modules[\\/]\.bin[\\/]?$/.test(dir)) continue;
    const path = join(dir, name);
    try {
      accessSync(path, constants.X_OK);
      return path;
    } catch {
      // the next one
    }
  }
  throw new Refusal(
    process.env.CI
      ? `${name} is not on PATH. The house's deploy workflow installs it in a checked step of its own; a pipeline of your own must install the version pinned in .devcontainer/house.packages.sh.`
      : `${name} is not on PATH. It comes with the postgres layer's image: rebuild the devcontainer (.devcontainer/house.packages.sh on an image of your own).`,
  );
}

/** Run a tool to its end, with its output captured unless `inherit`. Never rejects on an exit code: the caller reads it. */
export function run(name, args, { cwd, env = scrubbedEnv(), input, inherit = false, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(tool(name), args, { cwd, env, signal, killSignal: 'SIGTERM', stdio: [input === undefined ? (inherit ? 'inherit' : 'ignore') : 'pipe', inherit ? 'inherit' : 'pipe', inherit ? 'inherit' : 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    if (input !== undefined) child.stdin.end(input);
    child.on('error', (error) => (error.name === 'AbortError' ? resolve({ code: null, stdout, stderr, aborted: true }) : reject(error)));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** psql as a tool: no startup file, stops at the first error, talks over TCP to the address it was given and nowhere else. */
export const psqlArgs = (port, database = DATABASE) => ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-h', '127.0.0.1', '-p', String(port), '-U', ROLE, '-d', database];

export async function query(port, sql, { database, signal } = {}) {
  const result = await run('psql', [...psqlArgs(port, database), '-c', sql], { signal });
  if (result.code !== 0) throw new Refusal(`psql could not run \`${sql}\` on port ${port}: ${result.stderr.trim() || `exit ${result.code}`}`);
  return result.stdout.trim();
}

/** A scratch directory outside the tree, holding an empty file: dbmate's cwd and its `--env-file`. */
export function withEmptyEnvFile(body) {
  const dir = mkdtempSync(join(tmpdir(), 'bespunky-postgres-'));
  const file = join(dir, 'empty.env');
  writeFileSync(file, '');
  return Promise.resolve(body(dir, file)).finally(() => rmSync(dir, { recursive: true, force: true }));
}
