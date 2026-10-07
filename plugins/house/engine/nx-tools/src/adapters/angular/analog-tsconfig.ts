// The Analog Vitest config of an Angular LIBRARY, made to name the tsconfig it runs with.
//
// THE WARNING (E3). @nx/angular's `vitest-analog` runner — what a workspace-internal Angular library gets (navigation-
// core, and any library @nx/angular creates without a build) — has @nx/vitest write `plugins: [angular()]` into the
// library's vite config (@nx/vitest 23.3 `configuration.js:141`). Analog's plugin resolves its tsconfig in its
// `config` hook (@analogjs/vite-plugin-angular 2.8 `getTsConfigPath`): `tsconfig.spec.json` under a test run
// (`VITEST` / `NODE_ENV=test`), `tsconfig.lib.json` with `build.lib`, otherwise `tsconfig.app.json`. Nx loads the
// config OUTSIDE a test run too — to infer the project's targets for the graph — and a library has no
// tsconfig.app.json, so every graph computation prints "Unable to resolve tsconfig at …/tsconfig.app.json".
//
// THE FIX IS TO SAY WHICH FILE. The config is a TEST config (no `build` block — @nx/vitest writes it with
// `includeLib: false`), and under a test run Analog already picks tsconfig.spec.json; naming it explicitly changes
// nothing about the tests and gives the non-test load the same answer. Relative, so it resolves against the Vite
// `root` the config already sets (`import.meta.dirname` / `__dirname`, whichever the installed Nx wrote).
// The upstream fix (@nx/vitest passing the tsconfig itself) would make this a no-op: only a bare `angular()` is
// rewritten.
import type { Tree } from '@nx/devkit';

const CONFIGS = ['vite.config.mts', 'vite.config.ts', 'vitest.config.mts', 'vitest.config.ts'];
const ANALOG = '@analogjs/vite-plugin-angular';
const BARE_CALL = /\bangular\(\s*\)/;
export const SPEC_TSCONFIG_CALL = "angular({ tsconfig: './tsconfig.spec.json' })";

export type AnalogTsconfigResult =
  | { kind: 'stated'; file: string }
  | { kind: 'builds'; file: string }
  | { kind: 'none' };

/**
 * State `tsconfig.spec.json` in a library's Analog test config. `builds`: the config also builds (a `build` block),
 * where the spec tsconfig would be the wrong answer — left alone for the caller to report. Never touches an
 * application (it has the tsconfig.app.json Analog defaults to) or a config that already names its tsconfig.
 */
export function stateAnalogTsconfig(tree: Tree, root: string): AnalogTsconfigResult {
  if (!tree.exists(`${root}/tsconfig.spec.json`) || tree.exists(`${root}/tsconfig.app.json`)) return { kind: 'none' };
  for (const name of CONFIGS) {
    const file = `${root}/${name}`;
    if (!tree.exists(file)) continue;
    const text = tree.read(file, 'utf8') ?? '';
    if (!text.includes(ANALOG) || !BARE_CALL.test(text)) continue;
    if (/\bbuild\s*:/.test(text)) return { kind: 'builds', file };
    tree.write(file, text.replace(BARE_CALL, SPEC_TSCONFIG_CALL));
    return { kind: 'stated', file };
  }
  return { kind: 'none' };
}
