// `navigation` — typed reactive navigation. Angular-only, correctly (the kernel vendors navigation-x, which
// wraps Angular's Router). Its generators are on-demand (navigation-core, domain-navigation), so a sync runs
// nothing for it; the layer exists so HOUSE.md gains the typed-navigation conventions and the stamp records it.
//
// Detected by the `type:navigation` TAG — the same idiom as the design system's `type:design-system`: the tag
// travels with the library through any rename or move, where a hard-coded project name (`navigation-core`) did
// not. `navigation-core` creates its library with the tag; migration 0.35.0/tag-navigation-library tags the
// libraries earlier toolkits produced.
import type { LayerDescriptor } from './descriptor';

/** The Nx tag that marks the workspace's navigation kernel. */
export const NAVIGATION_TAG = 'type:navigation';

export const navigation: LayerDescriptor = {
  id: 'navigation',
  title: 'Typed reactive navigation',
  requires: ['angular'],
  evidence: { tags: [NAVIGATION_TAG] },
  ensurable: { new: false, upgrade: false },
  ensureHint: '`nx g @bespunky/nx-tools:navigation-core`',
  brings: 'nothing per-sync (its generators are on-demand), but HOUSE.md gains the typed-navigation conventions',
  docSections: ['navigation'],
};
