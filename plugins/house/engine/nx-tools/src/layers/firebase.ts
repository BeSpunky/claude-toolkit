// `firebase` — the emulator suite, Cloud Functions, App Hosting config, env bundles, devcontainer wiring.
//
// A CAPABILITY on the Nx floor, not an Angular feature. firebase.json, the emulator/seed/secrets
// scripts, the `functions` app and the workspace `firebase` project are framework-neutral — the `firebase-emulators`
// core, a WORKSPACE step. Only the client wiring is framework-specific, and it attaches PER APP through the app's
// stack adapter (`firebase-client`, src/adapters/<stack>/firebase-client.ts). A repo with no frontend at all gets
// the core and nothing to attach to — a legitimate shape, reported, not partial.
//
// ENSURABLE BY A SYNC: the core genuinely creates the layer from nothing — the "retrofit Firebase" case, reached
// through --firebase (which house.sh folds into the ensure set: the flag and `add-layer firebase` are two
// spellings of one intent).
import type { DevcontainerPort, LayerDescriptor, PlanContext } from './descriptor';
import { type Tree, readProjectConfiguration } from '@nx/devkit';
import { hostDialledPorts } from '../generators/firebase-emulators/emulator-ports';
import { projectExists } from './evidence';
import { adapterOf, applicationsWith } from '../adapters/registry';
import { firebaseFragment } from '../generators/firebase-emulators/dev-fragment';
import { firebaseCiProvider } from '../generators/ci/firebase-provider';
import { GCLOUD_CLI_VERSION } from '../generators/_utils/versions';

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
  ensurable: { new: true, upgrade: true },
  ensureHint:
    '`house.sh add-layer firebase <project>` (or `nx g @bespunky/nx-tools:firebase-emulators [--project=<app>]`)',
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
    // The core, after the per-app client (planner order), so the scripts it writes follow the client app. Then the
    // dev engine (tools/dev): every emulator suite — run by a serve, run on its own, a seed build's — claims its ports
    // through it, the one stack identity (lib/stacks.mjs). A backend-only workspace has no `web` layer to bring it.
    workspace: [
      {
        generator: 'firebase-emulators',
        args: (ctx) => [
          `--workspaceName=${ctx.project}`,
          ...(ctx.staging ? ['--staging=true'] : []),
          ...(attachable(ctx) ? [`--clientApp=${ctx.app}`] : []),
          // Seeding rules is a CREATION act — only the run that brings Firebase into the workspace. Never an upgrade
          // (the console holds the live rules), and never a re-ensure of a project that already has Firebase: its
          // emulators run open today, and deny-all seeds would break every local read and write.
          ...(ctx.ensured.has('firebase') && !ctx.detected.has('firebase') ? ['--seedRules'] : []),
        ],
      },
      { generator: 'dev' },
    ],
  },
  docSections: ['firebase'],
  // With the `ci` layer: keyless GitHub → GCP auth, a `ci-<environment>` configuration on its deploy targets, and tools/setup-gcp.sh.
  ciDeploy: firebaseCiProvider,
  // The emulator suite, served beside every app the dev engine runs.
  devFragment: (tree) => firebaseFragment(tree),
  // The Cloud Functions bundle lands in `dist/<functions root>`. create-nx-workspace ignores `dist`; `nx init` on an
  // existing repo does not — and this layer brings that build, so it owns ignoring its output, or the first
  // `nx build functions` leaves an untracked tree behind.
  gitignore: [{ heading: 'Build output (Nx writes builds to dist/)', entries: ['dist'] }],
  // A function of the workspace: the forwarded ports are the suite's as firebase.json configures it, and the
  // dev-server port of each app the Firebase client can attach to — never a hand-copied list.
  devcontainer: (tree) => ({
    // NO firebase-cli feature: the Firebase CLI is the project's pinned `firebase-tools` devDependency
    // (_utils/versions.ts), on PATH through node_modules/.bin (the node layer, which this layer requires) — the image
    // used to install whatever version was newest on build day, a second `firebase` beside the project's. Its login
    // lives in ~/.config/configstore (persisted whole by the agent layer), its emulator downloads in ~/.cache.
    // No gcloud feature either: gcloud is a pinned image package (osPackages below).
    extensions: ['toba.vsfire'],
    ports: [...clientDevServerPorts(tree), ...emulatorForwards(tree)],
    osPackages: [
      {
        packages: ['default-jdk-headless'],
        why:
          'The emulator suite (Firestore / RTDB / Storage) runs on the JVM. apt, not the SDKMAN-based java feature,\n' +
          'whose build-time github.com fetch fails intermittently.',
      },
      {
        packages: [`google-cloud-cli=${GCLOUD_CLI_VERSION}`],
        repository: {
          id: 'google-cloud-sdk',
          key: 'https://packages.cloud.google.com/apt/doc/apt-key.gpg',
          source: 'https://packages.cloud.google.com/apt cloud-sdk main',
        },
        why:
          `The Google Cloud CLI (gcloud), pinned (${GCLOUD_CLI_VERSION}) and built into the image from Google's apt repository —\n` +
          'not a devcontainer feature, which installed whatever was newest on build day. Its logins live in ~/.config/gcloud.',
      },
    ],
    postCreate: [{ phase: 'provision', piece: 'firebase-banner' }],
  }),
};

/**
 * The dev-server of every app the Firebase client can attach to: the one port a host browser needs for the app.
 * The Firebase SDK inside the page reaches every emulator through that same origin (the dev server's proxy.conf.mjs
 * relays it), so it works on whatever host port the editor forwards it to. The port is the app's own (its
 * dev-server leaf's `port`), else its stack's default — so a backend-only Firebase forwards no dev-server at all.
 */
function clientDevServerPorts(tree: Tree): DevcontainerPort[] {
  const ports = new Set<number>();
  for (const { project, adapter } of applicationsWith(tree, 'firebase')) {
    if (!adapter.devServer) continue;
    const declared = Number(readProjectConfiguration(tree, project).targets?.['dev-server']?.options?.port);
    ports.add(Number.isInteger(declared) && declared > 0 ? declared : adapter.devServer.basePort);
  }
  return [...ports].map((port, index) => ({
    port,
    label: 'Dev Server',
    onAutoForward: 'openPreview' as const,
    forward: true,
    ...(index === 0
      ? {
          why:
            'The app reaches every Firebase emulator through the dev server\'s own origin (proxy.conf.mjs relays it),\n' +
            'so the app works on whatever host port this is forwarded to. The emulator ports below are for the\n' +
            'Emulator UI: its page dials each emulator directly, so the UI is complete in a host tab only while they\n' +
            'forward to the same number. Real Google OAuth is registered for one origin (the base dev-server port);\n' +
            'the shared browser runs INSIDE the container and reaches everything on loopback.',
        }
      : {}),
  }));
}

/** The ports the Emulator UI's page dials (firebase.json, else the house suite), forwarded at the same number. */
function emulatorForwards(tree: Tree): DevcontainerPort[] {
  return hostDialledPorts(tree).map(({ name, port, label }) => ({
    port,
    label,
    onAutoForward: name === 'ui' ? ('notify' as const) : ('silent' as const),
    forward: true,
  }));
}
