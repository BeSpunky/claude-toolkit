// 0.50.0 — an Angular library's Analog test config names its tsconfig, ending the "tsconfig.app.json" warning.
//
// WHAT CHANGED. A workspace-internal Angular library (navigation-core; any library @nx/angular made without a build)
// tests through Analog, and @nx/vitest wrote its plugin bare: `angular()`. Analog resolves a tsconfig the moment the
// config is LOADED, and Nx loads it outside test runs too (to infer the graph) — where Analog's default is
// `tsconfig.app.json`, which a library never has. Every graph computation printed "Unable to resolve tsconfig at
// …/tsconfig.app.json" (adapters/angular/analog-tsconfig has the upstream trace). From 0.50.0 the house's libraries
// are created with `angular({ tsconfig: './tsconfig.spec.json' })`, the file Analog already uses under a test run.
//
// WHAT IT DOES. The same one-call rewrite for every existing LIBRARY whose vite/vitest config carries the bare
// Analog call — the house's own and the ones made with @nx/angular directly alike, because the warning and the fix
// are identical and the rewrite changes nothing a test run sees. Each rewritten file is named. Never touched: an
// application (its tsconfig.app.json IS the right default), a config that already names a tsconfig, and a config
// that also BUILDS (a `build` block — the spec tsconfig would be wrong there), which is reported instead.
import { type Tree, getProjects, logger } from '@nx/devkit';
import { SPEC_TSCONFIG_CALL, stateAnalogTsconfig } from '../../adapters/angular/analog-tsconfig';

const WHO = '0.50.0/state-analog-spec-tsconfig';

export default async function stateAnalogSpecTsconfig(tree: Tree): Promise<void> {
  if (!tree.exists('nx.json')) return;
  let projects;
  try {
    projects = getProjects(tree);
  } catch {
    return;
  }
  for (const [name, project] of projects) {
    const result = stateAnalogTsconfig(tree, project.root.replace(/\/+$/, '') || '.');
    if (result.kind === 'stated') {
      logger.info(`[${WHO}] ${result.file} (${name}): \`angular()\` → \`${SPEC_TSCONFIG_CALL}\` — no more "Unable to resolve tsconfig at …/tsconfig.app.json" outside test runs.`);
    } else if (result.kind === 'builds') {
      logger.warn(
        `[${WHO}] ${result.file} (${name}) calls Analog's \`angular()\` without a tsconfig and also builds, so it was left alone: ` +
          `pass the tsconfig each use needs (e.g. \`angular({ tsconfig: process.env.VITEST ? './tsconfig.spec.json' : './tsconfig.lib.json' })\`).`,
      );
    }
  }
}
