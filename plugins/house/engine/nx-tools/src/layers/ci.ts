// `ci` — continuous DEPLOYMENT from the branch model. OPT-IN: in no preset, ensured only by `add-layer ci`.
//
// Why opt-in: deploying from GitHub Actions needs a cloud identity a human creates (IAM), and plenty of projects
// deploy another way (Cloud Build, a laptop, Firebase's own App Hosting rollout). Asked for, it is the whole loop:
// an owned workflow that deploys, on a push to each line the branch model binds with `ci`, every affected project's
// `deploy` target into that line's environment — and, from each active deploy PROVIDER (`ciDeploy` on a layer:
// Firebase today), the auth steps and the human-run setup script.
//
// STACK-AGNOSTIC. Its contract is "every project's `deploy` target is how that project ships" — it requires only the
// Nx floor, and a project with no provider layer still gets a workflow running its own deploy targets.
//
// DETECTED by its marker (`.bespunky/ci.json`), written on every run — also when there is no workflow to write yet
// (undeclared model, no binding), so the layer stays on and the next upgrade writes it once the model allows.
import type { LayerDescriptor } from './descriptor';
import { MARKER } from '../generators/ci/workflow';

export const ci: LayerDescriptor = {
  id: 'ci',
  title: 'CI deploy (GitHub Actions, from the branch model)',
  requires: ['nx'],
  evidence: { files: [MARKER] },
  ensurable: { new: true, upgrade: true },
  ensureHint: '`house.sh add-layer ci <project>` (then give each line that should deploy a `ci` binding in the branch model)',
  brings: 'the deploy workflow driven by the branch model, and each provider\'s human-run cloud setup',
  generators: {
    workspace: [
      {
        generator: 'ci',
        args: (ctx) => [
          `--layers=${[...ctx.active].join(',')}`,
          ...(ctx.branchProjection ? [`--branchProjection=${ctx.branchProjection}`] : []),
        ],
      },
    ],
  },
  docSections: ['ci'],
};
