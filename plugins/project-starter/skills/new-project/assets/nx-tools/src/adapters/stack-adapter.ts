// THE STACK ADAPTER — what a framework IS to the house generators.
//
// Two kinds of layer, and the whole phase-4 split turns on telling them apart:
//   - a STACK (`angular`; later `react-vite`, …) knows how to build things: it owns projects, creates apps and
//     libraries, and has framework-specific places for env config, providers and styles;
//   - a CAPABILITY (`firebase`, `design-system`, `navigation`, …) is what a project WEARS. It does its
//     framework-neutral part itself and ATTACHES to an app only through that app's adapter's ports.
//
// Before this seam, each capability hard-coded Angular: `firebase-emulators` required the angular layer for the
// whole generator although only the client wiring is Angular; the design system was an Angular library from
// birth; "is this an Angular app?" was answered three different ways in three files. A second framework would
// have been an `if (react)` in every one of them. Now it is ONE new file implementing this interface.
//
// PORTS ARE OPTIONAL, AND A MISSING ONE IS A REPORT, NEVER A CRASH. An adapter implements what its framework
// can do; a capability that needs a port the app's adapter lacks says so (see `portOf` in ./registry) and does
// its neutral part anyway — the same contract `requireLayer` gives a missing layer.
//
// Keep it as small as today's needs: every port below has a caller. A port with no caller is a guess about a
// framework nobody has asked for yet.
import type { GeneratorCallback, ProjectConfiguration, TargetConfiguration, Tree } from '@nx/devkit';
import type { LayerId } from '../layers/descriptor';

export interface StackAdapter {
  /** The adapter id. Also the value of publishable-lib's `--stack`. */
  readonly id: string;
  /** The layer that must be present for this adapter to act (its plugin is what the ports delegate to). */
  readonly layer: LayerId;
  /**
   * Is this project built by this stack — an app OR a library? THE one rule per framework; every "is this an
   * Angular app?" in the payload asks it (with `projectType` where only applications are wanted).
   */
  ownsProject(tree: Tree, project: string): boolean;
  /**
   * Is this project one of this stack's APPLICATIONS — judged from what builds it, not from what it declares?
   * `projectType` is optional in Nx and absent from every package.json-defined project (a TS-solution
   * workspace's), so a stack that can recognise its own app by its build says so here; the registry falls back
   * to `projectType` only when no stack does (`projectRole`). Optional: a stack whose builders do not tell an
   * app from a library (plain TS — `@nx/js:tsc` builds both) honestly leaves it out.
   */
  ownsApp?(project: ProjectConfiguration): boolean;
  /**
   * The executor PREFIXES that make a target this stack's (`@angular/build:`, `@nx/js:`). The ONE list behind
   * both `ownsProject` (applied to a project's build) and the stack layer's evidence (applied to any target) —
   * two copies of it once disagreed on whether `@nx/angular:` counted.
   */
  readonly executors: readonly string[];

  readonly apps?: AppPort;
  readonly libs?: LibPort;
  readonly env?: EnvPort;
  readonly providers?: ProvidersPort;
  readonly styles?: StylesPort;
  /** The app's dev-server, as an Nx `dev-server` target — what the web layer's `serve` composer drives. */
  readonly devServer?: DevServerPort;
  /** The framework half of the design system: its runtime binding, library shape, component generator. */
  readonly designSystem?: DesignSystemPort;
  /** The framework half of Firebase: the client SDK wiring an app gets on top of the neutral emulator core. */
  readonly firebase?: FirebaseClientPort;
}

export interface CreatedApp {
  /** The project name the framework's generator actually emitted. */
  project: string;
  callback: GeneratorCallback;
}

export interface AppPort {
  /** Create an application with the house defaults. Capabilities attach afterwards — this creates the app only. */
  create(tree: Tree, options: { directory: string; name?: string; style?: string }): Promise<CreatedApp>;
}

export interface LibOptions {
  name: string;
  directory: string;
  importPath: string;
  tags?: string;
  /** Publishable (buildable to dist, releasable) vs a workspace-internal source library. */
  publishable: boolean;
  /** Framework component-selector prefix; ignored by stacks without components. */
  prefix?: string;
  /** Framework component style language; ignored by stacks without components. */
  style?: string;
}

export interface LibPort {
  /** Create the library through the framework's own generator (which writes the tsconfig path alias). */
  create(tree: Tree, options: LibOptions): Promise<GeneratorCallback>;
  /** Framework post-processing of a PUBLISHABLE library's packaging config (e.g. ng-package.json). */
  normalizePackaging?(tree: Tree, projectRoot: string): void;
  /** Allow these runtime `dependencies` through the framework packager, where it gates them. */
  allowDependencies?(tree: Tree, projectRoot: string, dependencies: string[]): void;
}

