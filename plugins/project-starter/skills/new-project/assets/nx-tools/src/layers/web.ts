// `web` — the dev loop: the stack-free dev engine, worktree domains, the shared co-driven browser.
//
// FRAMEWORK-AGNOSTIC by design. What a project serves is DATA — `.bespunky/dev.json`, a list of processes and
// the ports they occupy — and `tools/dev/dev serve` (the engine) runs it: worktree selection, one port offset
// for every declared port, `<slug>.localhost`, the shared browser, one graceful Ctrl+C. Nothing in it knows
// a framework. Adapters SEED the declaration (an Nx `dev-server` target, the Firebase emulator suite); a
// Python, Go or plain Vite project writes it by hand.
//
// PRESENT when a declaration exists, or when an Nx project has a dev-server / serve target (the Nx adapter
// then seeds the declaration). REQUIRES only `agent`: the shared browser runs on the display stack and the
// forwarded ports the agent layer's devcontainer provides. Nx is the floor underneath both.
//
// A scaffold ensures it only `via` angular — the Angular app it creates is what has the dev-server. A sync
// cannot invent what a project serves; it detects a declaration (or a dev-server) and wires the rest.
import type { LayerDescriptor, PlanContext } from './descriptor';
import { matchesEvidence, projectExists } from './evidence';
import { NOVNC_BAND_LABEL, novncBandPorts } from '../generators/shared-browser/novnc-band';

/** The Nx adapter's dev-loop targets — what makes a project "served through Nx". */
const NX_SERVE_TARGETS = ['dev-server', 'serve'];

/**
 * The per-app steps wire the NX adapter (the `serve` composer target + its dev-server options) onto the sync's
 * app. "The web layer is present" and "an Nx project named <app> exists" are different claims:
 *   - the project exists                          → run.
 *   - it doesn't, but some Nx project IS served   → the sync named the wrong app: SKIP and say so, partial.
 *   - no Nx project is served at all              → a declaration-only project (Python, Go, …): there is no
 *                                                   Nx wiring to refresh, and nothing was missed — skip quietly.
 */
const nxAppMustExist = (ctx: PlanContext) => {
  if (projectExists(ctx.tree, ctx.app)) return null;
  let nxServed = false;
  try {
    nxServed = matchesEvidence(ctx.tree, { targets: NX_SERVE_TARGETS });
  } catch {
    /* an unreadable graph is "could not tell" — treat as declaration-only, never crash the plan */
  }
  return nxServed
    ? {
        reason:
          `web layer present, but no project named '${ctx.app}' — SKIPPING the per-app serve generators. ` +
          `Migrations and workspace generators ran, but this app's own serve wiring was not refreshed. ` +
          `Re-run naming the app: scaffold.sh --sync <project> <app-name>`,
        partial: true,
      }
    : { reason: `web layer is declaration-only (.bespunky/dev.json, no Nx-served app) — no per-app Nx serve wiring to refresh.`, partial: false };
};

