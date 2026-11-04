// The Supabase provider's process in `.bespunky/dev.json`: the keeper, beside every served app and before it.
//
// EVERY PORT THE STACK CAN PIN, IN ONE SMALL BLOCK, so a stack shifts by one offset like any other. Never the CLI's own 54321..:
// beside an app's 4200 that span leaves no block to shift into. `tools/postgres/supabase-cli.mjs` says the same, and
// `tools/test-generators` holds the two together. The native runtime refuses a public port in 10000-19999, reserved for its backends (observed, and not in the docs), and the two
// ports it cannot pin come from 20000-32767: the block stays out of both.
//
// THE URLS hold the stack's well-known local password: local only, and the URL is the whole isolation between stacks, whose keys are
// identical. The keys themselves are not exported: `supabase status -o env` prints them.
import type { DevFragment } from '../dev/declaration';

export const SUPABASE_PORTS = {
  postgres: 5432,
  'db-shadow': 5433,
  'db-pooler': 5434,
  'supabase-api': 5435,
  studio: 5436,
  analytics: 5437,
  mail: 5438,
  'mail-smtp': 5439,
  'mail-pop3': 5440,
  'functions-inspector': 5441,
} as const;

export const SUPABASE_ALLOCATES_FROM = '10000-32767';

const URL = 'postgresql://postgres:postgres@127.0.0.1:${PORT:postgres}/postgres?sslmode=disable';

export const supabaseExports = (): Record<string, string> => ({
  DATABASE_URL: URL,
  DIRECT_DATABASE_URL: URL,
  SUPABASE_URL: 'http://127.0.0.1:${PORT:supabase-api}',
});

export function supabaseFragment(): DevFragment {
  return {
    processes: [
      {
        id: 'postgres',
        cmd: ['node', 'tools/postgres/postgres.mjs', 'serve'],
        ports: { ...SUPABASE_PORTS },
        avoidPorts: [SUPABASE_ALLOCATES_FROM],
        dependency: true,
        // A first start downloads the stack: about a minute alone, three when four trees start at once.
        ready: { cmd: 'test -f "${STACK_DIR}/postgres.ready"', timeout: 600 },
        exports: supabaseExports(),
      },
    ],
  };
}
