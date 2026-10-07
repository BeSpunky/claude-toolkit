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
  ensurable: { new: true, upgrade: true },
  ensureHint: '`house.sh add-layer agent <project>`',
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
    // NO claude-code feature. It installed a SECOND Claude Code at build time (/usr/local/bin, early on PATH)
    // that shadowed the one `claude update` and the background auto-updater manage (~/.local/bin, late on PATH):
    // every update reported success and changed nothing, freezing the container at its build-day version. Claude
    // Code is installed ONCE, natively, by the `claude-code` post-create piece — the install the updater owns —
    // and its directory is put first on PATH so no other copy can shadow it. `{{home}}`, the composer's token for
    // the user the container runs as — NOT `${containerEnv:HOME}`: a container's environment carries no HOME (it
    // is set per user at login), so that variable resolved empty and the entry came out as `/.local/bin`.
    // (Its permission posture is set once in .claude/settings.json — permissions.defaultMode: "auto".)
    path: [
      {
        dir: '{{home}}/.local/bin',
        why:
          'the native Claude Code install, first — the copy `claude update` and the auto-updater keep current, so\n' +
          'no other `claude` (an image\'s, a feature\'s) can shadow it.',
      },
    ],
    features: [
      { id: 'ghcr.io/devcontainers/features/github-cli' },
    ],
    extensions: [
      'Anthropic.claude-code',
      'EditorConfig.EditorConfig',
      'eamodio.gitlens',
      'GitHub.vscode-github-actions',
      'christian-kohler.path-intellisense',
      'usernamehw.errorlens',
    ],
    settings: [
      { key: 'editor.formatOnSave', value: false },
      { key: 'files.associations', value: { '*.mdc': 'markdown' } },
    ],
    mounts: [
      {
        mount: 'source=${localWorkspaceFolder}/.claude/data,target={{home}}/.claude,type=bind,consistency=cached',
        why: "Claude Code's state, persisted across container rebuilds (the target follows the image's user).",
      },
      {
        mount: 'source=${localWorkspaceFolderBasename}-config,target={{home}}/.config,type=volume',
        why:
          "The user's config home (XDG), persisted across container rebuilds — so every tool that keeps its login\n" +
          'there (gh, firebase, gcloud, …) is logged in once per project, not once per rebuild. ONE mount for the\n' +
          'whole directory, never one per tool. git rides on the gh login (the `gh-git-credentials` piece).',
      },
      {
        mount: 'source=${localWorkspaceFolderBasename}-local,target={{home}}/.local,type=volume',
        onHouseImageOnly: true,
        why:
          "The user's local install home (XDG data, state and bin), persisted across container rebuilds — so the native\n" +
          'Claude Code (~/.local/bin, kept current by its own updater) and anything else installed per user is not\n' +
          'downloaded again on every rebuild. Deliberately NOT baked into the image: a cached layer would hand back the\n' +
          'build-day version.',
      },
      {
        mount: 'source=${localWorkspaceFolderBasename}-cache,target={{home}}/.cache,type=volume',
        why:
          "The user's cache home (XDG), persisted across container rebuilds — ONE mount for every tool's cache: the\n" +
          "Playwright browsers (~/.cache/ms-playwright), the shared browser's own runtime, the package managers'.\n" +
          'A cache is self-validating, so keeping it whole is safe; what is not a cache never lives here.',
      },
    ],
    // Claude Code keeps its account record (login, onboarding) in `.claude.json` BESIDE its config dir — in $HOME,
    // outside the persisted mount above — unless CLAUDE_CONFIG_DIR is set, which moves it INSIDE. Without this every
    // rebuild kept the credentials but lost the account, and asked to log in again. containerEnv, not remoteEnv: a
    // shell opened from outside (`docker exec`, the durable tmux sessions) never sees remoteEnv.
    containerEnv: [
      {
        name: 'CLAUDE_CONFIG_DIR',
        value: '{{home}}/.claude',
        why:
          "Claude Code's config dir — the persisted mount above. Set explicitly so its account file (`.claude.json`)\n" +
          'lives INSIDE it and survives a rebuild, instead of beside it in the container-local $HOME.',
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
    // Claude Code installs in `install` — after the OS packages (it needs curl), before `plugins` (which runs it).
    // With ~/.local persisted, only the FIRST create of a project downloads it; every rebuild finds it installed.
    postCreate: [
      { phase: 'prepare', piece: 'claude-account' },
      { phase: 'install', piece: 'claude-code' },
      { phase: 'plugins', piece: 'claude-plugins' },
      { phase: 'provision', piece: 'gh-git-credentials' },
    ],
  },
  // The house plugins every agent-DX project carries. The stack-specific ones arrive with their layers
  // (`nx`, `web`, `angular`, `design-system`).
  claudePlugins: [
    'bespunky@claude-toolkit',
    'bespunky-house@claude-toolkit',
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
