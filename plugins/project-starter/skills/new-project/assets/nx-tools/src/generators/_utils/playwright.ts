// THE Playwright version the house pins — one number for both of its uses, so they share one Chromium download:
//   - the shared browser's own runtime (playwright-core, tools/shared-browser/runtime.mjs);
//   - a JS project's @playwright/test devDependency (the `playwright` generator).
// Moving it is a deliberate act: bump it here, and existing projects' @playwright/test pin moves only by a
// migration (it is project state — a dependency).
export const PLAYWRIGHT_VERSION = '1.63.0';
