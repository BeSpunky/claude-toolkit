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
};
