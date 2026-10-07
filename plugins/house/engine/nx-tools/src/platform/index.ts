// The platform boundary's public surface — see ./platform (the concept), ./externals (which packages are bound to
// one platform), ./classify (inference), ./firewall (the ESLint constraints).
import { type Tree, logger } from '@nx/devkit';
import { type Platform, setProjectPlatform, platformTag } from './platform';
import { classifyWorkspace, violations } from './classify';
import type { PlatformExternals } from './externals';

export * from './platform';
export { platformExternals, matchesExternal, type PlatformExternals } from './externals';
export { classifyWorkspace, violations, type Classification, type Violation } from './classify';
export { insertPlatformFirewall, upgradePlatformFirewall, firewallBlock, bannedFor, guidance, type FirewallUpgrade } from './firewall';

/** The one-line command that classifies a project, as this repo runs Nx. */
export const platformCommand = (nx: string, project: string, platform?: Platform | string): string =>
  `${nx} g @bespunky/nx-tools:platform ${project}${platform ? ` --platform=${platform}` : ''}`;

export interface ClassifyReport {
  tagged: Array<{ project: string; platform: Platform }>;
  unresolved: string[];
}

/**
 * Classify every project that carries no `platform:` tag — the act that makes a firewall arriving over existing
 * projects truthful. Tags each one the evidence settles, and REPORTS: every inference with its reason, every
 * project it could not classify with the command that states its platform, and every existing dependency the
 * firewall forbids (the leaks it was blind to before), with what to do about it.
 */
export function classifyUntaggedProjects(tree: Tree, options: { who: string; nx: string; externals: PlatformExternals }): ClassifyReport {
  const { who, nx, externals } = options;
  const classified = classifyWorkspace(tree, externals);
  const report: ClassifyReport = { tagged: [], unresolved: [] };
  for (const entry of [...classified.values()].sort((a, b) => a.project.localeCompare(b.project))) {
    if (entry.declared) continue;
    if (entry.platform === null) {
      report.unresolved.push(entry.project);
      logger.warn(
        `[${who}] Could not classify \`${entry.project}\`: it mixes web and server code — ${entry.evidence.join('; ')}. ` +
          `Split it, or state its platform: ${platformCommand(nx, entry.project, '<web|server|shared>')}`,
      );
      continue;
    }
    try {
      setProjectPlatform(tree, entry.project, entry.platform);
    } catch (error) {
      report.unresolved.push(entry.project);
      logger.warn(`[${who}] Could not tag \`${entry.project}\` ${platformTag(entry.platform)}: ${(error as Error).message} Add the tag where the project is defined.`);
      continue;
    }
    report.tagged.push({ project: entry.project, platform: entry.platform });
    const why = entry.evidence.length ? entry.evidence.join('; ') : 'nothing in it is bound to a platform';
    logger.info(
      `[${who}] Classified \`${entry.project}\` ${platformTag(entry.platform)} — ${why}. ` +
        `Wrong? ${platformCommand(nx, entry.project, '<web|server|shared>')}`,
    );
  }
  for (const leak of violations(classified)) {
    logger.warn(
      `[${who}] \`${leak.project}\` (${platformTag(leak.platform)}) imports \`${leak.dependency}\` (${platformTag(leak.dependencyPlatform)}) — ` +
        `the platform firewall now fails lint there. Move what ${leak.project} needs into a ${leak.platform === 'shared' ? 'shared' : `${leak.platform} or shared`} ` +
        `library, or re-classify one of them (${platformCommand(nx, '<project>', '<web|server|shared>')}).`,
    );
  }
  return report;
}
