// The Postgres capability's dev fragment: this stack's server, served beside the app and before it. Reaches the dev engine
// through the layer descriptor (`postgres.devFragment`): the dev generator lists no capability by name.
//
// A DEPENDENCY, so it starts first and the rest waits. `ready` is the launcher's own marker, written after identity, migrate
// and seed: a TCP probe would turn true while migrations still run, which is the race this exists to remove. The marker lives
// in the stack's state dir, so it dies with the stack and cannot go stale.
//
// The URLs: runtime and direct are one server locally, and two names, because every pooled host makes them two in production
// and code that reads the right one locally reads the right one there. They hold no secret: the server trusts loopback and
// listens nowhere else. The password is for clients that insist on one.
//
// WHICH PROVIDER'S PROCESS: `localServerFragment`, one place. The process keeps its id and its command on both, so a served app
// does not change shape when a project chooses Supabase beyond what the generator reshapes there (generators/supabase/dev-merge.ts).
import type { Tree } from '@nx/devkit';
import type { DevFragment } from '../dev/declaration';
import { supabaseWorn } from './provider';
import { supabaseFragment } from '../supabase/dev-fragment';

export const POSTGRES_PORT_NAME = 'postgres';
/** The stack's base port (tools/postgres/layout.mjs says the same, and `tools/test-generators` holds them together). */
export const POSTGRES_BASE_PORT = 5432;
export const POSTGRES_READY_MARKER = 'postgres.ready';

const URL = `postgresql://postgres:postgres@127.0.0.1:\${PORT:${POSTGRES_PORT_NAME}}/app?sslmode=disable`;

export function postgresFragment(): DevFragment {
  return {
    processes: [
      {
        id: 'postgres',
        cmd: ['node', 'tools/postgres/postgres.mjs', 'serve'],
        ports: { [POSTGRES_PORT_NAME]: POSTGRES_BASE_PORT },
        dependency: true,
        ready: { cmd: `test -f "\${STACK_DIR}/${POSTGRES_READY_MARKER}"`, timeout: 300 },
        exports: { DATABASE_URL: URL, DIRECT_DATABASE_URL: URL },
      },
    ],
  };
}

/** The process of whichever provider this project wears. */
export const localServerFragment = (tree: Tree): DevFragment => (supabaseWorn(tree) ? supabaseFragment() : postgresFragment());