/** One application's environment-config files — where per-env values live in this framework. */
export interface EnvFiles {
  dir: string;
  dev: string;
  prod: string;
  staging: string;
  /** The shared shape every env file conforms to, when the framework has one (TS: an interface). */
  shape?: string;
}

export interface EnvPort {
  files(tree: Tree, project: string): EnvFiles;
  /**
   * Make build configuration `configuration` compile with `to` instead of `from` (idempotent). Returns false
   * when the app has no build to configure — the caller reports it.
   */
  selectFor(tree: Tree, project: string, configuration: string, from: string, to: string, inheritFrom?: string): boolean;
}

export type WireResult = 'wired' | 'already' | 'no-bootstrap' | 'unrecognized';

export interface ProvidersPort {
  /** The file a provider is wired into (Angular: app.config.ts). */
  bootstrapFile(tree: Tree, project: string): string;
  /** Wire `providerFn()` from `importFrom` into the app's bootstrap. `ensuring` — see _utils/wire-provider. */
  wire(
    tree: Tree,
    project: string,
    provider: { providerFn: string; importFrom: string; ensuring: boolean; note?: string },
  ): WireResult;
}

export interface StylesPort {
  /** The app's global stylesheet, as the app itself declares it — or null when it has none we can find. */
  globalStylesheet(tree: Tree, project: string): string | null;
  /** Add a sass load path to the app's build. False when the app has no build to configure. */
  addLoadPath(tree: Tree, project: string, loadPath: string): boolean;
  /** Emit a standalone, NOT auto-injected stylesheet bundle from the app's build. False: no build. */
  registerStylesheet(tree: Tree, project: string, sheet: { input: string; bundleName: string }): boolean;
}

/**
 * The stack's DEV-SERVER LEAF — the `dev-server` target the `serve` composer (web layer) drives by name. The
 * composer itself is stack-free; only the leaf is the framework's. A project that already has a dev-server of its
 * own (any executor) keeps it — the stack supplies one only when there is none.
 */
export interface DevServerPort {
  /** The executor this stack's leaf runs — how a re-run recognises a leaf it owns (and may re-assert). */
  readonly executor: string;
  /**
   * Every executor that runs one of this stack's dev-servers — its own leaf's and the legacy ones. How a
   * dev-server is RECOGNISED under any target name (a fresh app parks it on `serve`), and so what the web
   * layer's evidence counts — never "any target called serve", which is a backend's name too.
   */
  readonly recognises: readonly string[];
  /** The port the stack's dev-server listens on when its target names none (Angular: 4200). THE one copy. */
  readonly basePort: number;
  /** The leaf for `project`, carrying `preserved` (the options a user tuned on the previous leaf). */
  leaf(tree: Tree, project: string, preserved: Record<string, unknown>): TargetConfiguration;
  /**
   * Point the app's dev-server at a dev proxy config (workspace-relative). True when set (or already set); false
   * when the app has no dev-server of this stack's to configure — the caller reports it.
   */
  useProxy(tree: Tree, project: string, proxyConfig: string): boolean;
}

/**
 * The library itself is created by `publishable-lib` through the SAME adapter's `libs` port — a design system
 * is a publishable library like any other; this port only adds what makes it the design system.
 */
export interface DesignSystemPort {
  /** Directory of this binding's seeded runtime + docs templates (merged over the neutral core's styles). */
  readonly templates: string;
  /** Files in `templates` that are the CONTRACT (rewritten every run) rather than seeded. */
  readonly alwaysRewrite: readonly string[];
  /** The provider an app installs the runtime binding with. */
  readonly provider: string;
  /** Open the sass channel INSIDE the library, so its own component styles resolve `<dir>/styles`. */
  openLibraryStyles(tree: Tree, root: string, specifier: string): void;
  /** Delete what the framework generator emitted that the DS does not ship (demo components). */
  pruneGenerated(tree: Tree, root: string): void;
}

export interface FirebaseClientPort {
  /** Packages the platform:server firewall bans for this framework (it must never reach Cloud Functions). */
  readonly serverBannedImports: readonly string[];
  /** Has this app already been given the Firebase client? (the suite's scripts follow the wired app) */
  isWired(tree: Tree, project: string): boolean;
  /** Attach the Firebase client to the app. Returns the post-commit install callback. */
  attach(
    tree: Tree,
    project: string,
    options: { workspaceName: string; staging: boolean; wireProviders: boolean },
  ): GeneratorCallback;
}
