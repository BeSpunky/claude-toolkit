// 0.50.0 — close the platform firewall: every project classified, every platform held to its own and shared code.
//
// WHAT CHANGED. Up to 0.49 the firewall firebase-emulators wrote into eslint.config.mjs was two
// `bannedExternalImports` lists, keyed on `platform:web` and `platform:server`. A constraint applies to the
// IMPORTING project's own source, so an UNTAGGED library matched neither: it could import firebase-admin, and a
// web app importing it carried firebase-admin into its bundle with lint passing. From 0.50.0 the firewall fails
// closed (src/platform/firewall): web and server may depend only on their own and `platform:shared` projects,
// shared only on shared, and shared bans every platform-bound package.
//
// WHAT IT DOES, only where the old firewall exists (a workspace without one has no enforcer, and the firewall
// classifies the workspace itself when firebase-emulators first writes it):
//   1. Upgrades the constraints in place: `onlyDependOnLibsWithTags` on each, a `platform:shared` constraint
//      banning the UNION of the bans the project already declares (its own additions kept), and the old comment
//      replaced by the guidance — what each platform means and the one command that fixes a violation.
//   2. Classifies every project without a `platform:` tag, from evidence only (src/platform/classify: the stack
//      that builds it, its imports of platform-bound packages, the platforms of the projects it imports). Each
//      inference is reported with its reason; each project it cannot classify (it mixes web and server) is reported
//      with the command that states its platform. Nothing is guessed: a mixed project stays untagged and lint names it.
//   3. Reports every existing dependency the closed firewall now fails on — the leaks it used to be blind to.
//
// Idempotent: a current firewall is left as it is, and only untagged projects are ever classified.
import { type Tree, logger } from '@nx/devkit';
import { nxInvocation } from '../../generators/_utils/nx-host';
import { classifyUntaggedProjects, platformExternals, upgradePlatformFirewall } from '../../platform';

const WHO = '0.50.0/close-the-platform-firewall';
const ESLINT_CONFIG = 'eslint.config.mjs';

export default async function closeThePlatformFirewall(tree: Tree): Promise<void> {
  if (!tree.exists('nx.json') || !tree.exists(ESLINT_CONFIG)) return;
  const source = tree.read(ESLINT_CONFIG, 'utf8') ?? '';
  if (!source.includes('platform:')) return;

  const nx = nxInvocation(tree).command;
  const externals = platformExternals(tree);
  const upgrade = upgradePlatformFirewall(source, ESLINT_CONFIG, externals, nx);
  if (!upgrade) {
    logger.warn(
      `[${WHO}] ${ESLINT_CONFIG} mentions \`platform:\` but carries no platform constraint in a \`depConstraints\` array this ` +
        `migration can read, so the firewall was not tightened. Each platform constraint needs onlyDependOnLibsWithTags ` +
        `(web → web|shared, server → server|shared, shared → shared) and a platform:shared constraint banning every ` +
        `platform-bound package.`,
    );
    return;
  }
  if (upgrade.changes.length) {
    tree.write(ESLINT_CONFIG, upgrade.source);
    for (const change of upgrade.changes) logger.info(`[${WHO}] ${ESLINT_CONFIG}: ${change}.`);
  }
  classifyUntaggedProjects(tree, { who: WHO, nx, externals });
}
