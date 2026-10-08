// Chromium's OS dependencies for the pinned Playwright. THE Playwright version itself is in ./versions (with every
// other version the house writes); this file is what follows from it.
import { CHROMIUM_OS_PACKAGES, CHROMIUM_OS_PACKAGES_VERSION } from './playwright-deps';

/**
 * Chromium's OS dependencies as ONE `osPackages` group, shared by every layer that brings a Playwright Chromium (`web`'s
 * shared browser, `js`'s @playwright/test) — the composer de-duplicates, so a project wearing both installs them once.
 * They are image packages, not a `--with-deps` apt step in post-create, which reinstalled them on every rebuild.
 */
export const CHROMIUM_OS_PACKAGE_GROUP = {
  packages: CHROMIUM_OS_PACKAGES,
  // A Debian 13 projection: on a foreign image the post-create browser installs use Playwright's own --with-deps.
  onHouseImageOnly: true as const,
  why:
    `Chromium's system libraries, Xvfb and fonts — exactly what \`playwright install-deps chromium\` installs for the\n` +
    `pinned Playwright (${CHROMIUM_OS_PACKAGES_VERSION}), projected from its own table (tools/playwright-deps). Built into the\n` +
    'image so the browser installs (post-create) need no apt step of their own.',
};
