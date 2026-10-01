// THE LAYER REGISTRY — the single source of truth for what layers exist.
//
// Every house generator has a PRECONDITION: `design-system` needs Angular, `serve` needs a project with a
// dev-server, `firebase-emulators` needs an app to wire. A layer makes the precondition a first-class,
// inspectable value:
//   - DETECT  — is this capability present? Pure; never mutates. This is what lets `--sync` re-apply only what
//               a project actually has, instead of assuming every project is the scaffolder's own shape.
//   - REQUIRE — a generator states what it needs, and gets a sentence a human can act on when it's absent.
//   - ORDER   — a partial order (`requires`), so a caller can resolve "apply these layers" into a sequence.
//
// DETECTION, NOT DECLARATION. Every detector reads the workspace itself — nx.json, the project graph, the root
// package.json, the house's own committed markers — never a config file that says which layers are on. A
// declaration is a second source of truth that goes stale the moment someone runs `nx add @nx/angular` by hand.
//
// WHAT IS NOT A LAYER. Host facts — a host audio bridge (`--voice`), a GitHub remote, Docker — describe the
// MACHINE, not the project, and are not detectable from a Tree. They stay opt-in flags on scaffold.sh.
//
// OPEN, NOT CLOSED. A layer is one file in this directory exporting a `LayerDescriptor` (see descriptor.ts),
// registered by ONE line in `REGISTERED` below. Nothing else in the toolkit enumerates layers: scaffold.sh and
// the SessionStart hook read the generated shell projection (`assets/layers.sh`, from `cli.ts shell`) and the
// installed planner (`cli.ts plan`). The full contract: docs/features/2026-10-01-stack-agnostic/contracts/layers.md.
import type { Tree } from '@nx/devkit';
import type { LayerDescriptor, LayerId } from './descriptor';
import { matchesEvidence } from './evidence';
import { nx } from './nx';
import { agent } from './agent';
import { js } from './js';
import { web } from './web';
import { angular } from './angular';
import { designSystem } from './design-system';
import { navigation } from './navigation';
import { firebase } from './firebase';

export type { LayerDescriptor, LayerId } from './descriptor';
/** @deprecated The pre-registry name for a descriptor; kept so existing imports keep compiling. */
export type Layer = LayerDescriptor;

/**
 * THE REGISTRATION LIST, in dependency order: every layer appears after everything it requires (asserted
 * below, at load), so iterating it is already a valid application sequence — and it is the order the
 * planner runs generators in. To add a layer: write `layers/<id>.ts`, add it here, regenerate the shell
 * projection (`node tools/test-layers/run.mjs --write`).
 */
const REGISTERED: readonly LayerDescriptor[] = [nx, agent, js, web, angular, designSystem, navigation, firebase];

/** The layer that is ALWAYS ensured, beneath everything else. */
export const FLOOR: LayerId = nx.id;

export const LAYERS: readonly LayerDescriptor[] = validated(REGISTERED);

const BY_ID = new Map<LayerId, LayerDescriptor>(LAYERS.map((entry) => [entry.id, entry]));

/** The layer with this id. Throws on an unknown id — a typo in a generator's guard is a bug, not a runtime state. */
export function layer(id: LayerId): LayerDescriptor {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`[layers] Unknown layer "${id}". Registered: ${LAYERS.map((l) => l.id).join(', ')}`);
  return found;
}

/** Is this layer present in the workspace? Never throws — "could not tell" degrades to "absent". */
export function isPresent(tree: Tree, id: LayerId): boolean {
  return safeDetect(layer(id), tree);
}

/**
 * Every layer present in this workspace, in registry order.
 *
 * A layer is reported present only when its OWN detection says so — a layer is NOT implied by the layers above
 * it. That keeps the profile an honest description of the tree: a workspace can genuinely have `firebase.json`
 * while its app was deleted, and a sync needs to see that, not paper over it.
 */
export function detectLayers(tree: Tree): LayerId[] {
  return LAYERS.filter((entry) => safeDetect(entry, tree)).map((entry) => entry.id);
}

/** These ids, de-duplicated and in registry order. Unknown ids throw (see `layer`). */
export function inRegistryOrder(ids: Iterable<LayerId>): LayerId[] {
  const wanted = new Set(ids);
  for (const id of wanted) layer(id);
  return LAYERS.filter((entry) => wanted.has(entry.id)).map((entry) => entry.id);
}

/**
 * Assert a generator's precondition, failing with a sentence the reader can ACT on — rather than a devkit stack
 * trace from inside a delegated `import('@nx/angular/generators')`, three generators after the one that
 * actually didn't apply.
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
 * layer (sync) or reports a precondition (requireLayer), both recoverable. A crash inside DETECTION would not be.
 */
function safeDetect(entry: LayerDescriptor, tree: Tree): boolean {
  try {
    return matchesEvidence(tree, entry.evidence) || Boolean(entry.detect?.(tree));
  } catch {
    return false;
  }
}

/**
 * The registration list's invariants, checked once at load — a broken registry must fail loudly at the first
 * import, not as a mis-ordered generator sequence in somebody's project:
 *   - ids are unique and shell-safe (they are interpolated into scaffold.sh's rendered program and the hook);
 *   - every `requires` names a layer registered EARLIER (so registry order is a topological order);
 *   - an ensurability `via` names a registered layer.
 */
function validated(list: readonly LayerDescriptor[]): readonly LayerDescriptor[] {
  const seen = new Set<LayerId>();
  for (const entry of list) {
    if (!/^[a-z][a-z0-9-]*$/.test(entry.id)) throw new Error(`[layers] Invalid layer id "${entry.id}".`);
    if (seen.has(entry.id)) throw new Error(`[layers] Layer "${entry.id}" is registered twice.`);
    for (const required of entry.requires) {
      if (!seen.has(required)) {
        throw new Error(`[layers] "${entry.id}" requires "${required}", which is not registered before it.`);
      }
    }
    seen.add(entry.id);
  }
  for (const entry of list) {
    for (const mode of ['scaffold', 'sync'] as const) {
      const spec = entry.ensurable[mode];
      if (typeof spec === 'object' && !seen.has(spec.via)) {
        throw new Error(`[layers] "${entry.id}" is ensurable via "${spec.via}", which is not registered.`);
      }
    }
  }
  return list;
}
