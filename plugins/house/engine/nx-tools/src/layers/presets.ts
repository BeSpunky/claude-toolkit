// PRESETS — named ensure sets, as DATA beside the layer registry.
//
// A preset is nothing but a name for a set of layers a new project starts with: `house.sh new --preset=angular`
// is `--add-layer=<its layers>` with a memorable spelling. It adds no behaviour — the bootstrap and the generators
// that run are the ensure set's, exactly as for an explicit --add-layer — so a preset cannot drift from the layers
// it names, and adding one is one entry here (then `node tools/test-layers/run.mjs --write`: house.sh and
// --help read them through the generated shell projection like everything else).
//
// The DEFAULT is the stack-agnostic one: a new project is the house DX on the Nx floor — no package.json, no
// framework — and every stack is something it chooses to wear. (Before phase 6 the default WAS today's
// `angular` preset; that shape is still one flag away.)
import type { LayerId } from './descriptor';
import { FLOOR, layer } from './registry';

export interface Preset {
  /** The --preset value. */
  id: string;
  /** One line, for --help. */
  title: string;
  /** The ensure set. Closed under `requires`, with every `via` partner present (validated at load). */
  layers: readonly LayerId[];
}

const DEFINED: readonly Preset[] = [
  {
    id: 'agent',
    title: 'the house DX on the Nx floor — no package.json, no framework (Nx through its wrapper)',
    layers: ['nx', 'agent'],
  },
  {
    id: 'node',
    title: 'a Node workspace — root package.json (create-nx-workspace), the toolkit as exact devDependencies',
    layers: ['nx', 'agent', 'node'],
  },
  {
    id: 'angular',
    title: 'the house web app — Angular app, dev loop, design system (add --firebase for Firebase)',
    layers: ['nx', 'agent', 'node', 'web', 'angular', 'design-system'],
  },
];

export const DEFAULT_PRESET = 'agent';

export const PRESETS: readonly Preset[] = validated(DEFINED);

/** The preset with this id. Throws on an unknown one, naming what exists. */
export function preset(id: string): Preset {
  const found = PRESETS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`[presets] Unknown preset "${id}". Known: ${PRESETS.map((p) => p.id).join(', ')}`);
  return found;
}

/**
 * A preset must be a set a scaffold can actually create on its own: every layer registered and scaffold-ensurable,
 * everything each one requires inside the set, every `via` partner inside it. Checked at load, so a bad preset
 * fails the first import (and test-layers) rather than a user's scaffold.
 */
function validated(list: readonly Preset[]): readonly Preset[] {
  const ids = new Set<string>();
  for (const entry of list) {
    if (!/^[a-z][a-z0-9-]*$/.test(entry.id)) throw new Error(`[presets] Invalid preset id "${entry.id}".`);
    if (ids.has(entry.id)) throw new Error(`[presets] Preset "${entry.id}" is defined twice.`);
    ids.add(entry.id);
    const set = new Set(entry.layers);
    for (const id of entry.layers) {
      const descriptor = layer(id);
      const spec = descriptor.ensurable.new;
      if (spec === false) throw new Error(`[presets] "${entry.id}": 'new' cannot ensure "${id}".`);
      if (typeof spec === 'object' && !set.has(spec.via)) {
        throw new Error(`[presets] "${entry.id}": "${id}" is created only via "${spec.via}", which the preset lacks.`);
      }
      for (const required of descriptor.requires) {
        if (!set.has(required)) throw new Error(`[presets] "${entry.id}": "${id}" requires "${required}", which the preset lacks.`);
      }
    }
    if (!set.has(FLOOR)) throw new Error(`[presets] "${entry.id}" lacks the floor (${FLOOR}).`);
  }
  if (!ids.has(DEFAULT_PRESET)) throw new Error(`[presets] The default preset "${DEFAULT_PRESET}" is not defined.`);
  return list;
}
