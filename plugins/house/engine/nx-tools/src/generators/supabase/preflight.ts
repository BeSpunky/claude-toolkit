// The generators' half of `refusals.ts`, on a Tree. Both steps of the layer call it: `postgres --provider=supabase` runs first, as a
// separate `nx g` whose writes are final, so a refusal only in the second would leave a project half switched.
import type { Tree } from '@nx/devkit';
import { POSTGRES_DECLARATION } from '../postgres/major';
import { MIGRATIONS_OF } from '../postgres/provider';
import { SUPABASE_CLI_VERSION, SUPABASE_MAJORS } from '../_utils/versions';
import { type MoveFacts, whatCannotMove } from './refusals';
import { configFacts } from './toml-lines';

const SUPABASE_CONFIG = 'supabase/config.toml';

const filesIn = (tree: Tree, dir: string): string[] => (tree.exists(dir) ? tree.children(dir).filter((name) => tree.isFile(`${dir}/${name}`)) : []);

function declaration(tree: Tree): MoveFacts['declaration'] {
  if (!tree.exists(POSTGRES_DECLARATION)) return { state: 'absent' };
  try {
    return { state: 'read', major: (JSON.parse(tree.read(POSTGRES_DECLARATION, 'utf8') ?? '{}') as { major?: unknown }).major };
  } catch {
    return { state: 'broken' };
  }
}

export function refuseWhatCannotMove(tree: Tree): void {
  const [first] = whatCannotMove({
    declaration: declaration(tree),
    config: tree.exists(SUPABASE_CONFIG) ? configFacts(tree.read(SUPABASE_CONFIG, 'utf8') ?? '') : undefined,
    native: filesIn(tree, MIGRATIONS_OF.native),
    supabase: filesIn(tree, MIGRATIONS_OF.supabase),
    majors: SUPABASE_MAJORS,
    cliVersion: SUPABASE_CLI_VERSION,
  });
  if (first) throw new Error(`[supabase] ${first.text} Nothing was written.`);
}
