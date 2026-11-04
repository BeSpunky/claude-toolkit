// The Postgres major: a per-project declared fact (`.bespunky/postgres.json`), because local must match the production host.
// Seeded once by the generator. An upgrade never moves it; the project does, and restarts: data is kept per major.
import type { Tree } from '@nx/devkit';
import { POSTGRES_DEFAULT_MAJOR, POSTGRES_MAJORS } from '../_utils/versions';

export const POSTGRES_DECLARATION = '.bespunky/postgres.json';

export type PostgresMajor = (typeof POSTGRES_MAJORS)[number];

/** What the project declares; the default before the file exists (a first run composes the image before the generator seeds it). */
export function postgresMajor(tree: Tree): PostgresMajor {
  if (!tree.exists(POSTGRES_DECLARATION)) return POSTGRES_DEFAULT_MAJOR as PostgresMajor;
  let major: unknown;
  try {
    major = (JSON.parse(tree.read(POSTGRES_DECLARATION, 'utf8') ?? '{}') as { major?: unknown }).major;
  } catch (error) {
    throw new Error(`[postgres] ${POSTGRES_DECLARATION} is not valid JSON (${error instanceof Error ? error.message : String(error)}). It should say { "major": ${POSTGRES_DEFAULT_MAJOR} }.`);
  }
  const known = POSTGRES_MAJORS.find((candidate) => candidate === String(major));
  if (!known) throw new Error(`[postgres] ${POSTGRES_DECLARATION} declares major ${JSON.stringify(major)}, and this toolkit has packages for ${POSTGRES_MAJORS.join(', ')}.`);
  return known;
}
