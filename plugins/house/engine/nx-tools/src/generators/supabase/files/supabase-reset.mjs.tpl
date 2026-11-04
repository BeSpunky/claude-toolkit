// A `db reset` that runs to completion. GENERATOR-OWNED. The launcher starts this in a session of its own and waits for it.
//
// INTERRUPTING A RESET IS THE ONE REAL HAZARD OF THIS STACK: between about 0.6 s and 2.5 s in, a stop or a kill leaves it wedged, or
// worse, reporting healthy with no migrations. So nothing reaches this: no terminal's Ctrl+C, no group signal, and its caller's death
// does not end it. The per-stack lock is this process's own, so a stop waits. Only a SIGKILL of everything (a container stop) gets
// through, and the ledger check after the next start is what catches that.
import { Refusal } from './layout.mjs';
import { cli } from './supabase-cli.mjs';
import { withStackLock } from './supabase-keeper.mjs';

process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(name, () => {});

try {
  const result = await withStackLock(() => cli(['db', 'reset'], { echo: true }));
  if (result.code !== 0) throw new Refusal(`supabase db reset failed:\n${(result.stderr.trim() || result.stdout.trim()).split('\n').slice(-12).join('\n')}`);
  process.exit(0);
} catch (error) {
  console.error(error instanceof Refusal ? `[postgres] ${error.message}` : error);
  process.exit(1);
}
