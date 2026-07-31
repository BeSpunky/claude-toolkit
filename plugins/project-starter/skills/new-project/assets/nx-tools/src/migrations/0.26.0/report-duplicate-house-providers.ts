// 0.26.0 — report a house provider that ended up called in more than one app config. REPORTS ONLY.
//
// WHY THERE IS ANYTHING TO REPORT. Until 0.26.0 the three generators that wire a provider into
// `app.config.ts` (serve → provideWorktreeTabLabel, firebase-emulators → provideAppFirebase,
// design-system-styles → provideDesignSystem) re-asserted that wiring on EVERY sync. Their idempotency check
// looks for a call inside THAT file's `providers` array — correct, and blind to a project that had moved the
// provider somewhere else. An app that split its config (a browser-only `app.config.browser.ts`, a factory, a
// re-export) therefore got the provider added back to the shared config on the next sync, on top of the copy
// it already had.
//
// For Firebase that is not merely untidy: providing it in the SHARED config initialises Firebase during
// SSR/prerender, which is exactly what moving it to a browser-only config was meant to prevent. It is also
// the reason 0.26.0 stopped writing to app.config.ts outside a baseline run (see _utils/wire-provider.ts).
//
// ── WHY THIS ONLY REPORTS ──────────────────────────────────────────────────────────────────────────────────
//
// Removing one of the two copies requires knowing which one is wrong, and that is a genuine guess. Provider
// ORDER can matter in a merged config; the "extra" copy may be the one the project actually relies on; and
// the file shapes involved (`app.config.browser.ts` and friends) are the PROJECT'S inventions — nothing in
// this toolkit defines them, so nothing here can claim to understand them. The house rule for exactly this
// case is: where a deletion would be a guess, do not delete — but do not stay silent either. So this names
// every occurrence, file and line, and leaves the decision to someone who knows the app.
//
// SCOPED TO THE THREE HOUSE PROVIDERS, deliberately. A general `provideX()` sweep would flag a project's own
// providers, which are none of this migration's business and are frequently duplicated on purpose (per-route
// providers, test configs). These three are the ones the toolkit itself put there.
//
// RAW FILE READS ONLY, like its sibling at this version: `getProjects()` throws on a project.json carrying a
// `//` comment key inside `targets`, and a migration that cannot survive the workspace it is repairing is no
// use. Nothing here needs the project graph anyway — an app config is found by its filename.
import { type Tree, logger } from '@nx/devkit';

/** Directories that never hold app source, and are expensive or meaningless to walk. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.nx', '.angular', '.firebase', 'dist', 'tmp', 'coverage']);
const MAX_DEPTH = 12;

/** Only the providers this toolkit wires. A project's own duplicates are not ours to comment on. */
const HOUSE_PROVIDERS = ['provideAppFirebase', 'provideWorktreeTabLabel', 'provideDesignSystem'];

/** `app.config.ts`, `app.config.browser.ts`, `app.config.server.ts`, … — a config by name, at any depth. */
const APP_CONFIG = /^app\.config(\.[A-Za-z0-9-]+)?\.ts$/;

interface Hit {
  file: string;
  line: number;
}

export default async function reportDuplicateHouseProviders(tree: Tree): Promise<void> {
  // Group configs by the directory they live in: two configs for the SAME app sit side by side, and this is
  // what keeps one app's provider from being compared against another app's.
  const byDir = new Map<string, string[]>();
  for (const file of findAppConfigs(tree)) {
    const dir = file.slice(0, file.lastIndexOf('/'));
    (byDir.get(dir) ?? byDir.set(dir, []).get(dir)!).push(file);
  }

  const reports: string[] = [];

  for (const [dir, files] of byDir) {
    if (files.length < 2) continue; // one config cannot disagree with itself

    for (const provider of HOUSE_PROVIDERS) {
      const hits: Hit[] = [];
      for (const file of files) {
        for (const line of callLines(tree, file, provider)) hits.push({ file, line });
      }
      // More than one FILE — two calls in one file is a different (and much more visible) mistake, and one
      // this migration would only be guessing about.
      if (new Set(hits.map((h) => h.file)).size < 2) continue;

      reports.push(
        `${provider}() is provided in ${new Set(hits.map((h) => h.file)).size} configs under ${dir}:\n` +
          hits.map((h) => `      ${h.file}:${h.line}`).join('\n')
      );
    }
  }

  if (reports.length === 0) return;

  logger.warn(
    `[report-duplicate-house-providers] Found ${reports.length} house provider(s) wired into more than one ` +
      `app config. Nothing was changed.`
  );
  for (const report of reports) logger.warn(`[report-duplicate-house-providers]   ${report}`);
  logger.warn(
    `[report-duplicate-house-providers] Until this release these providers were re-asserted into ` +
      `app.config.ts on every sync, so a config that had been deliberately split got the provider added ` +
      `back alongside the copy it already had. That no longer happens — app.config.ts is written only when ` +
      `the layer is being created.\n` +
      `      Decide which copy is correct and delete the other. For provideAppFirebase() specifically, a ` +
      `copy in the SHARED config initialises Firebase during SSR/prerender, which is usually the bug.\n` +
      `      Nothing is removed automatically: provider order can matter, and which copy is right is a ` +
      `question about your app, not about the toolkit.`
  );
}

/** Line numbers (1-based) on which `<provider>(` is CALLED in `file`. */
function callLines(tree: Tree, file: string, provider: string): number[] {
  const text = tree.read(file, 'utf8');
  if (!text) return [];
  const lines: number[] = [];
  // A CALL, not an import: `provideX(` with optional space. An `import { provideX }` has no parenthesis, so
  // a leftover import after a manual revert is correctly not counted as providing anything.
  const call = new RegExp(`\\b${provider}\\s*\\(`);
  text.split(/\r?\n/).forEach((line, index) => {
    // Skip the obvious comment cases so a line explaining why the provider is NOT here is not read as a use.
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (call.test(line)) lines.push(index + 1);
  });
  return lines;
}

/** Every `app.config*.ts` in the workspace, found by walking the tree. */
function findAppConfigs(tree: Tree): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let children: string[];
    try {
      children = tree.children(dir);
    } catch {
      return;
    }
    for (const child of children) {
      if (SKIP_DIRS.has(child)) continue;
      const path = dir === '.' ? child : `${dir}/${child}`;
      if (!tree.isFile(path)) {
        walk(path, depth + 1);
        continue;
      }
      if (APP_CONFIG.test(child)) found.push(path);
    }
  };
  walk('.', 0);
  return found;
}
