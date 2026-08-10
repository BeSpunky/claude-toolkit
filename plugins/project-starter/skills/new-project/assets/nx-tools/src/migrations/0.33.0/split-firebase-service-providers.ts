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
// IT ALSO WRITES THE FILES IT IMPORTS — ALL FIVE OF THEM. The house sync runs
// `probe → install → migrate → detect → generate`, so when this runs the per-service files do not exist
// yet; the firebase-emulators generator writes them afterwards. That is fine for a `scaffold.sh --sync`
// naming the app, and broken everywhere else: a bare `nx migrate`, a SYNC_PARTIAL run (the per-app
// generators are skipped when the sync cannot resolve the app), and every app in a multi-app workspace
// except the one the sync names. So the whole set is written here from the SAME templates the generator
// uses (shared via generators/firebase-emulators/service-configs), and the generator's later rewrite is
// byte-identical.
//
// `firebase.config.ts` is in that set for a reason that is easy to miss: the siblings import
// `emulatorFor` / `portOffset` / `offsetUrl` from it, and 0.32.x kept those module-PRIVATE. Write the
// siblings beside an old root file and the project stops compiling, at `tsc`, nowhere near this migration.
import { type Tree, logger, formatFiles, applyChangesToString, ChangeType, type StringChange } from '@nx/devkit';
import {
  loadTypeScript,
  type TsImportDeclaration,
  type TsNode,
  type TsSourceFile,
} from '../../generators/_utils/typescript-api';
import { findProviderCallSites } from '../../generators/_utils/provider-call-sites';
import { findAppRoots } from '../../generators/_utils/app-roots';
import {
  FIREBASE_SERVICE_CONFIGS,
  writeFirebaseConfigs,
} from '../../generators/firebase-emulators/service-configs';

/** The provider whose meaning narrowed — the anchor everything here is found by. */
const ANCHOR = 'provideAppFirebase';

/** What happened to one service at one call site. */
type ServiceOutcome = 'inserted' | 'already' | 'name-taken';

export default async function splitFirebaseServiceProviders(tree: Tree): Promise<void> {
  // Every app carrying the generator-owned firebase.config.ts. Found by walking for the file rather than
  // by reading project configuration, so an app whose project.json shape this migration doesn't
  // anticipate is still covered. The walk refuses to enter dot-directories, build output and nested
  // checkouts — see _utils/app-roots for why that is load-bearing and not merely tidy.
  const appRoots = findAppRoots(tree, (root) => tree.exists(`${root}/src/app/firebase.config.ts`));
  if (appRoots.length === 0) return; // Not a Firebase project (or never wired) — nothing owed.

  if (!loadTypeScript()) {
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
    // in their own header prose; `findProviderCallSites` is parser-based and ignores prose, but searching
    // first is still the honest order — the question is what THIS project wired, and files this migration
    // is about to write are not part of the answer.
    const callSites = findProviderCallSites(tree, `${appRoot}/src`, ANCHOR) ?? [];

    // Then write the WHOLE generated config set — see the header. Deliberately including
    // `firebase.config.ts` itself: the siblings import `emulatorFor`/`portOffset`/`offsetUrl` from it, and
    // those are only EXPORTED from 0.33.0 on.
    writeFirebaseConfigs(tree, appRoot);

    if (callSites.length === 0) {
      unresolved.push(`${appRoot} — no ${ANCHOR}() call found in a providers array`);
      continue;
    }

    for (const path of callSites) {
      const before = tree.read(path, 'utf8') ?? '';
      const { source, outcomes } = insertServiceProviders(before, path, appRoot);
      const taken = FIREBASE_SERVICE_CONFIGS.filter((c) => outcomes[c.providerFn] === 'name-taken');
      if (taken.length > 0) {
        unresolved.push(
          `${path} — ${taken.map((c) => `${c.providerFn}`).join(', ')} already imported from another module, ` +
            `so the Firebase one could not be added under that name`
        );
      }
      if (source !== before) {
        tree.write(path, source);
        rewritten.push(path);
      } else if (taken.length === 0) {
        alreadyDone.push(path);
      }
    }
  }

  if (rewritten.length > 0) {
    logger.info(
      `[split-firebase-service-providers] ${ANCHOR}() now provides the Firebase APP only; each SDK service ` +
        `has its own file. Added the per-service providers beside it in ${rewritten.join(', ')}, so this ` +
        `project behaves exactly as before.\n` +
        `  TO CLAIM THE WIN: every service listed there is in your INITIAL bundle. Measured on a fresh house ` +
        `app, all four at root cost 479 kB raw against 238 kB for the Firebase app alone. Delete the ones this ` +
        `app doesn't use, and move the rest into the \`providers\` of the LAZILY-LOADED routes file that needs ` +
        `them — the file behind \`loadChildren\`, not the eager app.routes.ts, whose imports land in the ` +
        `initial bundle either way.\n` +
        `  KEEP AUTH AT ROOT if a guard named in the eager app.routes.ts needs it: that guard is statically ` +
        `imported by the initial chunk, so its inject(Auth) pins @angular/fire/auth there wherever the ` +
        `provider itself is written.`
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
        `${ANCHOR}(), importing each from its './firebase-<service>.config' file. (An app that never had ` +
        `${ANCHOR}() wired at all is repaired by migration 0.33.1 instead.)`
    );
  }

  await formatFiles(tree);
}

