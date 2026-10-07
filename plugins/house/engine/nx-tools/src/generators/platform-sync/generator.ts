// House SYNC generator: every project created since the firewall arrived is classified before lint judges it.
//
// WHY. The firewall fails closed (src/platform/firewall): a project with no `platform:` tag may not be imported by a
// tagged one, and may itself import no workspace project. The house's own generators tag what they create
// (`app`, `publishable-lib`), but `nx g @nx/js:lib` — or any generator that is not the house's — writes no tag, so
// the developer's first sight of the new library would be Nx's fixed lint text. This generator closes that gap the
// way Nx means sync generators to: it runs before every `lint` task (registered on `targetDefaults.<lint>.
// syncGenerators` — src/platform/sync), Nx offers to apply what it would change, and `nx sync:check` fails CI while
// a project it CAN classify is still untagged.
//
// What it tags is exactly what the classifier settles — an application by its stack, a library by its evidence —
// and nothing else: a project that mixes web and server, or that nothing binds to a platform, is left for a human
// (`nx g @bespunky/nx-tools:platform <project> --platform=…`), and lint names it until then. Only the sources of
// UNTAGGED projects are read, so a workspace where everything is classified pays for a project list and no more.
import type { Tree } from '@nx/devkit';
import { FIREWALL_CONFIG, classifyWorkspace, hasPlatformFirewall, platformExternals, platformTag, setProjectPlatform } from '../../platform';

/** Nx's sync-generator contract (nx `SyncGeneratorResult`, not re-exported by @nx/devkit): nothing, or what is out of sync. */
type SyncGeneratorResult = void | { outOfSyncMessage?: string };

export default async function platformSyncGenerator(tree: Tree): Promise<SyncGeneratorResult> {
  if (!tree.exists(FIREWALL_CONFIG) || !hasPlatformFirewall(tree.read(FIREWALL_CONFIG, 'utf8') ?? '')) return;
  const tagged: string[] = [];
  for (const entry of classifyWorkspace(tree, platformExternals(tree), { read: 'untagged' }).values()) {
    if (entry.declared || !entry.platform || (entry.basis !== 'stack' && entry.basis !== 'evidence')) continue;
    if (setProjectPlatform(tree, entry.project, entry.platform)) tagged.push(`${entry.project} → ${platformTag(entry.platform)} (${entry.evidence.join('; ')})`);
  }
  if (!tagged.length) return;
  return {
    outOfSyncMessage:
      `${tagged.length === 1 ? 'A project has' : 'Projects have'} no platform tag, and the platform firewall's evidence settles it: ${tagged.join(', ')}. ` +
      `Apply with \`nx sync\`.`,
  };
}
