// House generator: declare Playwright as a project dependency so the
// devcontainer's post-create.sh picks up the cue and installs Chromium + apt
// deps on container build.
//
// We deliberately do NOT install browsers at generator time. The browser binary
// lives in /home/node/.cache/ms-playwright, which is mounted as a per-workspace
// Docker volume by the devcontainer generator — installation belongs to the
// container's post-create lifecycle, so the cache survives rebuilds and isn't
// re-downloaded on every generator run.
//
// We also do NOT generate a playwright.config.ts or an Nx e2e project. "Ready
// to use" here means "Claude can run ad-hoc Playwright scripts from Bash the
// moment the container opens" (see the `browser-automation:playwright` skill).
// If the user wants a real e2e suite, that's a separate, deliberate decision:
// `nx g @nx/playwright:configuration --project=<app>` does it the Nx-native way.
//
// Idempotent: re-running just re-asserts the devDep entry.
import {
  type Tree,
  type GeneratorCallback,
  addDependenciesToPackageJson,
  installPackagesTask,
} from '@nx/devkit';

interface PlaywrightSchema {
  // No options for now. Future knobs (browsers list, install-deps toggle) go here.
}

export default async function playwrightGenerator(
  tree: Tree,
  _options: PlaywrightSchema
): Promise<GeneratorCallback> {
  // `latest` resolves at install time; lockfile pins after. Idempotent re-run.
  addDependenciesToPackageJson(
    tree,
    /* dependencies */ {},
    /* devDependencies */ { '@playwright/test': 'latest' }
  );

  // Post-commit: install the new devDep via the workspace's package manager.
  return () => {
    installPackagesTask(tree);
  };
}
