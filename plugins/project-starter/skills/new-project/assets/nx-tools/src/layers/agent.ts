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
        // The devcontainer is COMPOSED from the active layers' fragments (descriptor.devcontainer), so it is
        // handed the layer set — never a flag per layer. Passed rather than re-detected because a run knows
        // what it is about to ENSURE before the tree reflects it (the same reason house-doc takes --layers).
        args: (ctx) => [
          `--name=${ctx.project}`,
          `--nodeMajor=${ctx.nodeMajor}`,
          `--layers=${[...ctx.active].join(',')}`,
          ...(wantsVoice(ctx) ? ['--voice=true'] : []),
        ],
      },
      { generator: 'claude-settings', args: (ctx) => [`--layers=${[...ctx.active].join(',')}`] },
      // Runs BEFORE the design system, so at scaffold time the colour is a stable hash of the project name;
      // it upgrades to the brand colour later (the window-identity ratchet never downgrades it).
      { generator: 'window-identity', args: (ctx) => [`--name=${ctx.project}`] },
    ],
  },
  docSections: ['agent'],
  devcontainer: {
    // THE NEUTRAL BASE. A repo with no stack layer that brings its own image (no package.json → no `node`)
    // still needs Node at RUNTIME — the Nx floor runs on it, and so does the house tooling (`./nx`, the hooks,
    // the generators) — but it is not a Node project, so Node arrives as a FEATURE on a plain Debian base
    // rather than as the image's identity. A stack layer replaces this image (and this Node feature with it).
    image: {
      ref: 'mcr.microsoft.com/devcontainers/base:debian',
      remoteUser: 'vscode',
      features: [{ id: 'ghcr.io/devcontainers/features/node:1', options: { version: '{{nodeMajor}}' } }],
      why: 'A neutral base: this repo brings no stack image. Node comes as a feature — the Nx floor and the house tooling run on it.',
    },
    features: [{ id: 'ghcr.io/devcontainers-extra/features/claude-code' }, { id: 'ghcr.io/devcontainers/features/github-cli' }],
    extensions: [
      'Anthropic.claude-code',
      'EditorConfig.EditorConfig',
      'eamodio.gitlens',
      'GitHub.vscode-github-actions',
      'christian-kohler.path-intellisense',
      'usernamehw.errorlens',
    ],
    settings: [
      {
        key: 'editor.formatOnSave',
        value: false,
        why:
          "Claude's permission posture is set once in .claude/settings.json (permissions.defaultMode: \"auto\")\n" +
          '— deliberately NOT a blanket skip here. "auto" gives frictionless auto-approval WITH the background\n' +
          'safety classifier, the right default even in an isolated container.',
      },
      { key: 'files.associations', value: { '*.mdc': 'markdown' } },
    ],
    mounts: [
      {
        mount: 'source=${localWorkspaceFolder}/.claude/data,target={{home}}/.claude,type=bind,consistency=cached',
        why: "Claude Code's state, persisted across container rebuilds (the target follows the image's user).",
      },
    ],
    osPackages: [
      {
        packages: ['tmux'],
        why:
          'Durable shells. A tmux session outlives the client attached to it — the ONLY way an interactive shell\n' +
          'opened into this container from the outside survives its opener restarting (the Docker Engine API cannot\n' +
          're-attach to an exec). No config is written on purpose: presence on PATH is the whole contract.',
      },
      { packages: ['curl'], why: 'General utilities the house tooling shells out to.' },
    ],
    postCreate: [{ phase: 'plugins', piece: 'claude-plugins' }],
  },
  // The house plugins every agent-DX project carries. The stack-specific ones arrive with their layers
  // (`nx`, `web`, `angular`, `design-system`).
  claudePlugins: [
    'bespunky@claude-toolkit',
    'bespunky-project-starter@claude-toolkit',
    'bespunky-engineering@claude-toolkit',
    'bespunky-workflow@claude-toolkit',
    'bespunky-product-ux@claude-toolkit',
    'bespunky-vscode-identity@claude-toolkit',
    'bespunky-communication@claude-toolkit',
  ],
  gitignore: [{ heading: 'Claude Code local state', entries: ['.claude/data/'] }],
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
