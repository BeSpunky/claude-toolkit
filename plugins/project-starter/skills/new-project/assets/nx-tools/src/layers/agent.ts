// `agent` — the stack-agnostic house DX: devcontainer, Claude settings, window identity.
//
// REQUIRES NOTHING at the registry level (DECISION re-cut). It used to require `nx` because its generators
// run through `nx g` — a dependency of the DELIVERY MECHANISM, not of the layer. Nx is still underneath every
// run, but as the always-ensured floor, not as something this layer claims to need.
//
// DETECTED BY ITS OWN ARTIFACTS, not by HOUSE.md. HOUSE.md used to be the marker, back when only this layer
// wrote it. `house-doc` has since become ungated (it runs on every sync, as the stamp), and the floor is now
// ensured on every sync — so HOUSE.md proves "the house has been here", not "this project wanted the agent
// DX". Detecting on it would make the layer opt-OUT: the first plain sync writes HOUSE.md, and the second one
// detects `agent` and writes a devcontainer nobody asked for. The devcontainer's marker is written on BOTH the
// owned and the adopted path and is committed; the window-identity marker is the second witness.
import type { LayerDescriptor, PlanContext } from './descriptor';

const DEVCONTAINER_MARKER = '.devcontainer/.bespunky-devcontainer.json';

export const agent: LayerDescriptor = {
  id: 'agent',
  title: 'Agent DX (Claude settings, devcontainer, window identity)',
  requires: [],
  evidence: { files: [DEVCONTAINER_MARKER, '.vscode/.window-identity.json'] },
  ensurable: { scaffold: true, sync: true },
  ensureHint: '`scaffold.sh --sync --ensure=agent <project>`',
  brings: 'the devcontainer, the Claude settings and the window identity',
  generators: {
    workspace: [
      {
        generator: 'devcontainer',
        // Every layer flag is passed EXPLICITLY, the false cases included: the generator defaults `web` to
        // true (the common shape), so omitting it on a library-only repo would forward :80 and mount the
        // shared-browser volumes into a container with nothing to serve. Phase 2 replaces these three flags
        // with per-layer devcontainer FRAGMENTS (descriptor.devcontainer).
        args: (ctx) => [
          `--name=${ctx.project}`,
          `--nodeMajor=${ctx.nodeMajor}`,
          `--web=${ctx.active.has('web')}`,
          `--angular=${ctx.active.has('angular')}`,
          `--firebase=${ctx.active.has('firebase')}`,
          ...(wantsVoice(ctx) ? ['--voice=true'] : []),
        ],
      },
      { generator: 'claude-settings' },
      // Runs BEFORE the design system, so at scaffold time the colour is a stable hash of the project name;
      // it upgrades to the brand colour later (the window-identity ratchet never downgrades it).
      { generator: 'window-identity', args: (ctx) => [`--name=${ctx.project}`] },
    ],
  },
  docSections: ['agent'],
};

/**
 * Voice has no layer to detect — nothing it installs leaves a trace in the workspace. Its previous answer
 * lives in the devcontainer's own ownership marker, so it is carried forward rather than silently revoked;
 * an explicit --voice on this run still wins. The answer is the project's INTENT ("this project wants
 * audio"); where the socket lives is resolved per machine when the container opens.
 */
function wantsVoice(ctx: PlanContext): boolean {
  if (ctx.voice) return true;
  const marker = ctx.tree.read(DEVCONTAINER_MARKER, 'utf8');
  return marker ? /"voice"\s*:\s*true/.test(marker) : false;
}