export const web: LayerDescriptor = {
  id: 'web',
  title: 'Web dev loop (dev engine, worktree domains, shared browser)',
  requires: ['agent'],
  evidence: { files: ['.bespunky/dev.json'], targets: NX_SERVE_TARGETS },
  ensurable: { scaffold: { via: 'angular' }, sync: false },
  ensureHint:
    'declare what the project serves in `.bespunky/dev.json` (e.g. `{"apps":{"site":{"processes":[{"id":"app","cmd":"python3 -m http.server ${PORT:app}","ports":{"app":8000}}]}}}`), ' +
    'or give an Nx app a dev-server target (the `angular` layer: `nx g @bespunky/nx-tools:app apps/<name>`), then sync',
  brings: 'the stack-free dev engine (tools/dev/dev serve), worktree domains, the shared co-driven browser, :80',
  generators: {
    app: [
      { generator: 'serve', args: (ctx) => [`--project=${ctx.app}`], skip: nxAppMustExist },
      { generator: 'serve-options', args: (ctx) => [`--project=${ctx.app}`], skip: nxAppMustExist },
    ],
    // port-claim first: the shared browser, the worktree-domains proxy and the engine all consult it.
    // `dev` last: it seeds declarations for the apps the per-app steps (and other layers) just wired.
    workspace: [{ generator: 'port-claim' }, { generator: 'shared-browser' }, { generator: 'worktree-domains' }, { generator: 'dev' }],
  },
  docSections: ['web', 'ui'],
  devcontainer: {
    extensions: ['formulahendry.auto-rename-tag'],
    settings: [
      {
        key: 'remote.autoForwardPorts',
        value: true,
        why:
          "Auto-forwarding is LOAD-BEARING here, not a convenience: the shared browser's noVNC port is allocated at\n" +
          'runtime, so it can only reach the host by being detected and forwarded when it starts listening. Pinned\n' +
          'at the container (Remote) scope, which overrides a user who turned auto-forward off globally. (A\n' +
          'committed .vscode/settings.json would override THIS, so do not contradict it there.) "process" watches\n' +
          '/proc for listening sockets, which is how the loopback-bound websockify is found.',
      },
      { key: 'remote.autoForwardPortsSource', value: 'process' },
    ],
    runArgs: [
      {
        args: ['--sysctl', 'net.ipv4.ip_unprivileged_port_start=0', '--add-host=host.docker.internal:host-gateway'],
        why:
          '`--sysctl`: let the non-root user bind privileged ports — the worktree-domains reverse proxy binds :80 so\n' +
          'each worktree gets a pretty http://<slug>.localhost/ domain, with no runtime sudo.\n' +
          '`--add-host`: a name for the host, so the shared-browser port allocator can probe the host side (a bonus\n' +
          'that can only REJECT a port; the cross-container registry volume below carries the guarantee).\n' +
          'NOTE: `runArgs` is image-only. Converting to `dockerComposeFile` must move `--add-host` to `extra_hosts`.',
      },
    ],
    ports: [
      {
        port: 80,
        label: 'Worktree domains (pretty <slug>.localhost URLs)',
        onAutoForward: 'silent',
        forward: true,
        why:
          ':80 is the worktree-domains reverse proxy, reachable from a HOST browser too. It is first-come across\n' +
          'containers (`<slug>.localhost` has no port to remap); the shared browser works for every container.',
      },
      // The noVNC band: ONE EXACT KEY PER PORT, from the shared band constants — a range key silently discards
      // `requireLocalPort`, the flag that turns a silent host-side remap into a visible prompt. Not forwarded:
      // the port is ALLOCATED at `shared-browser up` from the band (claimed in the shared registry volume), so
      // the editor's auto-forward maps it host==container.
      ...novncBandPorts().map((port, index) => ({
        port,
        label: 'Shared Browser (noVNC)',
        onAutoForward: 'notify' as const,
        requireLocalPort: true,
        ...(index === 0
          ? {
              why:
                `The shared browser's noVNC band (${NOVNC_BAND_LABEL}), one exact key per port: requireLocalPort makes a\n` +
                'host-side remap PROMPT instead of silently pointing the URL at another container. Read the real URL\n' +
                'from `tools/shared-browser/shared-browser url` — never hardcode it.',
            }
          : {}),
      })),
    ],
    containerEnv: [
      {
        name: 'BESPUNKY_DEVCONTAINER_ID',
        value: '${devcontainerId}',
        why:
          "The platform's own stable container id — the identity that OWNS a shared-browser host-port claim, so a\n" +
          'rebuild reclaims the same port. containerEnv so ANY process sees it, not only editor-spawned ones.',
      },
    ],
    mounts: [
      {
        mount: 'source=${localWorkspaceFolderBasename}-playwright-cache,target={{home}}/.cache/ms-playwright,type=volume',
        why: 'Playwright browser binaries (~150 MB Chromium) on a per-workspace volume, so rebuilds reuse them.',
      },
      {
        mount: 'source=bespunky-shared-ports,target=/var/opt/bespunky/ports,type=volume',
        why:
          'The cross-container host-port registry. A FIXED volume name is the point: every BeSpunky devcontainer on\n' +
          "this engine mounts the SAME volume — the one substrate where containers see each other's noVNC claims.",
      },
    ],
    osPackages: [
      {
        packages: ['xvfb', 'x11vnc', 'novnc', 'websockify', 'fluxbox', 'fonts-liberation', 'fonts-noto-color-emoji'],
        why:
          'The shared browser: a headed Chromium on a virtual X display, streamed over noVNC. xvfb = the display;\n' +
          'x11vnc = the VNC server; novnc + websockify = the web client and its bridge; fluxbox = a minimal WM;\n' +
          'fonts so rendered pages and screenshots look right.',
      },
      {
        packages: ['iproute2', 'procps'],
        why: '`sysctl` (procps) for the worktree-domains :80 proxy, `ss` (iproute2) for the port probes.',
      },
    ],
    postCreate: [
      { phase: 'prepare', piece: 'web-volumes' },
      { phase: 'provision', piece: 'playwright' },
      { phase: 'provision', piece: 'shared-browser-chromium' },
    ],
  },
  // Its skills drive the shared browser and Playwright, which only a web container provisions.
  claudePlugins: ['bespunky-browser-automation@claude-toolkit'],
};
