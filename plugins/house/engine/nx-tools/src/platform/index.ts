// The platform boundary's public surface — see ./platform (the concept), ./externals (which packages are bound to
// one platform), ./imports (how imports are read), ./scopes (which files are judged, and as what), ./classify
// (inference), ./firewall (the ESLint rule).
import { type Tree, logger } from '@nx/devkit';
import { type Platform, setProjectPlatform, platformTag } from './platform';
import { type Classification, classifyWorkspace, violations } from './classify';
import { type PlatformExternals, tableExternals, withDeclared } from './externals';
import { workspaceStacksWith } from '../adapters/workspace';
import { readDeclaredBans } from './firewall';

export * from './platform';
export { matchesExternal, isNodeBuiltin, type PlatformExternals, type DeclaredBans } from './externals';
export { classifyWorkspace, holdsCode, isCodeProject, violations, type Classification, type Violation } from './classify';
export {
  insertPlatformFirewall,
  upgradePlatformFirewall,
  readDeclaredBans,
  hasPlatformFirewall,
  firewallSnippet,
  bannedFor,
  guidance,
  RULE as PLATFORM_RULE,
  type FirewallUpgrade,
} from './firewall';
export { scopeOf, type FileScope } from './scopes';
export { registerPlatformSync, PLATFORM_SYNC } from './sync';

/** The root flat ESLint config the firewall lives in. */
export const FIREWALL_CONFIG = 'eslint.config.mjs';

/**
 * The platform-bound packages as THIS workspace declares them: the table (./externals), plus whatever the project's
 * own firewall bans — so the classifier never calls a project `shared` that the config's own lists then fail.
 */
export function platformExternals(tree: Tree): PlatformExternals {
  // Each stack names its own framework (Angular: `@angular/*`) — the same list it hands the server firewall.
  const table = tableExternals(workspaceStacksWith(tree, 'firebase').flatMap((stack) => stack.firebase.serverBannedImports));
  if (!tree.exists(FIREWALL_CONFIG)) return table;
  return withDeclared(table, readDeclaredBans(tree.read(FIREWALL_CONFIG, 'utf8') ?? '', FIREWALL_CONFIG));
}

/** The one-line command that classifies a project, as this repo runs Nx. */
export const platformCommand = (nx: string, project: string, platform?: Platform | string): string =>
  `${nx} g @bespunky/nx-tools:platform ${project}${platform ? ` --platform=${platform}` : ''}`;

export interface ClassifyReport {
  tagged: Array<{ project: string; platform: Platform }>;
  /** Code projects left without a platform: mixed, or nothing binds them to one — each reported with the command. */
  unresolved: string[];
}

/** Why a project was left without a platform, as one sentence. */
export function unresolvedReason(entry: Classification): string {
  if (entry.platform === null) return `it mixes web and server code — ${entry.evidence.join('; ')}`;
  return entry.evidence.length
    ? `its evidence does not settle a platform — ${entry.evidence.join('; ')}`
    : `nothing in it binds it to a platform — and that is the absence of evidence, not proof it runs anywhere`;
}

/**
 * Classify every code project that carries no `platform:` tag — the act that makes a firewall arriving over existing
 * projects truthful. Tags each one the evidence (or, for an application, its stack) settles, and REPORTS: every
 * inference with its reason, every project it could not place with the command that states its platform, every
 * application import lint will flag, and every existing dependency the firewall fails on — with what to do. Tooling
 * (no code a product runs — ./classify) is left untagged.
 */
export function classifyUntaggedProjects(tree: Tree, options: { who: string; nx: string; externals: PlatformExternals }): ClassifyReport {
  const { who, nx, externals } = options;
  const classified = classifyWorkspace(tree, externals);
  const report: ClassifyReport = { tagged: [], unresolved: [] };
  const wrong = (project: string) => platformCommand(nx, project, '<web|server|shared>');
  for (const entry of [...classified.values()].sort((a, b) => a.project.localeCompare(b.project))) {
    if (entry.declared || entry.basis === 'tooling') continue;
    if (!entry.platform) {
      report.unresolved.push(entry.project);
      logger.warn(
        `[${who}] Left \`${entry.project}\` without a platform: ${unresolvedReason(entry)}. Until it has one, lint fails every ` +
          `tagged project that imports it. ${entry.platform === null ? 'Split it, or state its platform' : 'State it'}: ${wrong(entry.project)}`,
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
    logger.info(`[${who}] Classified \`${entry.project}\` ${platformTag(entry.platform)} — ${entry.evidence.join('; ')}. Wrong? ${wrong(entry.project)}`);
    if (entry.conflicts.length) {
      logger.warn(
        `[${who}] \`${entry.project}\` runs as ${platformTag(entry.platform)}, but ${entry.conflicts.join('; ')} — lint reports these. Move that code ` +
          `into a project of its platform (an SSR app's server code belongs in src/server.ts or src/server/**, which the firewall treats as server code).`,
      );
    }
  }
  for (const leak of violations(classified)) {
    const target = leak.dependencyPlatform ? platformTag(leak.dependencyPlatform) : 'no platform';
    logger.warn(
      `[${who}] \`${leak.project}\` (${platformTag(leak.platform)}) imports \`${leak.dependency}\` (${target}) — the platform firewall ` +
        `fails lint there. ${leak.dependencyPlatform ? `Move what ${leak.project} needs into a ${leak.platform === 'shared' ? 'shared' : `${leak.platform} or shared`} library, or re-classify one of them` : `Classify ${leak.dependency}`} ` +
        `(${wrong(leak.dependencyPlatform ? '<project>' : leak.dependency)}).`,
    );
  }
  return report;
}
