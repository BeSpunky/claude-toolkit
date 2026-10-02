// ANGULAR IN A TS-SOLUTION WORKSPACE — the one place the adapter knows that @nx/angular refuses to be there.
//
// @nx/angular 23 guards five generators — `init`, `application`, `library`, `host`, `remote` — with
// `assertNotUsingTsSolutionSetup` (dist/src/generators/utils/validations.js): in a workspace Nx considers
// TS-solution (package-manager workspaces + a references-only tsconfig.json + a composite tsconfig.base.json —
// our `detectLinking() === 'workspaces'`) they throw, because the Angular compiler does not support TypeScript
// project references (angular/angular#37276). Upstream has no plan to change that (nrwl/nx#29940, #30540,
// angular/angular-cli#30446). The error itself prints the escape hatch: `NX_IGNORE_UNSUPPORTED_TS_SETUP=true`.
//
// What is behind the hatch was VERIFIED, not assumed (docs/features/2026-10-02-workspace-layouts, fan-out R2 and
// U4): with it, an app is created as a classic project.json ISLAND (no package.json, its own non-composite
// tsconfigs); `nx sync` adds it to the solution's references; it imports a workspace package through that
// package's `exports` (custom condition → source) and `nx typecheck` / `nx build` pass. The Angular project is
// simply never a project-reference participant itself — which is the only thing Angular cannot do.
//
// So the hybrid is: the workspace links by `workspaces`, and Angular projects live in it as islands. This file is
// the SEAM that makes that one decision, once, for every guarded call the house makes — rather than an env
// assignment sprinkled before each `await`.
//
// RISK, stated plainly: the variable is UNDOCUMENTED upstream — printed by the error, read only by the guards
// (and the same guard in @nx/js), not promised by any doc. If Nx renames or removes it, every guarded call here
// fails again with Nx's own clear error, never silently; the generator fixture test is the tripwire.
//
// Scope, deliberately narrow:
//   - set ONLY in a workspaces-linked tree (a `paths` workspace never meets the guard, and must not have its
//     environment touched);
//   - set for the duration of ONE awaited call and restored in `finally` to whatever it was (including unset),
//     so it never leaks into a later generator — Nx's own or the user's — that has every right to refuse;
//   - `host` / `remote` (module federation) are NOT routed through here: the adapter does not expose them, and a
//     federated build on top of a references-free island is a combination nobody has verified.
import type { Tree } from '@nx/devkit';
import { detectLinking } from '../../generators/_utils/linking';

/** The opt-out @nx/angular's (and @nx/js's) `assertNotUsingTsSolutionSetup` honours. */
const OPT_OUT = 'NX_IGNORE_UNSUPPORTED_TS_SETUP';

/**
 * Run one @nx/angular generator call that is guarded against TS-solution workspaces (`application`, `library`,
 * `init`) — with the guard's opt-out set exactly while it runs, and only when this tree IS such a workspace.
 * Exported for the Angular generators that live outside the adapter (they call `@nx/angular/generators`
 * directly); an unguarded generator (component, secondary entry point, setup-ssr) needs no wrapping.
 */
export async function angularGeneratorCall<T>(tree: Tree, call: () => Promise<T>): Promise<T> {
  if (detectLinking(tree) !== 'workspaces') return call();
  const previous = process.env[OPT_OUT];
  process.env[OPT_OUT] = 'true';
  try {
    return await call();
  } finally {
    if (previous === undefined) delete process.env[OPT_OUT];
    else process.env[OPT_OUT] = previous;
  }
}
