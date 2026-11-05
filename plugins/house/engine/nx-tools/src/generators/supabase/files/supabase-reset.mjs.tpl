// A `db reset` that runs to completion. GENERATOR-OWNED. The launcher starts this in a session of its own and waits for it.
//
// INTERRUPTING A RESET IS THE ONE REAL HAZARD OF THIS STACK: between about 0.6 s and 2.5 s in, a stop or a kill leaves it wedged, or
// worse, reporting healthy with no migrations. So nothing reaches this: no terminal's Ctrl+C, no group signal, and its caller's death
// does not end it. The per-stack lock names this process and the CLI under it, so a stop waits, even if this process is killed. And it
// is declared as the stack's DETACHED WORK (the engine's contract, lib/stacks.mjs): so `dev stop` of a stack whose claimer was killed
// waits for it, where it would otherwise signal every descendant. Only a SIGKILL of everything (a container stop) gets through, and the
// next start applies what is pending forward, or refuses and names this reset.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Refusal } from './layout.mjs';
import { cli } from './supabase-cli.mjs';
import { processStart, withStackLock } from './supabase-lock.mjs';

process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(name, () => {});

const stackDir = process.env.DEV_STACK_DIR;
/** The entry the engine reads. Best effort: a stack dir gone means nobody is left to wait. */
function declare(fields) {
  if (!stackDir) return;
  try {
    mkdirSync(join(stackDir, 'detached'), { recursive: true });
    writeFileSync(join(stackDir, 'detached/reset.json'), `${JSON.stringify({ id: 'reset', what: 'supabase db reset', doing: 'a reset, which runs to completion', ...fields })}\n`);
  } catch {
    // only the engine's wait is lost
  }
}

try {
  // The CLI, not this process: it is what must finish, and it lives on if this one is killed.
  let child;
  const result = await withStackLock(() =>
    cli(['db', 'reset'], {
      echo: true,
      onSpawn: (pid) => {
        child = { pid, procStart: processStart(String(pid)) };
        declare({ ...child, status: 'running' });
      },
    }),
  );
  if (child) declare({ ...child, status: 'exited', code: result.code, result: `the reset ended (code ${result.code})` });
  if (result.code !== 0) throw new Refusal(`supabase db reset failed:\n${(result.stderr.trim() || result.stdout.trim()).split('\n').slice(-12).join('\n')}`);
  process.exit(0);
} catch (error) {
  console.error(error instanceof Refusal ? `[postgres] ${error.message}` : error);
  process.exit(1);
}
