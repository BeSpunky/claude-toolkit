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
import { type Tree, logger, readJson, updateJson } from '@nx/devkit';
import { posix } from 'node:path';
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

// ── THE COMPILER CONTRACT ─────────────────────────────────────────────────────────────────────────────────────
//
// The island has a second consequence the hatch does not cover. Every Angular project's tsconfig.json extends
// tsconfig.base.json — and in a TS-solution workspace that base is written for tsc-BUILT packages: a real
// `create-nx-workspace --preset=ts` (23.1) states `emitDeclarationOnly: true` and `lib: ["es2022"]`. Right for a
// package `tsc -b` emits declarations for; wrong for Angular, which compiles its own way (found by the tripwire,
// tools/test-angular-ts-solution — the hand-built fixture never had either option):
//   - `emitDeclarationOnly: true` → ng-packagr refuses the library (NG4006), the application builder refuses the
//     app (NG4006, and TS5069 beside it), because both must emit JavaScript;
//   - `lib` without `dom` → the app does not typecheck (no `document`, no `HTMLElement`), and neither would any
//     component library that touches an `ElementRef<HTMLElement>`. A classic Angular workspace gets DOM from its
//     base (`["es2022", "dom"]`), so both kinds of Angular project state it here.
// So an Angular project STATES ITS OWN contract, in its own tsconfig.json — the one file every build, test and
// typecheck config of the project extends (tsconfig.app.json / tsconfig.lib.json[.prod] / tsconfig.spec.json
// alike) — and the base stays exactly as correct as it is for every other package (DECISION.md, "Angular projects
// declare their own compiler contract").
//
// `lib` is DERIVED, never hardcoded: the base's lib (whatever this workspace's target is) plus what Angular adds.
// When no config in the chain states `lib`, TypeScript's target default already includes DOM — so nothing is
// written, rather than a `lib: ["dom"]` that would silently drop the ES libraries.
//
// Deliberately NOT stated, from the tripwire's evidence (Nx 23.1, Angular 22, ng-packagr 22):
//   - `declaration` / `composite` — inherited from the base (`composite: true` implies declarations) and harmless:
//     ng-packagr sets the declaration output it needs itself, the application builder ignores both, and a
//     composite project is what the solution's `references` require anyway;
//   - nothing for typecheck — the inferred `typecheck` target runs `tsc --build tsconfig.json --emitDeclarationOnly`,
//     so the flag on its command line still wins there and `emitDeclarationOnly: false` never makes it emit JS.

/** What an Angular project states about its compiler in a workspaces-linked workspace. */
const ANGULAR_COMPILER_CONTRACT = {
  /** Options the project sets outright. */
  options: { emitDeclarationOnly: false },
  /** Libraries the project adds to whatever `lib` it inherits. */
  libs: ['dom'],
} as const;

/**
 * State the Angular compiler contract in the just-created Angular project at `projectRoot` — only in a
 * workspaces-linked tree (a `paths` workspace's base is Angular's own and needs nothing). Idempotent.
 */
export function stateAngularCompilerContract(tree: Tree, projectRoot: string): void {
  if (detectLinking(tree) !== 'workspaces') return;
  const file = `${projectRoot.replace(/\/+$/, '')}/tsconfig.json`;
  if (!tree.exists(file)) {
    logger.warn(`[angular] No ${file} to state the Angular compiler contract in — this project may not build in a TS-solution workspace.`);
    return;
  }
  const inherited = inheritedLib(tree, file);
  updateJson(tree, file, (json: { compilerOptions?: Record<string, unknown> }) => {
    const options = (json.compilerOptions ??= {});
    Object.assign(options, ANGULAR_COMPILER_CONTRACT.options);
    const lib = (options.lib as string[] | undefined) ?? inherited;
    if (lib) options.lib = withLibs(lib, ANGULAR_COMPILER_CONTRACT.libs);
    return json;
  });
}

/** `lib` plus `required`, deduplicated case-insensitively (TypeScript's lib names are), order kept. */
function withLibs(lib: readonly string[], required: readonly string[]): string[] {
  const merged = [...lib];
  for (const name of required) if (!merged.some((entry) => entry.toLowerCase() === name.toLowerCase())) merged.push(name);
  return merged;
}

/**
 * The `lib` the tsconfig at `file` inherits through its relative `extends` chain (the last of an array wins, as
 * in TypeScript) — undefined when none states one, or when the chain leaves the workspace through a package.
 */
function inheritedLib(tree: Tree, file: string): string[] | undefined {
  const parents = readJson<{ extends?: string | string[] }>(tree, file).extends;
  for (const parent of [parents ?? []].flat().reverse()) {
    if (!parent.startsWith('.')) continue;
    const resolved = posix.join(posix.dirname(file), parent.endsWith('.json') ? parent : `${parent}.json`);
    if (!tree.exists(resolved)) continue;
    const own = readJson<{ compilerOptions?: { lib?: string[] } }>(tree, resolved).compilerOptions?.lib;
    const lib = own ?? inheritedLib(tree, resolved);
    if (lib) return lib;
  }
  return undefined;
}
