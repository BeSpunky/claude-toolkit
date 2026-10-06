// THE Playwright version the house pins — one number for both of its uses, so they share one Chromium download:
//   - the shared browser's own runtime (playwright-core, tools/shared-browser/runtime.mjs);
//   - a JS project's @playwright/test devDependency (the `playwright` generator).
// Moving it is a deliberate act: bump it here, and existing projects' @playwright/test pin moves only by a
// migration (it is project state — a dependency).
export const PLAYWRIGHT_VERSION = '1.63.0';

import { CHROMIUM_OS_PACKAGES, CHROMIUM_OS_PACKAGES_VERSION } from './playwright-deps';

/**
 * Chromium's OS dependencies as ONE `osPackages` group, shared by every layer that brings a Playwright Chromium (`web`'s
 * shared browser, `js`'s @playwright/test) — the composer de-duplicates, so a project wearing both installs them once.
 * They are image packages, not a `--with-deps` apt step in post-create, which reinstalled them on every rebuild.
 */
export const CHROMIUM_OS_PACKAGE_GROUP = {
  packages: CHROMIUM_OS_PACKAGES,
  why:
    `Chromium's system libraries, Xvfb and fonts — exactly what \`playwright install-deps chromium\` installs for the\n` +
    `pinned Playwright (${CHROMIUM_OS_PACKAGES_VERSION}), projected from its own table (tools/playwright-deps). Built into the\n` +
    'image so the browser installs (post-create) need no apt step of their own.',
};
