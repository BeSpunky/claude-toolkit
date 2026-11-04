// 0.52.0 — an existing platform firewall learns the Postgres drivers: banned from platform:web and platform:shared.
//
// WHY A RUNG. The firewall in eslint.config.mjs is project state: `ensurePlatformFirewall` writes it once and never
// again, so a table change (src/platform/externals) reaches only workspaces gaining a firewall. A project already
// carrying one would keep a list without `pg`, and a driver in a browser bundle would pass lint.
//
// ONLY THE 0.50–0.51 SHAPE NEEDS IT. A project still on the 0.49 shape gets the drivers from the rung before this one:
// 0.50.0/close-the-platform-firewall writes the LIVE table, so here it finds nothing missing. That 0.49 shape left
// behind because that rung refused it is reported, not edited: its model has no platform:shared to ban them from.
//
// THE LIST IS FROZEN, per the migrations rule (_utils/versions.ts): this is what 0.52.0 writes, whatever the table
// becomes. tools/test-generators (platform-firewall-seam) holds the table to the toolkit's released lists plus these,
// so a table that moves without a rung of its own goes red.
//
// ADDITIVE. Only what no entry already covers is added, in the list's own style; what the project added or removed
// stays. A project whose firewall dropped a constraint, or computes its list, is told what was not added.
// platform:server is untouched: the server is where the drivers belong.
import { type Tree, logger } from '@nx/devkit';
import { FIREWALL_CONFIG, addFirewallBans, hasPlatformFirewall } from '../../platform';

const WHO = '0.52.0/ban-postgres-drivers-from-web';

export const DRIVER_BANS = [
  'pg', 'pg/*',
  'pg-native', 'pg-native/*',
  'pg-pool', 'pg-pool/*',
  'pg-cursor', 'pg-cursor/*',
  'pg-query-stream', 'pg-query-stream/*',
  'pg-promise', 'pg-promise/*',
  'postgres', 'postgres/*',
  'slonik', 'slonik/*',
] as const;

export default async function banPostgresDriversFromWeb(tree: Tree): Promise<void> {
  if (!tree.exists(FIREWALL_CONFIG)) return;
  const source = tree.read(FIREWALL_CONFIG, 'utf8') ?? '';
  if (!hasPlatformFirewall(source)) {
    if (source.includes('platform:')) {
      logger.warn(
        `[${WHO}] ${FIREWALL_CONFIG} mentions \`platform:\` but carries no \`platformConstraints\`, so the Postgres drivers were not banned. ` +
          `If it is a platform firewall, ban these from its web and shared projects: ${DRIVER_BANS.join(', ')}.`,
      );
    }
    return;
  }

  const edit = addFirewallBans(source, FIREWALL_CONFIG, { web: DRIVER_BANS, shared: DRIVER_BANS });
  if ('refused' in edit) {
    logger.warn(`[${WHO}] ${FIREWALL_CONFIG} was left as it is: ${edit.refused}. Ban these from platform:web and platform:shared by hand: ${DRIVER_BANS.join(', ')}.`);
    return;
  }
  for (const note of edit.notes) logger.warn(`[${WHO}] ${FIREWALL_CONFIG}: ${note}.`);
  if (!edit.changes.length) return;

  tree.write(FIREWALL_CONFIG, edit.source);
  for (const change of edit.changes) logger.info(`[${WHO}] ${FIREWALL_CONFIG}: ${change}.`);
  logger.warn(
    `[${WHO}] If lint now fails with "… is not allowed to import" one of these, that is a real leak, not a false alarm: these drivers open a TCP ` +
      `connection with credentials and have no browser build. Move the code into a platform:server project, or re-classify the project. Do not widen the list.`,
  );
}
