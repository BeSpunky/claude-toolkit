// 0.33.0 — provideAppFirebase() narrowed to the Firebase app; the four SDK services moved to their own
// generated files, and this rung adds them back at the project's real call site so nothing changes.
//
// Every case below is a defect that actually shipped in review, not a hypothetical. The comments say which.

const SPLIT = '0.33.0/split-firebase-service-providers';

/** A pre-0.33.0 firebase.config.ts: the emulator helpers are module-PRIVATE and all four services are provided. */
const OLD_ROOT_CONFIG = `import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
function emulatorFor(service: string) { return undefined; }
const portOffset = 0;
function offsetUrl(url: string, offset: number) { return url; }
export function provideAppFirebase(): EnvironmentProviders { return makeEnvironmentProviders([]); }
`;

const appConfig = (imports, providers) => `import { ApplicationConfig } from '@angular/core';
${imports}
export const appConfig: ApplicationConfig = { providers: [${providers}] };
`;

/** A stock app: root config plus an app.config.ts that wires the anchor. */
function plainApp(tree, root) {
  tree.write(`${root}/src/app/firebase.config.ts`, OLD_ROOT_CONFIG);
  tree.write(
    `${root}/src/app/app.config.ts`,
    appConfig(`import { provideAppFirebase } from './firebase.config';`, 'provideAppFirebase()')
  );
}

