// `firebase` — the emulator suite, Cloud Functions, App Hosting config, env bundles, devcontainer wiring.
//
// A CAPABILITY on the Nx floor, not an Angular feature. firebase.json, the emulator/seed/secrets
// scripts, apps/functions and the workspace `firebase` project are framework-neutral — the `firebase-emulators`
// core, a WORKSPACE step. Only the client wiring is framework-specific, and it attaches PER APP through the app's
// stack adapter (`firebase-client`, src/adapters/<stack>/firebase-client.ts). A repo with no frontend at all gets
// the core and nothing to attach to — a legitimate shape, reported, not partial.
//
// ENSURABLE BY A SYNC: the core genuinely creates the layer from nothing — the "retrofit Firebase" case, reached
// through --firebase (which scaffold.sh folds into the ensure set: the flag and --ensure=firebase are two
// spellings of one intent).
import type { LayerDescriptor, PlanContext } from './descriptor';
import { projectExists } from './evidence';
import { adapterOf, applicationsWith } from '../adapters/registry';

/** The sync's app, when its stack can take the Firebase client. */
const attachable = (ctx: PlanContext): boolean =>
  projectExists(ctx.tree, ctx.app) && Boolean(adapterOf(ctx.tree, ctx.app)?.firebase);

export const firebase: LayerDescriptor = {
  id: 'firebase',
  title: 'Firebase',
  // `node`: Cloud Functions are a Node app and the suite cannot boot without them (firebase-admin,
  // firebase-functions and @nx/esbuild live in the root package.json). A scaffold therefore creates the
  // package.json host for it; a sync on a repo without one reports the layer as unmet instead of half-wiring it.
  requires: ['nx', 'node'],
  evidence: { files: ['firebase.json'] },
  ensurable: { scaffold: true, sync: true },
  ensureHint:
    '`scaffold.sh --sync --firebase <project>` (or `nx g @bespunky/nx-tools:firebase-emulators [--project=<app>]`)',
  brings: 'the emulator wiring, the JDK step, and the forwarded emulator ports',
  generators: {
    app: [
      {
        generator: 'firebase-client',
        args: (ctx) => [
          `--project=${ctx.app}`,
          `--workspaceName=${ctx.project}`,
          ...(ctx.staging ? ['--staging=true'] : []),
          ...(ctx.ensured.has('firebase') ? ['--wireProviders'] : []),
        ],
        // Missing app: PARTIAL only when the workspace has apps the client could have gone into (the sync was
        // pointed at the wrong name). No such app at all is the backend-only shape — nothing was owed.
        skip: (ctx) => {
          if (attachable(ctx)) return null;
          if (projectExists(ctx.tree, ctx.app)) {
            return { reason: `firebase: '${ctx.app}' is built by no stack with a Firebase client port — core only, client skipped.`, partial: false };
          }
          const candidates = applicationsWith(ctx.tree, 'firebase').map(({ project }) => project);
          return candidates.length
            ? {
                reason: `firebase present, but no project named '${ctx.app}' to attach the client to (apps that could take it: ${candidates.join(', ')}) — SKIPPING it. Re-run naming the app.`,
                partial: true,
              }
            : { reason: 'firebase: no app to attach the Firebase client to — the core (emulators, functions, App Hosting) only.', partial: false };
        },
      },
    ],
    // The core, after the per-app client (planner order), so the scripts it writes follow the client app.
    workspace: [
      {
        generator: 'firebase-emulators',
        args: (ctx) => [
          `--workspaceName=${ctx.project}`,
          ...(ctx.staging ? ['--staging=true'] : []),
          ...(attachable(ctx) ? [`--clientApp=${ctx.app}`] : []),
        ],
      },
    ],
  },
  docSections: ['firebase'],
  // The Cloud Functions bundle lands in `dist/apps/functions`. create-nx-workspace ignores `dist`; `nx init` on an
  // existing repo does not — and this layer brings that build, so it owns ignoring its output, or the first
  // `nx build functions` leaves an untracked tree behind.
  gitignore: [{ heading: 'Build output (Nx writes builds to dist/)', entries: ['dist'] }],
  devcontainer: {
    features: [{ id: 'ghcr.io/devcontainers-extra/features/firebase-cli' }, { id: 'ghcr.io/jajera/features/gcloud-cli' }],
    extensions: ['toba.vsfire'],
    ports: [
      {
        // The dev server, pinned to the SAME host port: the page loads over forwarded :4200, then the Firebase
        // SDK INSIDE it calls the emulators at hardcoded localhost:<port> addresses (environment.ts), which only
        // resolve from a host browser if those ports are forwarded to the identical host port.
        port: 4200,
        label: 'Dev Server',
        onAutoForward: 'openPreview',
        forward: true,
        why:
          'Firebase forwards the dev server + emulator ports to the SAME host port: the Firebase SDK inside a\n' +
          'host-loaded page dials hardcoded localhost:<port> addresses that only resolve if the port is identical.\n' +
          'KNOWN LIMITATION: several Firebase devcontainers in parallel collide on these host ports (first come wins;\n' +
          'real Google OAuth is pinned to whichever holds :4200). The shared browser runs INSIDE the container and\n' +
          'reaches them on loopback, so it works for every container.',
      },
      { port: 4000, label: 'Firebase Emulator UI', onAutoForward: 'notify', forward: true },
      { port: 9099, label: 'Auth Emulator', onAutoForward: 'silent', forward: true },
      { port: 8080, label: 'Firestore Emulator', onAutoForward: 'silent', forward: true },
      { port: 9150, label: 'Firestore WebSocket', onAutoForward: 'silent', forward: true },
      { port: 9199, label: 'Storage Emulator', onAutoForward: 'silent', forward: true },
      { port: 5001, label: 'Functions Emulator', onAutoForward: 'silent', forward: true },
    ],
    osPackages: [
      {
        packages: ['default-jdk-headless'],
        why:
          'The emulator suite (Firestore / RTDB / Storage) runs on the JVM. apt, not the SDKMAN-based java feature,\n' +
          'whose build-time github.com fetch fails intermittently.',
      },
    ],
    postCreate: [{ phase: 'provision', piece: 'firebase-banner' }],
  },
};
