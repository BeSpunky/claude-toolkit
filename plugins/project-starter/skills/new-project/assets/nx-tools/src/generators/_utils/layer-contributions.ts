// WHAT THE ACTIVE LAYERS CONTRIBUTE to the agent artifacts — read in ONE place, so the generators that compose
// them (devcontainer, claude-settings, house-doc) can never disagree about the layer set or its order.
//
// Each generator takes the layer set as `--layers` (the run knows what it is about to ENSURE before the tree
// reflects it) and falls back to DETECTING it — the same rule house-doc has always followed.
import type { Tree } from '@nx/devkit';
import type { DevcontainerFragment, GitignoreBlock, LayerDescriptor, LayerId } from '../../layers/descriptor';
import { detectLayers, inRegistryOrder, layer } from '../../layers/registry';

/** The active layers' descriptors, in registry order — from `--layers` when given, else detected. */
export function activeLayers(tree: Tree, given: readonly LayerId[] | string | undefined): LayerDescriptor[] {
  const ids = normalise(given) ?? detectLayers(tree);
  return inRegistryOrder(ids).map(layer);
}

/**
 * `--layers` as the generators receive it. Nx coerces a comma-separated value for an array-typed option into an
 * array, but a direct API call may pass the string — both mean the same list.
 */
function normalise(given: readonly LayerId[] | string | undefined): LayerId[] | undefined {
  if (given === undefined) return undefined;
  const list = typeof given === 'string' ? given.split(',') : given.flatMap((entry) => entry.split(','));
  return list.map((entry) => entry.trim()).filter(Boolean);
}

/** The devcontainer fragments of these layers, each tagged with its layer id. */
export function devcontainerFragments(layers: readonly LayerDescriptor[]): { id: LayerId; fragment: DevcontainerFragment }[] {
  return layers.filter((entry) => entry.devcontainer).map((entry) => ({ id: entry.id, fragment: entry.devcontainer! }));
}

/** The `.gitignore` blocks these layers' tooling needs, in registry order. */
export function gitignoreBlocks(layers: readonly LayerDescriptor[]): GitignoreBlock[] {
  return layers.flatMap((entry) => entry.gitignore ?? []);
}

/** The doc-section flags these layers switch on. */
export function docSections(layers: readonly LayerDescriptor[]): Set<string> {
  return new Set(layers.flatMap((entry) => entry.docSections ?? [entry.id]));
}

// ── Claude Code plugins ────────────────────────────────────────────────────────────────────────────────────────

/** A marketplace the house knows how to declare (settings) and register (post-create). */
export interface Marketplace {
  /** GitHub `owner/repo` — both `extraKnownMarketplaces.<name>.source` and `claude plugin marketplace add` take it. */
  repo: string;
  autoUpdate?: boolean;
}

/**
 * Every marketplace a layer's `claudePlugins` may name. A plugin id naming any other marketplace is a bug in a
 * descriptor, and fails loudly here rather than as a settings entry Claude Code cannot resolve.
 */
export const MARKETPLACES: Readonly<Record<string, Marketplace>> = {
  'nx-claude-plugins': { repo: 'nrwl/nx-ai-agents-config' },
  'claude-toolkit': { repo: 'BeSpunky/claude-toolkit', autoUpdate: true },
};

export interface ClaudePlugins {
  /** `plugin@marketplace`, de-duplicated, in registry order. */
  plugins: string[];
  /** The marketplaces those plugins come from, in first-use order. */
  marketplaces: [string, Marketplace][];
}

/**
 * THE ONE PLUGIN LIST — `.claude/settings.json`'s `enabledPlugins` and the devcontainer's plugin pre-install are
 * both derived from it. They used to be two hand-kept lists, and they had already drifted
 * (`bespunky-communication` was enabled in settings and never pre-installed).
 */
export function claudePlugins(layers: readonly LayerDescriptor[]): ClaudePlugins {
  const plugins = [...new Set(layers.flatMap((entry) => entry.claudePlugins ?? []))];
  const marketplaces = new Map<string, Marketplace>();
  for (const plugin of plugins) {
    const name = plugin.split('@')[1];
    const known = name ? MARKETPLACES[name] : undefined;
    if (!known) {
      throw new Error(
        `[layers] plugin "${plugin}" names marketplace "${name ?? ''}", which the house does not know. ` +
          `Known: ${Object.keys(MARKETPLACES).join(', ')} (generators/_utils/layer-contributions.ts).`,
      );
    }
    marketplaces.set(name, known);
  }
  return { plugins, marketplaces: [...marketplaces] };
}
