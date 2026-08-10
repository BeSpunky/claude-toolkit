// 0.33.0 — `provideAppFirebase()` no longer provides the four SDK services. Carry every project that
// relies on it onto the explicit per-service providers, WITHOUT changing what its bundle or its injectors
// do.
//
// WHAT CHANGED UPSTREAM. firebase.config.ts used to return providers for the Firebase app AND Auth,
// Firestore, Storage and Functions, and the generator wired that single call into the app's ROOT
// providers. Root providers are reached from `main`, so all four SDK entry points were statically imported
// into the initial bundle of every house-scaffolded Firebase app — measured at 479 kB raw for an app with
// no features, against 238 kB for the Firebase app alone — and AngularFire instantiated each one at
// bootstrap. From 0.33.0 each service has its own
// generated file (firebase-<service>.config.ts), so an app can provide each where it is actually needed:
// at root, or in the lazily-loaded routes file that uses it.
//
// WHY THAT NEEDS A MIGRATION AND NOT JUST A NEW TEMPLATE. firebase.config.ts is generator-owned and
// rewritten IN FULL on every `--sync`. Ship the new shape alone and every existing project's next sync
// silently removes four providers it is still injecting: the failure surfaces later, at the first
// `inject(Firestore)`, as a NullInjectorError with no diff to point at. So this migration runs first and
// makes the change a NO-OP for anyone already on disk — same providers, same injector, same bundle. The
// gain is then something a project OPTS INTO by moving a provider down into a lazy route, at its own pace,
// with its own testing. It is not taken from it by surprise.
//
// WHERE IT WRITES: THE CALL SITE, NOT app.config.ts. This deliberately does not assume the providers array
// lives in app.config.ts. See _utils/wire-provider's header for the incident behind that: a project had
// deliberately moved `provideAppFirebase()` into its BROWSER-only config, and a generator that assumed
// app.config.ts re-added it to the shared one — double-providing Firebase and initialising it during
// SSR/prerender. So this searches the app's sources for the actual `provideAppFirebase()` call inside a
// providers array, and inserts the services exactly there. One call site, wherever the project put it.
//
// WHERE IT WOULD BE A GUESS, IT REPORTS. Two cases are named in the log and left untouched rather than
// guessed at: no call site found (the project wires Firebase some way this cannot recognise), and a call
// site whose `provideAppFirebase` import doesn't resolve to a `firebase.config` module, so the siblings'
// import path cannot be derived from it. Either one leaves `inject(Firestore)` about to fail, so the
// warning says so and gives the exact lines to add. An unexplained leftover is indistinguishable from an
// oversight.
//
// EVERY call site is handled, not just the first, and every one is NAMED in the log. More than one is a
// real shape (a browser config and a server config), and it is also the shape migration 0.27.0 reports as
// a possible duplicate-provider bug. This migration deliberately does not adjudicate that: it preserves
// whatever the project has, at every site it has it, and lists them so a reader can see there were two.
//
// IT ALSO WRITES THE FILES IT IMPORTS. The house sync runs `probe → install → migrate → detect → generate`,
// so when this runs the per-service files do not exist yet — the firebase-emulators generator writes them
// afterwards. That is fine for a `scaffold.sh --sync`, and broken for a project that runs `nx migrate` on
// its own: imports pointing at absent files. So any missing sibling is written here from the SAME templates
// the generator uses (shared via generators/firebase-emulators/service-configs), and the generator's later
// rewrite is byte-identical.
import { type Tree, logger, formatFiles, applyChangesToString, ChangeType, type StringChange } from '@nx/devkit';
import {
  loadTypeScript,
  type TsImportDeclaration,
  type TsNode,
  type TsSourceFile,
} from '../../generators/_utils/typescript-api';
import {
  FIREBASE_SERVICE_CONFIGS,
  writeFirebaseServiceConfigs,
} from '../../generators/firebase-emulators/service-configs';

/** The provider whose meaning narrowed — the anchor everything here is found by. */
const ANCHOR = 'provideAppFirebase';

/** The module the anchor is imported from, in every shape the house has generated it. */
const ANCHOR_MODULE_SUFFIX = 'firebase.config';

