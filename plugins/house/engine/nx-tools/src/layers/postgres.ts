// `postgres` — a server per dev stack, forward-only migrations, seeds, and a deploy only CI or a human's own variable can aim.
//
// A CAPABILITY on the `agent` layer, not on `node`: the launcher is Node built-ins (the house tooling's Node is there in every
// container), and the server and dbmate are in the image. So a Python or Go repo wears it as well as a Node one.
//
// ENSURABLE by `new` and `add-layer`: the generator creates it from nothing.
//
// WHAT MUST SURVIVE A REBUILD: the clusters live under `~/.local/share` and psql's history beside them (PSQL_HISTORY, below),
// inside the persisted `~/.local`, so nothing here needs a mount. On an adopted image that volume is left out, so a rebuild
// loses local data and the seed world restores it. The server and dbmate are in the image and keep no state of their own.
// `~/.pgpass` and `~/.pg_service.conf` are deliberately not kept: every local verb scrubs them away, and a deploy's URL never
// lives in a file.
import type { DevcontainerFragment, LayerDescriptor, LayerId } from './descriptor';
import type { Tree } from '@nx/devkit';
import { postgresCiProvider } from '../generators/postgres/ci-provider';
import { POSTGRES_BASE_PORT, localServerFragment } from '../generators/postgres/dev-fragment';
import { POSTGRES_TAG } from '../generators/postgres/home';
import { postgresMajor } from '../generators/postgres/major';
import { supabaseWorn } from '../generators/postgres/provider';
import { POSTGRES_CLOSURES } from '../generators/_utils/postgres-closures';
import { DBMATE_DOWNLOADS, DBMATE_VERSION } from '../generators/_utils/versions';

/** A regular expression over a listening process's command line: `postgres -D <data home>/bespunky/postgres/<tree>/<stack>/<major>/data`. */
export const POSTGRES_PROCESS_MATCH = 'bespunky/postgres/.+/data';

const PSQL_HISTORY = {
  name: 'PSQL_HISTORY',
  value: '{{home}}/.local/share/bespunky/postgres/psql_history',
  why: "psql's history otherwise lands in $HOME, which a rebuild throws away.",
};

function devcontainer(tree: Tree, active?: ReadonlySet<LayerId>): DevcontainerFragment {
  // With Supabase, the stack's own Postgres is the local database (Auth, Storage and Realtime cannot use another), so a Debian
  // server and dbmate would serve nothing. A client stays: `postgres:psql` and `postgres:seed`, which the CLI has no verb for.
  if (active?.has('supabase') || supabaseWorn(tree)) {
    return {
      ports: [{ port: POSTGRES_BASE_PORT, label: 'Postgres (Supabase)', onAutoForward: 'ignore' }],
      osPackages: [{ packages: ['postgresql-client'], why: 'psql, for postgres:psql and postgres:seed. Debian\'s own: a client of another major reaches the stack\'s server all the same.' }],
      containerEnv: [PSQL_HISTORY],
    };
  }
  const major = postgresMajor(tree);
  return {
    // Never forwarded on its own: it trusts every connection on loopback, so a forward hands anything on the host's loopback a
    // superuser. A stack's port moves with its offset and shares the number space with every other port's offset, so a port range
    // would catch other services' ports too; what names every stack's server is its command line, which holds its data directory.
    ports: [{ port: POSTGRES_BASE_PORT, label: 'Postgres', onAutoForward: 'ignore' }],
    portProcesses: [{ match: POSTGRES_PROCESS_MATCH, label: 'Postgres (a shifted stack)', onAutoForward: 'ignore' }],
    archives: [
      {
        format: 'deb',
        id: 'postgres',
        bin: `usr/lib/postgresql/${major}/bin`,
        libraryPaths: ['usr/lib/*-linux-gnu'],
        // pg_config would come first on PATH and point a native module's build at headers the closure does not hold.
        prune: ['usr/share/man', 'usr/share/doc', 'usr/share/locale', `usr/lib/postgresql/${major}/bin/pg_config`],
        closures: POSTGRES_CLOSURES[major],
        why:
          `PostgreSQL ${major} and pgvector, from PGDG's durable archive, the major this project declares (.bespunky/postgres.json).\n` +
          "Debian's own 17 cannot match every production host; apt's PGDG index keeps about three versions, so a pin there expires.",
      },
      {
        format: 'binary',
        id: 'dbmate',
        version: DBMATE_VERSION,
        downloads: DBMATE_DOWNLOADS,
        why: `dbmate ${DBMATE_VERSION}, which runs postgres/migrations: a bare binary, since this repo may have no node_modules.`,
      },
    ],
    containerEnv: [PSQL_HISTORY],
  };
}

export const postgres: LayerDescriptor = {
  id: 'postgres',
  title: 'Postgres',
  requires: ['agent'],
  // The tag, never the path: a project of the repo's own at `postgres/` must not make an upgrade start wearing this layer.
  evidence: { tags: [POSTGRES_TAG] },
  ensurable: { new: true, upgrade: true },
  ensureHint: '`house.sh add-layer postgres <project>`',
  brings: 'a Postgres server per dev stack through tools/postgres, the postgres:* targets, forward-only migrations by dbmate, and the server and dbmate in the image',
  generators: {
    // The core, then the dev engine: `postgres:start` claims its stack through it, and a repo with nothing served has no
    // `web` layer to bring it. One artifact, one owner; the planner runs a step two layers share once.
    // A run about to ensure Supabase says so: the workspace does not show it yet, and this step must not seed what that one replaces.
    workspace: [{ generator: 'postgres', args: (ctx) => (ctx.active.has('supabase') ? ['--provider=supabase'] : []) }, { generator: 'dev' }],
  },
  docSections: ['postgres'],
  ciDeploy: postgresCiProvider,
  // Beside every app the dev engine serves, and before it.
  devFragment: (tree) => localServerFragment(tree),
  devcontainer,
};
