// 0.50.0 — close the platform firewall: its own rule, every code project classified, every platform held to its own
// and shared code.
//
// WHAT CHANGED. Up to 0.49 the firewall firebase-emulators wrote into eslint.config.mjs was two
// `bannedExternalImports` lists, keyed on `platform:web` and `platform:server`, inside the project's own
// `@nx/enforce-module-boundaries` constraints. A constraint applies to the IMPORTING project's own source, so an
// UNTAGGED library matched neither: it could import firebase-admin, and a web app importing it carried firebase-admin
// into its bundle with lint passing. From 0.50.0 the firewall fails closed and is its OWN rule instance,
// `platform/enforce-module-boundaries` (src/platform/firewall): web and server may depend only on their own and
// `platform:shared` projects, shared only on shared, shared bans every platform-bound package, an untagged project
// may import no workspace project — and tests, tool configs and the server half of an SSR web app are scoped.
//
// WHAT IT DOES, only where the old firewall exists (a workspace without one has no enforcer, and the firewall
// classifies the workspace itself when firebase-emulators first writes it):
//   1. Moves the firewall out of the project's rule: the two old constraints and their comment (every shipped
//      wording) are removed, and `platformConstraints` + the firewall's blocks are written. The project's own edits
//      to the old ban lists are carried — what it added stays banned, what it removed stays allowed — and anything
//      else it gave those constraints is reported, not guessed at.
//   2. Registers the platform sync generator on the lint target (generators/platform-sync), so a project created
//      later is classified before lint judges it.
//   3. Classifies every untagged CODE project from evidence only (src/platform/classify): an application by its
//      stack, a library by its imports and the projects it imports. Each inference is reported with its reason; each
//      project nothing settles (it mixes web and server, or nothing binds it to a platform) is reported with the
//      command that states its platform and left untagged — `shared` is never inferred from an absence of evidence.
//      Tooling (no code a product runs) is left alone.
//   4. Reports every existing dependency the closed firewall now fails on — the leaks it used to be blind to.
//
// Idempotent: a config already carrying the firewall is not rewritten, and only untagged projects are classified.
import { type Tree, logger } from '@nx/devkit';
import { nxInvocation } from '../../generators/_utils/nx-host';
import {
  FIREWALL_CONFIG,
  PLATFORM_RULE,
  classifyUntaggedProjects,
  firewallSnippet,
  hasPlatformFirewall,
  platformExternals,
  registerPlatformSync,
  upgradePlatformFirewall,
} from '../../platform';

const WHO = '0.50.0/close-the-platform-firewall';

export default async function closeThePlatformFirewall(tree: Tree): Promise<void> {
  if (!tree.exists('nx.json') || !tree.exists(FIREWALL_CONFIG)) return;
  const source = tree.read(FIREWALL_CONFIG, 'utf8') ?? '';
  if (!source.includes('platform:')) return;

  const nx = nxInvocation(tree).command;
  if (!hasPlatformFirewall(source)) {
    const upgrade = upgradePlatformFirewall(source, FIREWALL_CONFIG, platformExternals(tree), nx);
    if (!upgrade) {
      logger.warn(
        `[${WHO}] ${FIREWALL_CONFIG} mentions \`platform:\` but carries no platform constraint this migration can read (inside a ` +
          `\`depConstraints\` array, with an \`export default [ … ]\` to extend), so the firewall was not upgraded. Replace the ` +
          `old platform constraints with:\n${firewallSnippet(platformExternals(tree), nx)}`,
      );
      return;
    }
    tree.write(FIREWALL_CONFIG, upgrade.source);
    for (const change of upgrade.changes) logger.info(`[${WHO}] ${FIREWALL_CONFIG}: ${change}.`);
    for (const note of upgrade.notes) logger.warn(`[${WHO}] ${FIREWALL_CONFIG}: ${note}.`);
  }
  const target = registerPlatformSync(tree);
  if (target) logger.info(`[${WHO}] nx.json: \`${target}\` now runs the platform sync generator first — a new project is classified before ${PLATFORM_RULE} judges it.`);
  // Read AFTER the upgrade: the externals now include whatever the project's own firewall bans.
  classifyUntaggedProjects(tree, { who: WHO, nx, externals: platformExternals(tree) });
}
