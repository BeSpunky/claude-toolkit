// `firebase` — the emulator suite, Cloud Functions app, env bundles, devcontainer wiring.
//
// Requires `angular` FOR NOW. firebase.json, apphosting.yaml, the emulator/seed scripts and apps/functions are
// framework-neutral; only the client wiring (env files, fileReplacements, provideAppFirebase, @angular/fire)
// is Angular. Phase 4 splits it into a neutral core plus a per-framework client adapter.
//
// ENSURABLE BY A SYNC: `firebase-emulators` genuinely creates the layer from nothing against an app that
// already exists — the "retrofit Firebase" case, reached through --firebase (which scaffold.sh folds into the
// ensure set: the flag and --ensure=firebase are two spellings of one intent).
import type { LayerDescriptor } from './descriptor';
import { projectExists } from './evidence';

export const firebase: LayerDescriptor = {
  id: 'firebase',
  title: 'Firebase',
  requires: ['angular'],
  evidence: { files: ['firebase.json'] },
  ensurable: { scaffold: true, sync: true },
  ensureHint:
    '`scaffold.sh --sync --firebase <project>` (or `nx g @bespunky/nx-tools:firebase-emulators --project=<app>`)',
  brings: 'the emulator wiring, the JDK step, and the forwarded emulator ports',
  generators: {
    app: [
      {
        generator: 'firebase-emulators',
        args: (ctx) => [
          `--project=${ctx.app}`,
          `--workspaceName=${ctx.project}`,
          ...(ctx.staging ? ['--staging=true'] : []),
          ...(ctx.ensured.has('firebase') ? ['--wireProviders'] : []),
        ],
        // The generator writes environment files, firebase.config.ts and the app.config.ts provider, so it
        // needs the APP — not merely the layer. (Its `angular` precondition is the layer's own `requires`,
        // which the planner checks before it gets here.)
        skip: (ctx) =>
          projectExists(ctx.tree, ctx.app)
            ? null
            : {
                reason: `firebase present, but no project named '${ctx.app}' to wire the emulators into — SKIPPING it. Re-run naming the app.`,
                partial: true,
              },
      },
    ],
  },
  docSections: ['firebase'],
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
