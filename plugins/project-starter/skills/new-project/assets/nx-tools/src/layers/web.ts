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
  docSections: ['web'],
};
