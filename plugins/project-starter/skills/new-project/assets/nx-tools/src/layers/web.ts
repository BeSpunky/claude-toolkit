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
  docSections: ['web'],
};
