// WHICH FILES THE FIREWALL JUDGES, AND AS WHAT — one table, read by both halves: the ESLint blocks ./firewall
// writes take their `files` from it, and the classifier (./classify) reads a project's evidence through it. A
// project's platform is about the code that reaches a RUNTIME, so a file is one of three things:
//
//   ships        the project's own runtime code — held to the project's platform, and its evidence;
//   ssr-server   the SERVER half of an SSR web app — Angular's `src/server.ts`, Analog's `src/server/**`. It runs
//                only in Node and nothing in a browser bundle imports it, so in a `platform:web` project it may
//                reach server and shared code and import server-only packages (verifying a token with
//                firebase-admin there is the correct design, not a leak). Only the web constraint is relaxed: in
//                a server or shared project the same paths are held to that project's platform as usual;
//   never-ships  tests and the tools' own configs — they run under a test runner or a build tool, never in the
//                product, so the firewall does not judge them (a spec seeding the emulator through firebase-admin,
//                a jest.config.ts reading `fs`) and they are no evidence of where the product runs.
//
// Paths are workspace-relative; the patterns are ESLint/minimatch globs, matched by the same matcher.
import { matchesAnyGlob } from '../generators/_utils/globs';
import { SOURCE_EXTENSIONS } from './imports';

const EXT = `{${SOURCE_EXTENSIONS.join(',')}}`;

/** Every file ESLint lints in an Nx flat config — the firewall's own block covers exactly these. */
export const LINTED_FILES: readonly string[] = SOURCE_EXTENSIONS.map((ext) => `**/*.${ext}`);

/** Tests: spec and test files, the runner's setup file, and the test-only folders. */
export const TEST_FILES: readonly string[] = [`**/*.{spec,test}.${EXT}`, `**/test-setup.${EXT}`, '**/{e2e,__tests__,__mocks__}/**'];

/** A tool's own config (vite, vitest, jest, eslint, playwright …) — at a project's root, never under `src/`. */
export const TOOL_CONFIG_FILES = { files: [`**/*.config.${EXT}`] as readonly string[], ignores: ['**/src/**'] as readonly string[] };

/** The server half of an SSR web app. */
export const SSR_SERVER_FILES: readonly string[] = ['**/src/server.ts', '**/src/server/**'];

export type FileScope = 'ships' | 'ssr-server' | 'never-ships';

export function scopeOf(path: string): FileScope {
  if (matchesAnyGlob(path, TEST_FILES)) return 'never-ships';
  if (matchesAnyGlob(path, TOOL_CONFIG_FILES.files) && !matchesAnyGlob(path, TOOL_CONFIG_FILES.ignores)) return 'never-ships';
  if (matchesAnyGlob(path, SSR_SERVER_FILES)) return 'ssr-server';
  return 'ships';
}
