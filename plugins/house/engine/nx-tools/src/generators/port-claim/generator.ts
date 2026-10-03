// House generator: host-port arbitration — tools/port-claim/ — the registry every house tool that wants a
// HOST port consults.
//
// Three tools contend for host ports and must agree on who holds them: the shared browser (allocates its noVNC
// port from a band), the worktree-domains proxy (advises on the single-owner :80), and the dev engine (advises
// on an app's base port, the one an OAuth origin may be registered on). It used to live inside
// tools/shared-browser/, which made the other two depend on a SIBLING's private file. It has its own home now,
// written once per workspace for the web layer, before the tools that consult it.
//
// Owned (class A): rewritten on every sync. `node --test tools/port-claim/` runs its suite — including a
// multi-process race, because the failure it prevents cannot be reproduced with a single container.
import { type Tree, formatFiles } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOVNC_BAND_SIZE, NOVNC_BAND_START } from '../shared-browser/novnc-band';

export const PORT_CLAIM_ROOT = 'tools/port-claim';

type PortClaimSchema = Record<string, never>;

export default async function portClaimGenerator(tree: Tree, _options: PortClaimSchema = {}): Promise<void> {
  // The band defaults come from ./novnc-band — the module the devcontainer generator reads for its
  // portsAttributes too, so the registry's band and the editor's requireLocalPort coverage cannot drift.
  const template = (name: string) =>
    readFileSync(join(__dirname, name), 'utf8')
      .split('{{novncBandStart}}')
      .join(String(NOVNC_BAND_START))
      .split('{{novncBandSize}}')
      .join(String(NOVNC_BAND_SIZE));
  tree.write(`${PORT_CLAIM_ROOT}/port-claim.mjs`, template('port-claim.mjs.tpl'), { mode: 0o755 });
  tree.write(`${PORT_CLAIM_ROOT}/port-claim.test.mjs`, template('port-claim.test.mjs.tpl'));
  await formatFiles(tree);
}
