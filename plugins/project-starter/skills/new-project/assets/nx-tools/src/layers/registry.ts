// THE LAYER — the concept this plugin has been working around, modelled once, here.
//
// Every house generator has a PRECONDITION: `design-system` needs Angular, `serve` needs a project with a
// dev-server, `firebase-emulators` needs an app to wire. Until now those preconditions were implicit — encoded
// only in the ORDER of a flat command list in scaffold.sh, and enforced by whatever error the generator
// happened to hit first. Run that list against a workspace of a different shape and you got a devkit stack
// trace from inside `await import('@nx/angular/generators')`, three generators after the one that actually
// didn't apply.
//
// A layer makes the precondition a first-class, inspectable value:
//   - DETECT  — is this capability present? Pure; never mutates. This is the half that lets `--sync`
//               re-apply only what a project actually has, instead of assuming every project is the
//               scaffolder's own Angular+Firebase shape.
//   - REQUIRE — a generator states what it needs, and gets a sentence a human can act on when it's absent.
//   - ORDER   — a partial order (`requires`), so a caller can resolve "apply these layers" into a sequence.
//
// DETECTION, NOT DECLARATION. Every detector reads the workspace itself — nx.json, the project graph, the root
// package.json — never a config file that says which layers are on. A declaration is a second source of truth
// that goes stale the moment someone runs `nx add @nx/angular` by hand; the workspace IS the truth. This is
// the same idiom already proven three times in this plugin: `app` keys off `firebase.json`,
// `design-system-styles` keys off the `type:design-system` tag, and `post-create.sh` keys off `@angular/core`
// in package.json.
//
// WHAT IS NOT A LAYER. Host facts — a WSL audio bridge (`--voice`), a GitHub remote, Docker — describe the
// MACHINE, not the project, and are not detectable from a Tree. They stay opt-in flags on scaffold.sh.
import { type Tree, getProjects, readJson } from '@nx/devkit';
import { findDesignSystem } from '../generators/_utils/design-system';

export type LayerId =
  | 'nx'
  | 'agent'
  | 'js'
  | 'web'
  | 'angular'
  | 'design-system'
  | 'navigation'
  | 'firebase';

export interface Layer {
  id: LayerId;
  /** One line, for progress output and error messages. */
  title: string;
  /** Layers that must already be present for this one to mean anything. A partial order, not a ladder. */
  requires: LayerId[];
  /** Is the capability present? PURE — reads the workspace, never writes. */
  detect(tree: Tree): boolean;
  /** How a human brings this layer into being. Quoted verbatim when a generator's precondition fails. */
  ensureHint: string;
}

/**
 * The layer definitions, in dependency order (every layer appears after everything it requires), so iterating
 * this array is already a valid application sequence.
 */
export const LAYERS: readonly Layer[] = [
  {
    id: 'nx',
    title: 'Nx workspace',
    requires: [],
    // The MECHANISM floor: every house generator is a devkit generator run through `nx g`, so nothing above
    // this line can run without it. Note this is deliberately not "is there a node_modules/.bin/nx" — that is
    // a question about the machine, and this is a question about the repo.
    detect: (tree) => tree.exists('nx.json'),
    ensureHint:
      'a root package.json, then `nx init` (NOT the dot-nx installation — it cannot host devkit plugins: ' +
      '@nx/devkit is unresolvable from the workspace root there and `nx add` fails)',
  },
  {
    id: 'agent',
    title: 'Agent DX (Claude settings, devcontainer, window identity, HOUSE.rules.md + HOUSE.md)',
    requires: ['nx'],
    // The generated house docs are the marker: generator-owned, root-level, committed, and already the files
    // the SessionStart hook stats. Their presence means the house generators have been applied here at least
    // once. EITHER satisfies the layer, so the layer is self-healing: if one is deleted, the layer is still
    // detected, `house-doc` still runs on the next sync, and the missing file comes back. Requiring HOUSE.md
    // alone would mean a tree that lost it reads as "not a house project" everywhere at once — the version
    // hook goes quiet, the layer goes undetected, and a plain `--sync` skips the one generator that could
    // restore it.
    detect: (tree) => tree.exists('HOUSE.md') || tree.exists('HOUSE.rules.md'),
    ensureHint: '`scaffold.sh --sync --ensure=agent <project>`',
  },
  {
    id: 'js',
    title: 'TypeScript/JavaScript libraries',
    requires: ['nx'],
    detect: (tree) => hasDependency(tree, '@nx/js') || hasProjectOfType(tree, 'library'),
    ensureHint: '`nx add @nx/js`',
  },
  {
    id: 'web',
    title: 'Web dev loop (serve, worktree domains, shared browser)',
    requires: ['nx'],
    // A project with SOMETHING to serve. Deliberately framework-agnostic: the `serve` composing executor drives
    // a `dev-server` TARGET, and neither it, the worktree-domains proxy, nor the shared browser knows or cares
    // what framework produced it. Angular supplies the dev-server leaf today; a Vite or Next app would satisfy
    // this layer just as well, which is the whole point of separating it from `angular`.
    detect: (tree) => hasTarget(tree, 'dev-server') || hasTarget(tree, 'serve'),
    ensureHint: 'an app with a dev-server target (e.g. the `angular` layer)',
  },
  {
    id: 'angular',
    title: 'Angular application',
    requires: ['nx', 'web'],
    // `@nx/angular` counts, and must. What every guard on this layer actually protects is a dynamic
    // `import('@nx/angular/generators')` — so the honest question is "is the Angular PLUGIN here?", not "has
    // an Angular app been built yet". Those differ for exactly one window, and it is the important one:
    // `nx add @nx/angular` installs the plugin WITHOUT adding `@angular/core` to the root package.json
    // (verified — it lands `@nx/angular`, `@nx/js`, `@angular-devkit/core` and nothing else), and
    // `@angular/core` only arrives with the first app. Detecting on `@angular/core` alone therefore reported
    // the layer ABSENT in precisely the moment the `app` generator runs, so the guard rejected the very
    // generator whose job is to create the app — breaking every scaffold at its first house generator.
    detect: (tree) =>
      hasDependency(tree, '@angular/core') || hasDependency(tree, '@nx/angular') || hasAngularApp(tree),
    ensureHint: '`nx add @nx/angular`, then `nx g @bespunky/nx-tools:app apps/<name>`',
  },
  {
    id: 'design-system',
    title: 'Design system',
    requires: ['angular'],
    // The `type:design-system` TAG, via the existing shared util — not a path and not a marker file. Reusing
    // findDesignSystem keeps one detection rule for the DS across the whole plugin.
    detect: (tree) => findDesignSystem(tree) !== null,
    ensureHint: '`nx g @bespunky/nx-tools:design-system --scope=<scope>`',
  },
  {
    id: 'navigation',
    title: 'Typed reactive navigation',
    requires: ['angular'],
    detect: (tree) => [...getProjects(tree)].some(([name]) => name === 'navigation-core'),
    ensureHint: '`nx g @bespunky/nx-tools:navigation-core`',
  },
  {
    id: 'firebase',
    title: 'Firebase',
    requires: ['angular'],
    detect: (tree) => tree.exists('firebase.json'),
    ensureHint: '`scaffold.sh --sync --firebase <project>` (or `nx g @bespunky/nx-tools:firebase-emulators --project=<app>`)',
  },
];

