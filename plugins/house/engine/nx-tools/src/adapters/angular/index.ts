// THE ANGULAR ADAPTER — everything the house generators know about Angular, in one place.
//
// Its ports are the Angular answers to framework-neutral questions:
//   apps       — @nx/angular:application with the house defaults (minimal, scss, routing, no e2e), and a first
//                shell with the <main> landmark (./app-shell);
//   shell      — the skip link, added by the design system with its look (./app-shell);
//   libs       — @nx/angular:library (+ the ng-package.json normalisation a publishable lib needs);
//   env        — Angular's environment-files pattern: src/environments/environment*.ts + build fileReplacements;
//   providers  — the app's ApplicationConfig (src/app/app.config.ts);
//   styles     — the build target's stylePreprocessorOptions and `styles` entries;
//   designSystem / firebase — the framework halves of those capabilities (./design-system, ./firebase-client).
//
// Every `@nx/angular` binding is a DYNAMIC import at the point of use: a static value import would bind the
// plugin at module load, so a workspace without Angular could not even load this file — and every generator
// imports the adapter registry.
import {
  type Tree,
  type ProjectConfiguration,
  type GeneratorCallback,
  getProjects,
  readProjectConfiguration,
} from '@nx/devkit';
import { updateProjectConfigurationInPlace } from '../../generators/_utils/project-files';
import type { StackAdapter, CreatedApp, WireResult } from '../stack-adapter';
import { wireProvider } from '../../generators/_utils/wire-provider';
import { setLeafOption } from '../../generators/_utils/dev-server';
import { angularLibs } from './libs';
import { angularDesignSystem } from './design-system';
import { angularFirebaseClient } from './firebase-client';
import { angularGeneratorCall, stateAngularCompilerContract } from './ts-solution';
import { addSkipLink, seedLandmark } from './app-shell';
import { convertBareLint } from '../../generators/_utils/lint-inference';

/**
 * The executors that make a project an Angular one. Applications build with `@angular/build:` (or the legacy
 * `@angular-devkit/build-angular:`); libraries with `@nx/angular:package` / `ng-packagr-lite`. This list is
 * THE rule — it replaced three hand-copied `isAngularApp`s that disagreed on whether a library counted — and
 * the `angular` layer's evidence reads it from here (`angular.executors`).
 */
const ANGULAR_BUILDERS = ['@angular/build:', '@angular-devkit/build-angular:', '@nx/angular:'];

/**
 * The builders that produce an Angular APPLICATION (as opposed to a library's `package` / `ng-packagr`): today's
 * esbuild `application`, the legacy devkit browser builders, and Nx's wrappers of them. Exact executor names, not
 * prefixes — every prefix above builds libraries too.
 */
const ANGULAR_APP_BUILDERS = new Set([
  '@angular/build:application',
  '@angular-devkit/build-angular:application',
  '@angular-devkit/build-angular:browser',
  '@angular-devkit/build-angular:browser-esbuild',
  '@nx/angular:application',
  '@nx/angular:browser-esbuild',
  '@nx/angular:webpack-browser',
]);

const noop: GeneratorCallback = () => {};

/** Angular's dev-server builder — the leaf this adapter writes (and recognises as its own on a re-run). */
const DEV_SERVER_EXECUTOR = '@angular/build:dev-server';
/**
 * Dev-server builders that take Angular's options (`proxyConfig`, …): today's, the legacy devkit one, and Nx's
 * (module-federation) wrapper of it.
 */
const DEV_SERVER_EXECUTORS = [DEV_SERVER_EXECUTOR, '@angular-devkit/build-angular:dev-server', '@nx/angular:dev-server'];
/** Angular's dev-server default port — what an app is served on when its target names none. */
const DEV_SERVER_PORT = 4200;

/** An Angular app's bootstrap: its ApplicationConfig. */
const bootstrapFile = (tree: Tree, project: string): string =>
  `${readProjectConfiguration(tree, project).root}/src/app/app.config.ts`;

function projectOf(tree: Tree, project: string): ProjectConfiguration | null {
  try {
    return readProjectConfiguration(tree, project);
  } catch {
    return null;
  }
}

/** The app's `build` target options, created on demand. Null when the app has no build. */
function buildOptions(config: ProjectConfiguration): Record<string, unknown> | null {
  const build = config.targets?.build;
  if (!build) return null;
  build.options ??= {};
  return build.options as Record<string, unknown>;
}

