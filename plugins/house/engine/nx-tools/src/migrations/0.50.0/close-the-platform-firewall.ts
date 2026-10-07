// 0.50.0 — close the platform firewall: every code project classified, every platform held to its own and shared
// code, in the workspace's own module-boundaries rule.
//
// WHAT CHANGED. Up to 0.49 the firewall firebase-emulators wrote into eslint.config.mjs was two
// `bannedExternalImports` lists, keyed on `platform:web` and `platform:server`, inside the project's own
// `@nx/enforce-module-boundaries` constraints. A constraint applies to the IMPORTING project's own source, so an
// UNTAGGED library matched neither: it could import firebase-admin, and a web app importing it carried firebase-admin
// into its bundle with lint passing. From 0.50.0 the firewall fails closed (src/platform/firewall): web and server
// may depend only on their own and `platform:shared` projects, shared only on shared, shared bans every
// platform-bound package, an untagged project may import no workspace project — and tests, tool configs and the
// server half of an SSR web app are scoped. It is still ONE rule instance, the project's own.
//
// WHAT IT DOES, only where the old firewall exists (a workspace without one has no enforcer, and the firewall
// classifies the workspace itself when firebase-emulators first writes it):
//   1. Rewrites the firewall in place: the two old constraints and their comment (every shipped wording) are
//      removed, `platformConstraints` is written, and the project's own options for the rule are hoisted into
//      `moduleBoundaryOptions` — every exemption it wrote (`allow`, `ignoredCircularDependencies`, …) moves with
//      them, verbatim, and so holds in every block — with the entry becoming `moduleBoundaries(platformConstraints)`
//      and the file-scoped blocks appended. Nx's stock catch-all constraint is removed (it only exempted untagged
//      projects; reported). The project's own edits to the old ban lists are carried — what it added stays banned,
//      what it removed stays allowed — and anything else it gave those constraints is reported, not guessed at.
//   2. Registers the platform sync generator as a global sync generator (generators/platform-sync), so `nx sync`
//      classifies a project created later — never before a task, which would stop a non-interactive run.
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
    if (!upgrade || 'refused' in upgrade) {
      logger.warn(
        `[${WHO}] ${FIREWALL_CONFIG} mentions \`platform:\` but the firewall was not upgraded: ` +
          `${upgrade ? upgrade.refused : 'it carries no platform constraint this migration can read (inside a `depConstraints` array)'}. ` +
          `Replace the old platform constraints with:\n${firewallSnippet(platformExternals(tree), nx)}`,
      );
      return;
    }
    tree.write(FIREWALL_CONFIG, upgrade.source);
    for (const change of upgrade.changes) logger.info(`[${WHO}] ${FIREWALL_CONFIG}: ${change}.`);
    for (const note of upgrade.notes) logger.warn(`[${WHO}] ${FIREWALL_CONFIG}: ${note}.`);
  }
  if (registerPlatformSync(tree)) {
    logger.info(`[${WHO}] nx.json: the platform sync generator is a global one — \`${nx} sync\` classifies every project made later whose evidence settles it.`);
  }
  // Read AFTER the upgrade: the externals now include whatever the project's own firewall bans.
  classifyUntaggedProjects(tree, { who: WHO, nx, externals: platformExternals(tree) });
}
