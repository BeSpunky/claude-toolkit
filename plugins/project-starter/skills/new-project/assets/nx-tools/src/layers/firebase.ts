// `firebase` — the emulator suite, Cloud Functions, App Hosting config, env bundles, devcontainer wiring.
//
// A CAPABILITY on the Nx floor, not an Angular feature. firebase.json, apphosting.yaml, the emulator/seed/secrets
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
  requires: ['nx'],
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
};
