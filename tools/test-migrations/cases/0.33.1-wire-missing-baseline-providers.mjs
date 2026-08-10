// 0.33.1 — repair the baseline wiring the `app` generator owed and dropped: apps scaffolded on nx-tools
// 0.26.0–0.32.x carry worktree-tab-label.ts and firebase.config.ts on disk with nothing calling either.
//
// Run behind 0.33.0, as the real ladder does, because the two interact: 0.33.0 reports "no call site" for
// exactly these projects, and 0.33.1 then wires the anchor. The end state must be the NEW default — the
// Firebase app provided, the services only commented — not all four at root.

const LADDER = ['0.33.0/split-firebase-service-providers', '0.33.1/wire-missing-baseline-providers'];

const ROOT_CONFIG = `import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
export function provideAppFirebase(): EnvironmentProviders { return makeEnvironmentProviders([]); }
`;
const TAB_LABEL = `export function provideWorktreeTabLabel() { return []; }\n`;
const EMPTY_CONFIG = `import { ApplicationConfig } from '@angular/core';
export const appConfig: ApplicationConfig = { providers: [] };
`;

/** An app as the scaffolder actually produced it on 0.26.0–0.32.x: the files, and nothing wired. */
function unwiredApp(tree, root) {
  tree.write(`${root}/src/app/firebase.config.ts`, ROOT_CONFIG);
  tree.write(`${root}/src/app/worktree-tab-label.ts`, TAB_LABEL);
  tree.write(`${root}/src/app/app.config.ts`, EMPTY_CONFIG);
}

export default {
  name: '0.33.1 · wire-missing-baseline-providers',
  ladder: LADDER,
  cases: [
    {
      name: 'wires both providers the app generator never wired',
      setup: (tree) => unwiredApp(tree, 'apps/unwired'),
      expect: (tree, t) => {
        t.wired('apps/unwired/src/app/app.config.ts', 'provideAppFirebase');
        t.wired('apps/unwired/src/app/app.config.ts', 'provideWorktreeTabLabel');
      },
    },

    {
      // The repaired app never had Firebase working, so there is no behaviour to preserve — it should land
      // on the CURRENT default, not on the all-four-at-root shape 0.33.0 gives a project that did work.
      name: 'repaired app lands on the new default (services commented, not wired)',
      setup: (tree) => unwiredApp(tree, 'apps/unwired'),
      expect: (tree, t) => {
        t.notWired('apps/unwired/src/app/app.config.ts', 'provideAppFirestore');
        t.has('apps/unwired/src/app/app.config.ts', '//    provideAppFirestore(),');
      },
    },

    {
      // A project that wired the anchor by hand — or deliberately moved it into a browser-only config — has
      // made a decision. Re-adding it is how Firebase gets double-provided and initialised during SSR, which
      // _utils/wire-provider's header records as a real incident.
      name: 'leaves a hand-wired provider alone, wherever the project put it',
      setup: (tree) => {
        tree.write('apps/manual/src/app/firebase.config.ts', ROOT_CONFIG);
        tree.write('apps/manual/src/app/worktree-tab-label.ts', TAB_LABEL);
        tree.write('apps/manual/src/app/app.config.ts', EMPTY_CONFIG);
        tree.write(
          'apps/manual/src/app/browser.config.ts',
          `import { ApplicationConfig } from '@angular/core';
import { provideAppFirebase } from './firebase.config';
export const browserConfig: ApplicationConfig = { providers: [provideAppFirebase()] };
`
        );
      },
      expect: (tree, t) => {
        t.notWired('apps/manual/src/app/app.config.ts', 'provideAppFirebase');
        t.occurrences('apps/manual/src/app/browser.config.ts', 'provideAppFirebase()', 1);
      },
    },

    {
      // Only where the generated FILE exists — its presence is what says the app was given the capability.
      name: 'does not invent a provider for a capability the app never had',
      setup: (tree) => {
        tree.write('apps/plain/src/app/app.config.ts', EMPTY_CONFIG);
      },
      expect: (tree, t) => {
        t.notWired('apps/plain/src/app/app.config.ts', 'provideAppFirebase');
        t.notWired('apps/plain/src/app/app.config.ts', 'provideWorktreeTabLabel');
      },
    },

    {
      name: 'never touches another git worktree',
      setup: (tree) => {
        unwiredApp(tree, 'apps/web');
        unwiredApp(tree, '.claude/worktrees/feat-y/apps/web');
      },
      expect: (tree, t) => {
        t.wired('apps/web/src/app/app.config.ts', 'provideAppFirebase');
        t.notWired('.claude/worktrees/feat-y/apps/web/src/app/app.config.ts', 'provideAppFirebase');
      },
    },
  ],
};