export default {
  name: '0.33.0 · split-firebase-service-providers',
  ladder: [SPLIT],
  cases: [
    {
      name: 'wires all four services beside the anchor',
      setup: (tree) => plainApp(tree, 'apps/web'),
      expect: (tree, t) => {
        for (const fn of ['provideAppAuth', 'provideAppFirestore', 'provideAppStorage', 'provideAppFunctions']) {
          t.wired('apps/web/src/app/app.config.ts', fn);
        }
        t.has('apps/web/src/app/app.config.ts', `from './firebase-auth.config'`);
      },
    },

    {
      // The root file must be rewritten TOO: the siblings import emulatorFor/portOffset/offsetUrl from it,
      // and a pre-0.33.0 root file keeps those private. Writing siblings alone yields four files that do
      // not compile — reachable on a bare `nx migrate`, on a partial sync, and in every multi-app workspace.
      name: 'rewrites the root config so the siblings can import from it',
      setup: (tree) => plainApp(tree, 'apps/web'),
      expect: (tree, t) => {
        t.has('apps/web/src/app/firebase.config.ts', 'export function emulatorFor');
        t.has('apps/web/src/app/firebase.config.ts', 'export const portOffset');
        for (const service of ['auth', 'firestore', 'storage', 'functions']) {
          t.exists(`apps/web/src/app/firebase-${service}.config.ts`);
        }
      },
    },

    {
      // The import specifier is COMPUTED from the app root, not derived from whatever the anchor imported.
      name: 'computes import paths for a call site in a subfolder',
      setup: (tree) => {
        tree.write('apps/sub/src/app/firebase.config.ts', OLD_ROOT_CONFIG);
        tree.write(
          'apps/sub/src/app/browser/browser.config.ts',
          appConfig(`import { provideAppFirebase } from '../firebase.config';`, 'provideAppFirebase()')
        );
      },
      expect: (tree, t) => {
        t.has('apps/sub/src/app/browser/browser.config.ts', `from '../firebase-firestore.config'`);
        t.wired('apps/sub/src/app/browser/browser.config.ts', 'provideAppFirestore');
      },
    },

    {
      // Matching on identifier NAME made a project with its own provideAppAuth read as "already migrated":
      // three services silently dropped, and an INFO line saying it was fine.
      name: 'reports a name collision instead of wiring somebody else\'s function',
      setup: (tree) => {
        tree.write('apps/collide/src/app/firebase.config.ts', OLD_ROOT_CONFIG);
        tree.write('apps/collide/src/app/auth.providers.ts', 'export function provideAppAuth() { return []; }\n');
        tree.write(
          'apps/collide/src/app/app.config.ts',
          appConfig(
            `import { provideAppFirebase } from './firebase.config';\nimport { provideAppAuth } from './auth.providers';`,
            'provideAppFirebase(), provideAppAuth()'
          )
        );
      },
      expect: (tree, t) => {
        const path = 'apps/collide/src/app/app.config.ts';
        t.has(path, `from './auth.providers'`);
        t.hasNot(path, `provideAppAuth } from './firebase-auth.config'`);
        // The other three are unaffected by the collision and must still be wired.
        for (const fn of ['provideAppFirestore', 'provideAppStorage', 'provideAppFunctions']) t.wired(path, fn);
      },
    },

    {
      // Stopping at the first call in a file would have left a server config without the services it had a
      // moment earlier — an SSR NullInjectorError, while the log said "behaves exactly as before".
      name: 'wires every call site in a file, not just the first',
      setup: (tree) => {
        tree.write('apps/two/src/app/firebase.config.ts', OLD_ROOT_CONFIG);
        tree.write(
          'apps/two/src/app/app.config.ts',
          `import { ApplicationConfig } from '@angular/core';
import { provideAppFirebase } from './firebase.config';
export const browserConfig: ApplicationConfig = { providers: [provideAppFirebase()] };
export const serverConfig: ApplicationConfig = { providers: [provideAppFirebase()] };
`
        );
      },
      expect: (tree, t) => t.occurrences('apps/two/src/app/app.config.ts', 'provideAppFirestore()', 2),
    },

    {
      // THE WORST ONE. The house's own convention puts a second checkout at .claude/worktrees/<slug>, at
      // exactly the depth the walk reached — so the migration edited source on an unrelated feature branch,
      // which --sync's git backup does not cover.
      name: 'never touches another git worktree, build output, or a nested checkout',
      setup: (tree) => {
        plainApp(tree, 'apps/web');
        plainApp(tree, '.claude/worktrees/feat-x/apps/web');
        plainApp(tree, 'dist/apps/web');
        tree.write('vendor/other-repo/.git', 'gitdir: /elsewhere');
        plainApp(tree, 'vendor/other-repo/apps/web');
      },
      expect: (tree, t) => {
        t.wired('apps/web/src/app/app.config.ts', 'provideAppFirestore'); // the real app IS migrated
        for (const foreign of ['.claude/worktrees/feat-x/apps/web', 'dist/apps/web', 'vendor/other-repo/apps/web']) {
          t.notWired(`${foreign}/src/app/app.config.ts`, 'provideAppFirestore');
          t.missing(`${foreign}/src/app/firebase-auth.config.ts`);
        }
      },
    },

    {
      // An `nx init` retrofit keeps its app at the workspace root; the walk only ever tested CHILDREN, so
      // this shape was a total silent no-op.
      name: 'finds an app at the workspace root',
      setup: (tree) => plainApp(tree, '.'),
      expect: (tree, t) => t.wired('src/app/app.config.ts', 'provideAppFirestore'),
    },

    {
      name: 'leaves a project alone when the services are already wired',
      setup: (tree) => {
        tree.write('apps/done/src/app/firebase.config.ts', OLD_ROOT_CONFIG);
        tree.write(
          'apps/done/src/app/app.config.ts',
          appConfig(
            `import { provideAppFirebase } from './firebase.config';\nimport { provideAppFirestore } from './firebase-firestore.config';\nimport { provideAppAuth } from './firebase-auth.config';\nimport { provideAppStorage } from './firebase-storage.config';\nimport { provideAppFunctions } from './firebase-functions.config';`,
            'provideAppFirebase(), provideAppAuth(), provideAppFirestore(), provideAppStorage(), provideAppFunctions()'
          )
        );
      },
      expect: (tree, t) => t.occurrences('apps/done/src/app/app.config.ts', 'provideAppFirestore()', 1),
    },
  ],
};
