// The local server provider, generator side: which one a workspace wears, and the one fact the core needs from it. The launcher's
// half is `tools/postgres/provider.mjs`. A hosted database is not a provider: it is a deploy target, reached by a URL only `deploy` sees.
import { type Tree, getProjects } from '@nx/devkit';

export type LocalServerProvider = 'native' | 'supabase';

/** The `supabase` layer's evidence, carried by the layer's project: the verbs stay `postgres:*`, so there is no second project. */
export const SUPABASE_TAG = 'type:supabase';

/** A CLI hard-codes `supabase/migrations`, so the folder follows the provider, and a project has exactly one. */
export const MIGRATIONS_OF: Readonly<Record<LocalServerProvider, string>> = { native: 'postgres/migrations', supabase: 'supabase/migrations' };

export const supabaseWorn = (tree: Tree): boolean => tree.exists('nx.json') && [...getProjects(tree).values()].some((project) => project.tags?.includes(SUPABASE_TAG));

/** What was asked, else what the workspace wears. */
export const providerOf = (tree: Tree, asked?: LocalServerProvider): LocalServerProvider => asked ?? (supabaseWorn(tree) ? 'supabase' : 'native');