const BY_ID = new Map<LayerId, Layer>(LAYERS.map((layer) => [layer.id, layer]));

/** The layer with this id. Throws on an unknown id — a typo in a generator's guard is a bug, not a runtime state. */
export function layer(id: LayerId): Layer {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`[layers] Unknown layer "${id}".`);
  return found;
}

/**
 * Every layer present in this workspace, in dependency order.
 *
 * A layer is reported present only when its own detector says so — a layer is NOT implied by the layers above
 * it. That keeps the profile an honest description of the tree rather than a derived fiction: a workspace can
 * genuinely have `firebase.json` while its app was deleted, and a sync needs to see that, not paper over it.
 */
export function detectLayers(tree: Tree): LayerId[] {
  return LAYERS.filter((entry) => safeDetect(entry, tree)).map((entry) => entry.id);
}

/**
 * Assert a generator's precondition, failing with a sentence the reader can ACT on.
 *
 * This is the whole reason the concept exists. Without it, running an Angular-layer generator on a workspace
 * that has no Angular fails somewhere inside a delegated Nx generator, with a message about a module path —
 * which sends the reader off to install a package rather than telling them the honest thing: this generator
 * does not apply to this workspace yet, and here is how it would.
 */
export function requireLayer(tree: Tree, id: LayerId, generatorName: string): void {
  const required = layer(id);
  if (safeDetect(required, tree)) return;

  const present = detectLayers(tree);
  throw new Error(
    `[${generatorName}] needs the \`${id}\` layer (${required.title}), which this workspace does not have.\n` +
      `  present: ${present.length ? present.join(', ') : '(none)'}\n` +
      `  add it with: ${required.ensureHint}`,
  );
}

/**
 * A detector must never take the whole run down. `getProjects` throws on a workspace whose project config is
 * mid-edit or malformed, and "we could not tell" has to degrade to "absent" — the caller then either skips the
 * layer (sync) or reports a precondition (requireLayer), both of which are recoverable. A crash inside
 * DETECTION would not be.
 */
function safeDetect(entry: Layer, tree: Tree): boolean {
  try {
    return entry.detect(tree);
  } catch {
    return false;
  }
}

/** Is `pkg` declared in the root package.json (either dependency block)? */
function hasDependency(tree: Tree, pkg: string): boolean {
  if (!tree.exists('package.json')) return false;

  const json = readJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(
    tree,
    'package.json',
  );
  return Boolean(json.dependencies?.[pkg] ?? json.devDependencies?.[pkg]);
}

function hasProjectOfType(tree: Tree, projectType: 'application' | 'library'): boolean {
  return [...getProjects(tree)].some(([, project]) => project.projectType === projectType);
}

/** Does any project declare a target by this name? */
function hasTarget(tree: Tree, target: string): boolean {
  return [...getProjects(tree)].some(([, project]) => Boolean(project.targets?.[target]));
}

/** Any project built by an Angular browser builder — the same test `_utils/design-system` uses per-project. */
function hasAngularApp(tree: Tree): boolean {
  return [...getProjects(tree)].some(([, project]) => {
    const executor = project.targets?.build?.executor ?? '';
    return executor.startsWith('@angular/build:') || executor.startsWith('@angular-devkit/build-angular:');
  });
}
