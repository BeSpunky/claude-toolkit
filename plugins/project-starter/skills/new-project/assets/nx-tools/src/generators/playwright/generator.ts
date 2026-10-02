// House generator: declare Playwright as a project dependency — a JS project's own browser tests.
//
// Part of the `js` layer, not `web`: it writes a devDependency into package.json, which only means something
// in a JavaScript project. The shared co-driven browser does NOT depend on it — it carries its own pinned
// runtime (tools/shared-browser/runtime.mjs) — so a Python or Go repo serves and co-drives just the same.
//
// PINNED, never `latest`: the version is the house's one Playwright number (_utils/playwright.ts), shared with
// the shared browser's runtime so both use the same Chromium revision (one download, one cache). A floating
// `latest` moved that revision under the project with no commit behind it.
//
// BASELINE ONLY: written when absent, never re-asserted over what the project declares — a dependency is
// project state, and moving an existing pin is a migration's job (0.35.0/pin-playwright moved `latest`).
//
// We deliberately do NOT install browsers here, nor generate a playwright.config.ts or an e2e project: the
// devcontainer's post-create installs Chromium, and a real e2e suite is a deliberate decision
// (`nx g @nx/playwright:configuration --project=<app>`).
import { type Tree, type GeneratorCallback, addDependenciesToPackageJson, installPackagesTask } from '@nx/devkit';
import { PLAYWRIGHT_VERSION } from '../_utils/playwright';

type PlaywrightSchema = Record<string, never>;

export default async function playwrightGenerator(tree: Tree, _options: PlaywrightSchema): Promise<GeneratorCallback> {
  const pkg = JSON.parse(tree.read('package.json', 'utf8') ?? '{}') as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  if (pkg.dependencies?.['@playwright/test'] || pkg.devDependencies?.['@playwright/test']) return () => undefined;

  addDependenciesToPackageJson(tree, {}, { '@playwright/test': PLAYWRIGHT_VERSION });
  return () => {
    installPackagesTask(tree);
  };
}
