// A project's env file that every verb will refuse, told at the moment the layer arrives instead of at its first start. The launcher's
// `assertNoEnvFileOverride` is the refusal: this is the same list, and tools/test-generators holds the two together.
import type { Tree } from '@nx/devkit';

export const CLI_ENV_FILES = ['.env.development.local', '.env.local', '.env.development', '.env'] as const;
const DOOR = /^\s*(?:export\s+)?(SUPABASE_\w+|PG[A-Z]+)\s*(?:=|:\s)/m;

export function envFilesRefused(tree: Tree): { file: string; name: string }[] {
  return ['supabase', '.'].flatMap((dir) =>
    CLI_ENV_FILES.flatMap((name) => {
      const file = dir === '.' ? name : `${dir}/${name}`;
      const found = tree.exists(file) ? DOOR.exec(tree.read(file, 'utf8') ?? '')?.[1] : undefined;
      return found ? [{ file, name: found }] : [];
    }),
  );
}