/**
 * Insert every missing service provider at EVERY `provideAppFirebase()` call in this file, plus the
 * imports the new calls need.
 *
 * @returns the updated source (unchanged when there was nothing to add) and, per provider, what happened.
 */
function insertServiceProviders(
  source: string,
  path: string,
  appRoot: string
): { source: string; outcomes: Record<string, ServiceOutcome> } {
  const outcomes: Record<string, ServiceOutcome> = {};
  const ts = loadTypeScript();
  if (!ts) return { source, outcomes };
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) as TsSourceFile;

  // EVERY anchor call inside an array literal, not just the first — a file can legitimately hold a browser
  // config and a server config, and half-migrating it is worse than not touching it.
  const anchorCalls: TsNode[] = [];
  const findCalls = (node: TsNode): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === ANCHOR &&
      node.parent &&
      ts.isArrayLiteralExpression(node.parent)
    ) {
      anchorCalls.push(node);
      return;
    }
    ts.forEachChild(node, findCalls);
  };
  findCalls(sf);
  if (anchorCalls.length === 0) return { source, outcomes };

  // Where each symbol is imported FROM, resolved to a workspace path when the specifier is relative. This
  // is what lets identity rather than name decide whether a service is already wired.
  const importedFrom = new Map<string, string | null>(); // symbol → resolved path, or null when non-relative
  let lastImport: TsImportDeclaration | null = null;
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) break;
    lastImport = stmt;
    const named = stmt.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const spec = stmt.moduleSpecifier.text;
    const resolved = spec.startsWith('.') ? resolveRelative(dirOf(path), spec) : null;
    for (const el of named.elements) importedFrom.set(el.name.text, resolved);
  }
  if (!lastImport) return { source, outcomes };

  // Which providers are called ANYWHERE in this file (by name — combined with importedFrom below, that is
  // enough to tell our provider from a same-named one).
  const calledNames = new Set<string>();
  const collectCalls = (node: TsNode): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) calledNames.add(node.expression.text);
    ts.forEachChild(node, collectCalls);
  };
  collectCalls(sf);

  const configDir = `${appRoot}/src/app`;
  const toInsert: string[] = [];
  const newImports: string[] = [];

  for (const cfg of FIREBASE_SERVICE_CONFIGS) {
    const ourModulePath = `${configDir}/${cfg.fileName.replace(/\.ts$/, '')}`;
    const importedSource = importedFrom.get(cfg.providerFn);

    if (importedSource !== undefined && importedSource !== ourModulePath) {
      // The name is taken by something else. Adding our import would be a duplicate identifier, and
      // picking a winner is a decision about the app, not about this migration.
      outcomes[cfg.providerFn] = 'name-taken';
      continue;
    }
    if (importedSource === ourModulePath && calledNames.has(cfg.providerFn)) {
      outcomes[cfg.providerFn] = 'already';
      continue;
    }
    outcomes[cfg.providerFn] = 'inserted';
    toInsert.push(`${cfg.providerFn}()`);
    if (importedSource === undefined) {
      newImports.push(`\nimport { ${cfg.providerFn} } from '${relativeSpecifier(dirOf(path), ourModulePath)}';`);
    }
  }

  if (toInsert.length === 0) return { source, outcomes };

  const changes: StringChange[] = anchorCalls.map((call) => ({
    type: ChangeType.Insert,
    index: call.getEnd(),
    text: `, ${toInsert.join(', ')}`,
  }));
  if (newImports.length > 0) {
    changes.push({ type: ChangeType.Insert, index: lastImport.getEnd(), text: newImports.join('') });
  }
  return { source: applyChangesToString(source, changes), outcomes };
}

/** The directory part of a workspace-relative file path. */
function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '.' : path.slice(0, i);
}

/** Resolve a relative module specifier against a directory, as a workspace-relative path (no extension). */
function resolveRelative(fromDir: string, spec: string): string {
  const parts = `${fromDir}/${spec}`.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** The module specifier that gets from `fromDir` to `targetPath` (extensionless), always `./` or `../`. */
function relativeSpecifier(fromDir: string, targetPath: string): string {
  const from = fromDir.split('/').filter((p) => p && p !== '.');
  const to = targetPath.split('/').filter((p) => p && p !== '.');
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++;
  const up = from.length - shared;
  const down = to.slice(shared).join('/');
  return up === 0 ? `./${down}` : `${'../'.repeat(up)}${down}`;
}
