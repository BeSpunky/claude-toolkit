// 0.35.0 — pin the `@playwright/test` the house generator declared as `latest`.
//
// Up to 0.34.x the `playwright` generator wrote `"@playwright/test": "latest"`. A floating spec moves a
// project's test runner — and the Chromium revision it downloads — with no commit behind it; from 0.35.0 the
// generator pins the house Playwright version instead. A dependency is project state, so the pin already on
// disk moves only here.
//
// Pinned to what the project ACTUALLY RUNS — the version resolved in node_modules — so this is a no-surprise
// change: the lockfile already says that version, and nothing is upgraded or downgraded by the migration. Only
// when nothing is installed does it fall back to the house version 0.35.0 ships (frozen below).
//
// Only the literal `latest` is touched: any other spec (`^1.40.0`, a tag, a workspace protocol) is the
// project's own choice and stays.
import { type Tree, logger } from '@nx/devkit';

const TAG = '[migrate 0.35.0 pin-playwright]';
const PACKAGE = '@playwright/test';
/** The house Playwright version as of 0.35.0. Frozen: the live constant may move on. */
const HOUSE_VERSION = '1.63.0';

export default function pinPlaywright(tree: Tree): void {
  if (!tree.exists('package.json')) return;
  const text = tree.read('package.json', 'utf8') ?? '';
  let pkg: Record<string, Record<string, string> | undefined>;
  try {
    pkg = JSON.parse(text);
  } catch {
    logger.warn(`${TAG} package.json is not valid JSON — not inspected.`);
    return;
  }
  const block = (['devDependencies', 'dependencies'] as const).find((b) => pkg[b]?.[PACKAGE] === 'latest');
  if (!block) return;

  let version = HOUSE_VERSION;
  let source = `the house version (nothing installed in node_modules/${PACKAGE})`;
  try {
    const installed = JSON.parse(tree.read(`node_modules/${PACKAGE}/package.json`, 'utf8') ?? '') as { version?: string };
    if (installed.version && /^\d+\.\d+\.\d+$/.test(installed.version)) {
      version = installed.version;
      source = 'the version installed in node_modules';
    }
  } catch {
    /* not installed — the house version */
  }

  pkg[block]![PACKAGE] = version;
  const indent = /^(\s+)"/m.exec(text)?.[1] ?? '  ';
  tree.write('package.json', `${JSON.stringify(pkg, null, indent)}\n`);
  logger.info(`${TAG} package.json ${block}.${PACKAGE}: "latest" -> "${version}" (${source}).`);
}
