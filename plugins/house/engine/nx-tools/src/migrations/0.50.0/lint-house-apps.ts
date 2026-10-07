// 0.50.0 — every house app is linted, so the platform firewall checks it.
//
// WHY. The firewall (src/platform) is an ESLint rule: it judges a project's imports only when that project is
// LINTED. House Angular apps were created with no `lint` target — @nx/angular's application generator, given no
// `linter`, follows the workspace, and a first app in a fresh workspace has nothing to follow, so non-interactively
// it chose `none` (read from @nx/angular 23.3's normalizeLinterOption; `--minimal` was never the cause). So the web
// app — the one project the web/server boundary exists for — imported whatever it liked, unchecked: a boundary
// nobody enforces is no boundary. From 0.50.0 the Angular adapter passes `linter: 'eslint'` at creation; this rung
// gives existing house apps the same, through @nx/angular's own public `add-linting` generator (the Angular rules,
// the selector prefix, the project eslint.config extending the root one, where the firewall lives). Its `lint` target is
// @nx/eslint/plugin's INFERRED one (registered in nx.json if it is not yet) — add-linting still writes the deprecated
// `@nx/eslint:lint` executor, which ../../generators/_utils/lint-inference converts the way convert-to-inferred would.
//
// AND THE HOUSE'S OWN: up to 0.49 firebase-emulators gave the functions project that same bare executor target. From
// 0.50.0 it declares none where the plugin infers `lint` (an explicit `eslint .` where inference is off), and
// generators never remove a whole target — so it is converted here too.
//
// WHICH APPS: the house's — an Angular application behind the house `serve` composer. Already linted (a `lint`
// target, or one @nx/eslint/plugin infers from its own or the root eslint config) → nothing. @nx/angular not installed (it is
// what created the app; a broken install) → nothing written, the command reported.
//
// ALSO REPORTED, never edited: any OTHER project that holds code (a stack builds it, or it builds/tests/serves),
// carries a `platform:` tag and is not linted — its tag states a boundary nothing checks. (A tooling project of
// scripts — shared-browser, the emulator suite — holds no importable code, so its tag is not news.)
import { type GeneratorCallback, type ProjectConfiguration, type Tree, getProjects, logger } from '@nx/devkit';
import { angular } from '../../adapters/angular';
import { nxInvocation } from '../../generators/_utils/nx-host';
import { holdsCode } from '../../platform';
import { platformOf } from '../../platform/platform';
import { convertBareLint, inferredLintTarget } from '../../generators/_utils/lint-inference';
import { houseProjectHome } from '../../generators/_utils/project-files';
import { resolveAppsDir } from '../../generators/_utils/workspace-layout';

const TAG = '[0.50.0 lint-house-apps]';
const HOUSE_SERVE = '@bespunky/nx-tools:serve';
const ESLINT_CONFIGS = ['eslint.config.mjs', 'eslint.config.js', 'eslint.config.cjs', 'eslint.config.ts', '.eslintrc.json'];

export default async function lintHouseApps(tree: Tree): Promise<GeneratorCallback | void> {
  const nx = nxInvocation(tree).command;
  const tasks: GeneratorCallback[] = [];
  for (const [name, config] of getProjects(tree)) {
    if (isLinted(tree, config)) continue;
    // The composer is `serve` before split-serve-follower (this release) and `dev-stack` after it: either order holds.
    const house = angular.ownsApp(config) && [config.targets?.serve, config.targets?.['dev-stack']].some((t) => t?.executor === HOUSE_SERVE);
    if (!house) {
      if (platformOf(config.tags) && holdsCode(tree, name, config)) {
        logger.warn(
          `${TAG} \`${name}\` is tagged ${config.tags!.find((tag) => tag.startsWith('platform:'))} but has no lint target, so ` +
            `the platform firewall never checks its imports. Give it one (an Angular project: ` +
            `\`${nx} g @nx/angular:add-linting --projectName=${name} --projectRoot=${config.root} --linter=eslint\`; ` +
            `otherwise \`${nx} g @nx/eslint:lint-project --project=${name}\`).`,
        );
      }
      continue;
    }
    const command = `${nx} g @nx/angular:add-linting --projectName=${name} --projectRoot=${config.root} --linter=eslint`;
    let addLinting: typeof import('@nx/angular/generators').addLintingGenerator;
    try {
      ({ addLintingGenerator: addLinting } = await import('@nx/angular/generators'));
    } catch {
      logger.warn(
        `${TAG} \`${name}\` has no lint target, so the platform firewall never checks its imports — and @nx/angular, ` +
          `which adds one, is not installed. Install the workspace's dependencies, then: ${command}`,
      );
      continue;
    }
    const prefix = typeof (config as { prefix?: unknown }).prefix === 'string' ? (config as { prefix: string }).prefix : 'app';
    tasks.push(await addLinting(tree, { projectName: name, projectRoot: config.root, prefix, linter: 'eslint', skipFormat: true }));
    // add-linting writes the deprecated `@nx/eslint:lint` executor; the target becomes the one Nx recommends.
    convertBareLint(tree, name);
    logger.info(
      `${TAG} \`${name}\`: lint added (${config.root}/eslint.config.mjs) — the platform firewall now checks this app's ` +
        `imports. Run \`${nx} lint ${name}\`: anything it reports crossed the boundary unseen until now. INSTALL first ` +
        `if package.json gained ESLint packages.`,
    );
  }
  const functions = houseProjectHome(tree, 'functions', `${resolveAppsDir(tree)}/functions`);
  if (functions.exists && convertBareLint(tree, functions.name)) {
    logger.info(`${TAG} \`${functions.name}:lint\` no longer runs the deprecated @nx/eslint:lint executor — it is linted the way Nx recommends (@nx/eslint/plugin).`);
  }
  if (tasks.length) return async () => {
    for (const task of tasks) await task();
  };
}

/**
 * A `lint` target, or one @nx/eslint/plugin infers: the plugin lints every project under an ESLint config — its own,
 * or (for a project with none) the workspace root's.
 */
function isLinted(tree: Tree, config: ProjectConfiguration): boolean {
  if (config.targets?.lint) return true;
  if (inferredLintTarget(tree) === undefined) return false;
  const prefix = config.root === '.' ? '' : `${config.root}/`;
  return ESLINT_CONFIGS.some((file) => tree.exists(`${prefix}${file}`) || tree.exists(file));
}
