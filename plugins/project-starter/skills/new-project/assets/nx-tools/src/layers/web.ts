// `web` — the dev loop: the serve composer, worktree domains, the shared co-driven browser, Playwright.
//
// FRAMEWORK-AGNOSTIC by design: the `serve` composer drives a `dev-server` TARGET by name, the worktree-domains
// proxy forwards any localhost port, and the shared browser is pure CDP — none of them knows what framework
// produced the dev-server. Angular supplies the leaf today; a Vite or Next app satisfies this layer as well.
//
// REQUIRES `agent` (DECISION re-cut), no longer `nx` directly: the shared browser runs on the display stack
// and the forwarded ports the agent layer's devcontainer provides. Nx is the floor underneath both.
//
// A scaffold ensures it only `via` angular — the Angular app it creates is what has the dev-server. A sync
// cannot create something to serve; it detects one.
import type { LayerDescriptor, PlanContext } from './descriptor';
import { projectExists } from './evidence';
import { NOVNC_BAND_LABEL, novncBandPorts } from '../generators/shared-browser/novnc-band';

/** "The web layer is present" and "a project named <app> exists" are different claims — see skip below. */
const appMustExist = (ctx: PlanContext) =>
  projectExists(ctx.tree, ctx.app)
    ? null
    : {
        reason:
          `web layer present, but no project named '${ctx.app}' — SKIPPING the per-app serve generators. ` +
          `Migrations and workspace generators ran, but this app's own serve wiring was not refreshed. ` +
          `Re-run naming the app: scaffold.sh --sync <project> <app-name>`,
        partial: true,
      };

export const web: LayerDescriptor = {
  id: 'web',
  title: 'Web dev loop (serve, worktree domains, shared browser)',
  requires: ['agent'],
  evidence: { targets: ['dev-server', 'serve'] },
  ensurable: { scaffold: { via: 'angular' }, sync: false },
  ensureHint: 'an app with a dev-server target (e.g. the `angular` layer: `nx g @bespunky/nx-tools:app apps/<name>`)',
  brings: 'the serve composer, worktree domains, the shared co-driven browser, Playwright, :80',
  generators: {
    app: [
      {
        generator: 'serve',
        // --wireProviders only when this run CREATES the layer: wiring a provider into app.config.ts is a
        // baseline act, and the project owns that file thereafter.
        args: (ctx) => [`--project=${ctx.app}`, ...(ctx.ensured.has('web') ? ['--wireProviders'] : [])],
        skip: appMustExist,
      },
      { generator: 'serve-options', args: (ctx) => [`--project=${ctx.app}`], skip: appMustExist },
    ],
    workspace: [{ generator: 'playwright' }, { generator: 'shared-browser' }, { generator: 'worktree-domains' }],
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