export const angular: StackAdapter = {
  id: 'angular',
  layer: 'angular',
  executors: ANGULAR_BUILDERS,

  ownsProject(tree, project) {
    const config = projectOf(tree, project);
    if (!config) return false;
    const executor = config.targets?.build?.executor ?? '';
    // ng-package.json is how an Angular library declares itself even when its build target is inferred.
    return ANGULAR_BUILDERS.some((prefix) => executor.startsWith(prefix)) || tree.exists(`${config.root}/ng-package.json`);
  },

  platform: 'web',

  ownsApp(project) {
    return ANGULAR_APP_BUILDERS.has(project.targets?.build?.executor ?? '');
  },

  apps: {
    async create(tree, options): Promise<CreatedApp> {
      // These option names are the exact, proven-good flags house.sh always passed
      // (`--minimal --style=scss --routing --e2eTestRunner=none`), expressed programmatically.
      const { applicationGenerator } = await import('@nx/angular/generators');
      // Through the TS-solution seam: in a workspaces-linked repo the app is created as a project.json island.
      const callback =
        (await angularGeneratorCall(tree, () => applicationGenerator(tree, {
          directory: options.directory,
          ...(options.name ? { name: options.name } : {}),
          style: options.style ?? 'scss',
          routing: true,
          minimal: true,
          e2eTestRunner: 'none',
          // Stated, never left to Nx: given no linter, @nx/angular follows the workspace, and a first app in a fresh
          // workspace has nothing to follow, so it chose `none` — and the platform firewall (an ESLint rule) never
          // checked the app's imports. Libraries (./libs) and the js stack state it the same way.
          linter: 'eslint',
          skipFormat: true,
        } as Parameters<typeof applicationGenerator>[1]))) ?? noop;
      const project = emittedProjectName(tree, options.directory, options.name);
      // Linted the way Nx recommends (@nx/eslint/plugin's inferred target), not by the deprecated executor @nx/angular writes.
      convertBareLint(tree, project);
      const root = readProjectConfiguration(tree, project).root;
      stateAngularCompilerContract(tree, root);
      seedLandmark(tree, root); // the <main> landmark, once; the skip link comes with its look (./app-shell, `shell`)
      return { project, callback };
    },
  },

  libs: angularLibs,

  env: {
    files(tree, project) {
      const root = readProjectConfiguration(tree, project).root;
      const dir = `${root}/src/environments`;
      return {
        dir,
        dev: `${dir}/environment.ts`,
        prod: `${dir}/environment.prod.ts`,
        staging: `${dir}/environment.staging.ts`,
        shape: `${dir}/environment.interface.ts`,
      };
    },

    // Touches ONLY `configurations.<configuration>.fileReplacements` (de-duplicated) — never `build.options`, so
    // a user's own configurations are unaffected. `inheritFrom` seeds the new configuration's OTHER settings
    // (budgets, outputHashing, …) from an existing one, so staging builds like prod without overwriting tweaks.
    selectFor(tree, project, configuration, from, to, inheritFrom) {
      const config = readProjectConfiguration(tree, project);
      const build = config.targets?.build as
        | { configurations?: Record<string, { fileReplacements?: Array<{ replace: string; with: string }> } & Record<string, unknown>> }
        | undefined;
      if (!build) return false;

      build.configurations ??= {};
      const target = (build.configurations[configuration] ??= {});
      const source = inheritFrom ? build.configurations[inheritFrom] : undefined;
      for (const [key, value] of Object.entries(source ?? {})) {
        if (key !== 'fileReplacements' && !(key in target)) target[key] = value;
      }
      const existing = Array.isArray(target.fileReplacements) ? target.fileReplacements : [];
      const present = existing.some((entry) => entry?.replace === from && entry?.with === to);
      target.fileReplacements = present ? existing : [...existing, { replace: from, with: to }];

      updateProjectConfigurationInPlace(tree, project, config);
      return true;
    },
  },

  providers: {
    bootstrapFile,

    wire(tree, project, provider): WireResult {
      const path = bootstrapFile(tree, project);
      if (!tree.exists(path)) return 'no-bootstrap';
      const current = tree.read(path, 'utf8') ?? '';
      const wired = wireProvider(current, path, provider);
      if (wired === null) return 'unrecognized';
      if (wired === current) return 'already';
      tree.write(path, wired);
      return 'wired';
    },
  },

  shell: {
    addSkipLink(tree, project) {
      return addSkipLink(tree, readProjectConfiguration(tree, project).root);
    },
  },

  styles: {
    // Derived from the build target's own declaration of its global stylesheet, never assumed to be
    // src/styles.scss (merely the @nx/angular default).
    globalStylesheet(tree, project) {
      const options = buildOptions(readProjectConfiguration(tree, project));
      const first = ((options?.styles as (string | { input?: string })[] | undefined) ?? [])[0];
      const path = typeof first === 'string' ? first : first?.input;
      return path && path.endsWith('.scss') && tree.exists(path) ? path : null;
    },

    // `stylePreprocessorOptions.includePaths` resolve from the WORKSPACE root. Merged and de-duplicated: an app
    // may carry load paths of its own, and a re-run must re-assert ours without dropping theirs.
    addLoadPath(tree, project, loadPath) {
      const config = readProjectConfiguration(tree, project);
      const options = buildOptions(config);
      if (!options) return false;
      const preprocessor = { ...((options.stylePreprocessorOptions as Record<string, unknown>) ?? {}) };
      preprocessor.includePaths = [...new Set([...((preprocessor.includePaths as string[]) ?? []), loadPath])];
      options.stylePreprocessorOptions = preprocessor;
      updateProjectConfigurationInPlace(tree, project, config);
      return true;
    },

    // `inject: false` + `bundleName` is Angular's own mechanism for a SWAPPABLE stylesheet: compiled and
    // emitted as its own file, but not linked into index.html. Matched by bundleName, so a re-run updates.
    registerStylesheet(tree, project, sheet) {
      const config = readProjectConfiguration(tree, project);
      const options = buildOptions(config);
      if (!options) return false;
      const styles = [...((options.styles as unknown[]) ?? [])];
      const entry = { input: sheet.input, bundleName: sheet.bundleName, inject: false };
      const at = styles.findIndex(
        (s) => typeof s === 'object' && s !== null && (s as { bundleName?: string }).bundleName === sheet.bundleName,
      );
      if (at >= 0) styles[at] = entry;
      else styles.push(entry);
      options.styles = styles;
      updateProjectConfigurationInPlace(tree, project, config);
      return true;
    },
  },

  devServer: {
    executor: DEV_SERVER_EXECUTOR,
    recognises: DEV_SERVER_EXECUTORS,
    basePort: DEV_SERVER_PORT,

    // Env pinned via configurations (development default / production); host 0.0.0.0 so it is reachable from
    // outside the devcontainer. buildTarget + configurations are owned here; every other option a user tuned
    // (proxyConfig, ssl, port, …) is carried over — IN PLACE: overwriting a key keeps its position, so a re-run
    // writes the same project.json rather than reshuffling keys.
    leaf(_tree, project, preserved) {
      // EXPLICITLY not continuous: the dev engine runs one per STACK, and Nx would share one across stacks. Explicit,
      // because Nx fills an absent key from targetDefaults / the builder's schema and @nx/angular's
      // set-continuous-option migration sets it on a dev-server that lacks it (_utils/dev-server).
      return {
        continuous: false,
        executor: DEV_SERVER_EXECUTOR,
        options: { ...preserved, buildTarget: `${project}:build`, host: (preserved.host as string | undefined) ?? '0.0.0.0' },
        configurations: {
          development: { buildTarget: `${project}:build:development` },
          production: { buildTarget: `${project}:build:production` },
        },
        defaultConfiguration: 'development',
      };
    },

    // The dev-server's OWN option (Angular's `proxyConfig`), so a direct `nx run <app>:dev-server` gets it too;
    // set-if-absent, so a project that points elsewhere keeps its choice — and is TOLD, by the caller: a proxy config
    // of its own, in the leaf's options or any configuration, is a dev server that does not serve this one. Through
    // setLeafOption, which keeps the `serve` / `dev-stack` mirror of the leaf true.
    useProxy(tree, project, proxyConfig) {
      const target = 'dev-server';
      const leaf = projectOf(tree, project)?.targets?.[target];
      if (!leaf) return { status: 'none' };
      if (!DEV_SERVER_EXECUTORS.includes(leaf.executor ?? '')) {
        return { status: 'unconfigurable', target, executor: leaf.executor ?? '(none — a command target)' };
      }
      const named = [
        ['options', leaf.options?.proxyConfig],
        ...Object.entries(leaf.configurations ?? {}).map(([name, c]) => [`configurations.${name}`, c?.proxyConfig]),
      ] as const;
      const foreign = named.find(([, value]) => value !== undefined && value !== proxyConfig);
      if (foreign) return { status: 'foreign', target, where: foreign[0], proxyConfig: String(foreign[1]) };
      setLeafOption(tree, project, 'proxyConfig', proxyConfig);
      return { status: 'wired' };
    },
  },

  designSystem: angularDesignSystem,
  firebase: angularFirebaseClient,
};

/**
 * The project name @nx/angular:application emitted for `directory`: an explicit name, else the directory's last
 * segment (what Nx names `apps/<name>`), else the project whose root IS the directory (any Nx version whose
 * path→name derivation differs). Throws an actionable error rather than letting a later step fail cryptically.
 */
function emittedProjectName(tree: Tree, directory: string, explicitName?: string): string {
  if (explicitName) return explicitName;
  const wanted = directory.replace(/\/+$/, '');
  const base = wanted.split('/').pop() ?? wanted;
  const projects = getProjects(tree);
  if (projects.has(base)) return base;
  for (const [name, config] of projects) if (config.root === wanted) return name;
  throw new Error(
    `[app] Could not resolve the project name @nx/angular:application emitted for directory "${directory}". Pass an explicit --name.`,
  );
}
