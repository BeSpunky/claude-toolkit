// `supabase` — the Supabase stack as this project's local database, and the CLI to reach a hosted one. Requires `postgres`, whose verbs,
// addressing and deploy gates it keeps: it registers a local server provider, it is not a second launcher.
//
// ON AN ALPHA. The stack runs on the CLI's native runtime, with no container engine (decision 9): pinned exactly, and guarded by
// `tools/test-supabase/run.mjs` against the real thing.
//
// WHAT MUST SURVIVE A REBUILD, found by running the CLI and looking. SUPABASE_HOME holds the login (`access-token`, with
// SUPABASE_NO_KEYRING, since a container has no keyring and `logout` fails without it), the artifact cache (1.7 GB) and every stack's
// data: pointed at the persisted `~/.local`, literally, because `~` and `${containerEnv:HOME}` are not expanded there, so nothing needs
// a mount. In the passwd home, whatever SUPABASE_HOME says: `~/.supabase/cli-latest`, a version check's cache, and `ports.sqlite`,
// port reservations, whose loss a start recovers from with every port kept. Nothing to keep. `supabase/.link.json` is per checkout
// and gitignored, by the CLI's own design: a worktree never borrows another tree's link.
import type { DevcontainerFragment, LayerDescriptor } from './descriptor';
import { SUPABASE_TAG } from '../generators/postgres/provider';
import { supabaseCiProvider } from '../generators/supabase/ci-provider';
import { SUPABASE_PORTS } from '../generators/supabase/dev-fragment';
import { SUPABASE_CLI_DOWNLOADS, SUPABASE_CLI_VERSION } from '../generators/_utils/versions';

/** What every stack's connection-holding process is called: it proxies every port of the stack. */
export const OWNER_PROCESS_MATCH = '__supabase_stack_host__';

const devcontainer: DevcontainerFragment = {
  // The stack's superuser password is the same well-known one everywhere, so nothing of it is forwarded on its own: a stack's ports
  // move with its offset, and what names them all is the process holding them. The base stack's API and Studio are named for a human.
  ports: [
    { port: SUPABASE_PORTS['supabase-api'], label: 'Supabase API', onAutoForward: 'ignore' },
    { port: SUPABASE_PORTS.studio, label: 'Supabase Studio', onAutoForward: 'ignore' },
  ],
  portProcesses: [{ match: OWNER_PROCESS_MATCH, label: 'Supabase (a stack)', onAutoForward: 'ignore' }],
  // The native runtime watches its processes through /bin/ps, and unpacks its artifacts with tar.
  osPackages: [{ packages: ['procps', 'tar'], why: "The Supabase CLI's native runtime needs /bin/ps and tar." }],
  archives: [
    {
      id: 'supabase',
      version: SUPABASE_CLI_VERSION,
      bin: '.',
      downloads: SUPABASE_CLI_DOWNLOADS,
      why: `The Supabase CLI ${SUPABASE_CLI_VERSION}: a standalone binary, since this repo may have no node_modules. Exactly this one: its local stack is alpha.`,
    },
  ],
  containerEnv: [
    {
      name: 'SUPABASE_HOME',
      value: '{{home}}/.local/share/supabase',
      why: "The CLI's login, cache and stacks, in the persisted ~/.local. A literal path: nothing expands a variable here.",
    },
    { name: 'SUPABASE_NO_KEYRING', value: '1', why: 'A container has no keyring: the login goes to a file under SUPABASE_HOME, and `logout` works.' },
    { name: 'DO_NOT_TRACK', value: '1', why: 'The CLI sends telemetry by default.' },
  ],
};

export const supabase: LayerDescriptor = {
  id: 'supabase',
  title: 'Supabase',
  requires: ['postgres'],
  // The tag, never `supabase/config.toml`: a repo holding that file has not chosen this layer until it says so.
  evidence: { tags: [SUPABASE_TAG] },
  ensurable: { new: true, upgrade: true },
  ensureHint: '`house.sh add-layer supabase <project>`',
  brings: 'the Supabase stack on the CLI\'s native runtime behind the same postgres:* targets, supabase/migrations, the owned keys of supabase/config.toml, and the pinned CLI in the image',
  generators: { workspace: [{ generator: 'supabase' }] },
  docSections: ['supabase'],
  ciDeploy: supabaseCiProvider,
  devcontainer,
};