export default async function splitFirebaseServiceProviders(tree: Tree): Promise<void> {
  // The apps this applies to: every one carrying the generator-owned firebase.config.ts. Found by walking
  // the tree rather than by reading project configuration, so an app whose project.json shape this
  // migration doesn't anticipate is still covered.
  const appRoots = findFirebaseAppRoots(tree);
  if (appRoots.length === 0) return; // Not a Firebase project (or never wired) — nothing owed.

  const ts = loadTypeScript();
  if (!ts) {
    logger.warn(
      `[split-firebase-service-providers] Could not load the TypeScript compiler API, so ${ANCHOR}()'s ` +
        `call site could not be rewritten. After the sync, add ${FIREBASE_SERVICE_CONFIGS.map((c) => `${c.providerFn}()`).join(', ')} ` +
        `beside ${ANCHOR}() in your app's providers array, importing each from './firebase-<service>.config'.`
    );
    return;
  }

  const rewritten: string[] = [];
  const alreadyDone: string[] = [];
  const unresolved: string[] = [];

  for (const appRoot of appRoots) {
    // FIND THE CALL SITES BEFORE WRITING ANYTHING. The per-service templates mention `provideAppFirebase()`
    // in their own header comments, so writing them first put four files into the app that the textual
    // prefilter below matched and the AST pass then had to reject — every app came out of the migration
    // carrying four "could not wire" warnings that were pure noise. Searching first removes the collision
    // at its source rather than filtering the symptom afterwards.
    const callSites = findAnchorCallSites(tree, appRoot);

    // Then write any sibling that isn't there yet — see the header. The generator rewrites these identically
    // moments later in a normal sync; this is what makes a bare `nx migrate` leave a project that compiles.
    writeFirebaseServiceConfigs(tree, appRoot);

    if (callSites.length === 0) {
      unresolved.push(`${appRoot} — no ${ANCHOR}() call found in a providers array`);
      continue;
    }

    let wiredHere = 0;
    for (const path of callSites) {
      const before = tree.read(path, 'utf8') ?? '';
      const result = insertServiceProviders(before, path);
      if (result === 'not-a-call-site') continue; // Names the anchor in prose, never calls it.
      if (result === 'already') {
        alreadyDone.push(path);
        wiredHere++;
      } else if (result === null) {
        unresolved.push(`${path} — ${ANCHOR}'s import does not resolve to a '${ANCHOR_MODULE_SUFFIX}' module`);
      } else {
        tree.write(path, result);
        rewritten.push(path);
        wiredHere++;
      }
    }
    // Every candidate turned out to merely MENTION the anchor — so this app has no wiring to carry, which
    // is the same finding as no candidate at all, and gets the same report.
    if (wiredHere === 0 && !unresolved.some((u) => u.startsWith(appRoot))) {
      unresolved.push(`${appRoot} — no ${ANCHOR}() call found in a providers array`);
    }
  }

  if (rewritten.length > 0) {
    logger.info(
      `[split-firebase-service-providers] ${ANCHOR}() now provides the Firebase APP only; each SDK service ` +
        `has its own file. Added ${FIREBASE_SERVICE_CONFIGS.map((c) => `${c.providerFn}()`).join(', ')} beside it in ` +
        `${rewritten.join(', ')}, so this project behaves exactly as before.\n` +
        `  TO CLAIM THE WIN: every service listed there is in your INITIAL bundle. Measured on a fresh house ` +
        `app, all four at root cost 479 kB raw against 238 kB for the Firebase app alone. Delete the ones this ` +
        `app doesn't use, and move the rest into ` +
        `the \`providers\` of the LAZILY-LOADED routes file that needs them — the file behind \`loadChildren\`, not ` +
        `the eager app.routes.ts, whose imports land in the initial bundle either way.\n` +
        `  KEEP AUTH AT ROOT if a route guard needs it: a guard runs before its route activates, so it cannot ` +
        `receive Auth from the providers of the route it guards.`
    );
  }
  if (alreadyDone.length > 0) {
    logger.info(
      `[split-firebase-service-providers] Left ${alreadyDone.join(', ')} alone — the per-service providers are ` +
        `already wired there.`
    );
  }
  if (unresolved.length > 0) {
    logger.warn(
      `[split-firebase-service-providers] Could not wire the per-service providers automatically:\n` +
        unresolved.map((u) => `  • ${u}`).join('\n') +
        `\n  ${ANCHOR}() no longer provides Auth, Firestore, Storage or Functions, so anything injecting them ` +
        `will fail with NullInjectorError until they are provided. Add the ones this app uses beside ` +
        `${ANCHOR}(): ${FIREBASE_SERVICE_CONFIGS.map((c) => `import { ${c.providerFn} } from '${c.importFrom}'`).join('; ')}.`
    );
  }

  await formatFiles(tree);
}

/** Every app root (the folder holding `src/app/firebase.config.ts`) in the workspace. */
function findFirebaseAppRoots(tree: Tree): string[] {
  const roots: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 4) return; // apps/<app>/src/app — no house layout puts it deeper.
    for (const child of tree.children(dir)) {
      if (child === 'node_modules' || child === '.git' || child.startsWith('.nx')) continue;
      const path = dir === '.' ? child : `${dir}/${child}`;
      if (!tree.isFile(path)) {
        if (tree.exists(`${path}/src/app/firebase.config.ts`)) roots.push(path);
        else walk(path, depth + 1);
      }
    }
  };
  walk('.', 0);
  return roots;
}

