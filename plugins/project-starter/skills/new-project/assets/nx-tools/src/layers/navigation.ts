// `navigation` — typed reactive navigation. Angular-only, correctly. Its generators are on-demand
// (navigation-core, domain-navigation), so a sync runs nothing for it; the layer exists so HOUSE.md gains
// the typed-navigation conventions and the stamp records it.
import type { LayerDescriptor } from './descriptor';

export const navigation: LayerDescriptor = {
  id: 'navigation',
  title: 'Typed reactive navigation',
  requires: ['angular'],
  evidence: { projects: ['navigation-core'] },
  ensurable: { scaffold: false, sync: false },
  ensureHint: '`nx g @bespunky/nx-tools:navigation-core`',
  brings: 'nothing per-sync (its generators are on-demand), but HOUSE.md gains the typed-navigation conventions',
  docSections: ['navigation'],
};