/** Files under the app that CALL the anchor inside an array literal — i.e. a providers array. */
function findAnchorCallSites(tree: Tree, appRoot: string): string[] {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const child of tree.children(dir)) {
      const path = `${dir}/${child}`;
      if (!tree.isFile(path)) {
        walk(path);
        continue;
      }
      if (!path.endsWith('.ts') || path.endsWith('.spec.ts')) continue;
      // firebase.config.ts DEFINES the anchor; it never calls it. Skipping it here keeps the AST pass
      // from having to tell a definition from a use.
      if (path.endsWith('/firebase.config.ts')) continue;
      const content = tree.read(path, 'utf8') ?? '';
      if (content.includes(`${ANCHOR}(`)) hits.push(path);
    }
  };
  walk(`${appRoot}/src`);
  return hits;
}

/**
 * Insert the four service providers immediately after the `provideAppFirebase()` call, plus their imports.
 *
 * @returns the updated source; `'already'` when the services are wired there; `'not-a-call-site'` when the
 *          file only MENTIONS the anchor (prose, a re-export) and never calls it inside a providers array;
 *          or `null` when it IS a call site but the anchor's import cannot be resolved to a
 *          `firebase.config` module, so the siblings' paths would be a guess. Only `null` is worth
 *          reporting — the other two are ordinary and silent.
 */
function insertServiceProviders(source: string, path: string): string | 'already' | 'not-a-call-site' | null {
  const ts = loadTypeScript();
  if (!ts) return null;
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) as TsSourceFile;

  // IS THIS A CALL SITE AT ALL? Asked FIRST, because the answer decides whether anything else is worth
  // reporting. The anchor CALL must sit directly inside an array literal — the providers array, whatever the
  // enclosing object is called. A file that merely names `provideAppFirebase()` in a comment, or re-exports
  // it, is not a wiring site and is nobody's problem.
  let anchorCall: TsNode | null = null;
  const findCall = (node: TsNode): void => {
    if (anchorCall) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === ANCHOR &&
      node.parent &&
      ts.isArrayLiteralExpression(node.parent)
    ) {
      anchorCall = node;
      return;
    }
    ts.forEachChild(node, findCall);
  };
  findCall(sf);
  if (!anchorCall) return 'not-a-call-site';

  // The anchor's own import tells us where the siblings live: they are generated beside firebase.config.ts,
  // so `./firebase.config` → `./firebase-auth.config`, `../core/firebase.config` → `../core/firebase-auth.config`.
  // Deriving the path instead of assuming `./` is what lets an app keep its config wherever it put it. This
  // IS a call site, so failing to resolve it is a real finding — hence `null`, which the caller reports.
  let anchorModule: string | null = null;
  let lastImport: TsImportDeclaration | null = null;
  const importedNames = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) break;
    lastImport = stmt;
    const named = stmt.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        importedNames.add(el.name.text);
        if (el.name.text === ANCHOR && ts.isStringLiteral(stmt.moduleSpecifier)) {
          anchorModule = stmt.moduleSpecifier.text;
        }
      }
    }
  }
  if (!anchorModule || !lastImport) return null;
  if (!anchorModule.endsWith(ANCHOR_MODULE_SUFFIX)) return null;
  const moduleBase = anchorModule.slice(0, -ANCHOR_MODULE_SUFFIX.length); // './' or '../core/'

  // Idempotency: any service already called in this file means the split has been applied here. Checked by
  // CALL, not by imported identifier — a leftover import after a hand-edit must not read as "done".
  let anyServiceCalled = false;
  const detectService = (node: TsNode): void => {
    if (anyServiceCalled) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const called = node.expression.text;
      if (FIREBASE_SERVICE_CONFIGS.some((c) => c.providerFn === called)) {
        anyServiceCalled = true;
        return;
      }
    }
    ts.forEachChild(node, detectService);
  };
  detectService(sf);
  if (anyServiceCalled) return 'already';

  const calls = FIREBASE_SERVICE_CONFIGS.map((c) => `${c.providerFn}()`).join(', ');
  const changes: StringChange[] = [
    {
      type: ChangeType.Insert,
      index: (anchorCall as TsNode).getEnd(),
      text: `, ${calls}`,
    },
  ];
  const newImports = FIREBASE_SERVICE_CONFIGS.filter((c) => !importedNames.has(c.providerFn)).map(
    (c) => `\nimport { ${c.providerFn} } from '${moduleBase}${c.fileName.replace(/\.ts$/, '')}';`
  );
  if (newImports.length > 0) {
    changes.push({ type: ChangeType.Insert, index: lastImport.getEnd(), text: newImports.join('') });
  }
  return applyChangesToString(source, changes);
}
