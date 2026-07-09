// House generator: create a BeSpunky-standard Angular application.
//
// The application sibling of `publishable-lib`. It is the SINGLE SOURCE OF TRUTH for "what a
// BeSpunky app is", so the FIRST app (created by scaffold.sh) and every LATER app a developer
// adds go through ONE code path — a second app is configured identically to the first, with no
// manual steps and no knowledge of the house conventions required.
//
// Delegate-then-configure (the same idiom as publishable-lib):
//   1. Delegate the app scaffold to @nx/angular:application with the house defaults
//      (minimal, scss, routing, no e2e). These defaults USED to live, duplicated, in scaffold.sh's
//      raw `nx g @nx/angular:application` call AND in the project's CLAUDE.md "add another app"
//      snippet; both now point here, so the app shape is defined in exactly one place.
//   2. Compose the house per-app generators against the freshly-created project:
//        - serve-options (always)        — host 0.0.0.0, so the dev server is reachable from
//                                          outside the devcontainer.
//        - firebase-emulators (when the workspace is a Firebase workspace) — environment files,
//                                          firebase.config.ts, app.config wiring, the production
//                                          fileReplacements, the platform:web tag, and the serve
//                                          orchestrator. This is the per-app slice that a raw
//                                          `nx g @nx/angular:application` leaves out entirely.
//
// Two decisions make a later app correct-by-construction:
//   - Firebase is SELF-DETECTING. An explicit --firebase wins (the scaffolder's first app is
//     created BEFORE firebase.json exists, so it passes the flag); otherwise it is inferred from
//     the presence of firebase.json at the workspace root. So a developer adding a second app to a
//     Firebase workspace just runs `nx g @bespunky/nx-tools:app apps/<name>` and gets the full
//     Firebase wiring — no flag, no recollection that this is a Firebase workspace.
//   - workspaceName is a WORKSPACE identity, not an app one. It seeds the emulators' offline
//     `demo-<workspaceName>` project id and is baked into the always-rewritten tools/*.sh scripts,
//     so it is resolved ONCE from the workspace root — never from the new app's name. (Passing the
//     new app's name, as the firebase-emulators default would, corrupts those workspace-level
//     scripts the moment a second app is added.)
import {
  type Tree,
  type GeneratorCallback,
  getProjects,
  readProjectConfiguration,
  formatFiles,
} from '@nx/devkit';
import { basename } from 'node:path';
import serveOptionsGenerator from '../serve-options/generator';
import worktreeServeGenerator from '../worktree-serve/generator';
import firebaseEmulatorsGenerator from '../firebase-emulators/generator';

interface AppGeneratorSchema {
  // Workspace-relative directory for the app, e.g. `apps/<name>` (positional arg 0).
  directory: string;
  // Explicit project name. Defaults to the directory's last segment (matching @nx/angular).
  name?: string;
  // Tri-state Firebase opt-in: true/false override; UNSET → auto-detect from firebase.json.
  firebase?: boolean;
  // The component/directive style. House default: scss.
  style?: string;
  // Override the resolved workspace identity (internal — the default is correct everywhere).
  workspaceName?: string;
  skipFormat?: boolean;
}

const noop: GeneratorCallback = () => {};

export default async function appGenerator(
  tree: Tree,
  options: AppGeneratorSchema
): Promise<GeneratorCallback> {
  if (!options.directory) {
    throw new Error(
      'app generator requires a directory (positional arg 0 / --directory), e.g. `apps/<name>`.'
    );
  }

  const style = options.style ?? 'scss';

  // 1) Delegate to @nx/angular:application with the house defaults. We skipFormat the delegate and
  //    run a single formatFiles at the end (so the base output + our config land formatted once).
  //
  //    These option names are NOT guessed: they are the exact, proven-good CLI flags scaffold.sh
  //    has always passed (`--minimal --style=scss --routing --e2eTestRunner=none`), expressed
  //    programmatically. The export `applicationGenerator` from '@nx/angular/generators' mirrors the
  //    publishable-lib generator's `libraryGenerator` import; VERIFY both against the installed
  //    @nx/angular schema (`nx g @nx/angular:application --help`) if a future Nx renames them.
  const { applicationGenerator } = await import('@nx/angular/generators');
  const appCallback =
    (await applicationGenerator(tree, {
      directory: options.directory,
      ...(options.name ? { name: options.name } : {}),
      style,
      routing: true,
      minimal: true,
      e2eTestRunner: 'none',
      skipFormat: true,
    } as Parameters<typeof applicationGenerator>[1])) ?? noop;

  // Resolve the project name @nx/angular:application actually emitted, so the per-app generators
  // target it (rather than guessing). The basename matches scaffold's historical `--project=$APP`;
  // the getProjects() fallback covers any Nx version that derives a different name from the path.
  const projectName = resolveEmittedProjectName(tree, options.directory, options.name);

  // 2) Per-app house config: make the dev server reachable from outside the devcontainer.
  await serveOptionsGenerator(tree, { project: projectName });

  // 2b) Per-app house config: the `serve-worktree` target, so an in-flight git worktree can be
  //     served without merging it back. Deploy-/framework-agnostic (delegates to this project's
  //     own `serve`), so it applies to every app regardless of the Firebase opt-in below.
  await worktreeServeGenerator(tree, { project: projectName });

  // 3) Firebase per-app wiring — explicit flag wins; otherwise auto-detect a Firebase workspace.
  const firebase = options.firebase ?? tree.exists('firebase.json');
  let firebaseCallback: GeneratorCallback = noop;
  if (firebase) {
    firebaseCallback =
      (await firebaseEmulatorsGenerator(tree, {
        project: projectName,
        workspaceName: options.workspaceName ?? basename(tree.root),
      })) ?? noop;
  }

  if (!options.skipFormat) {
    await formatFiles(tree);
  }

  // Run both delegates' post-commit callbacks (each may trigger a package-manager install).
  return () => {
    appCallback();
    firebaseCallback();
  };
}

/**
 * Resolve the project name the base @nx/angular:application generator emitted for `directory`.
 *
 * Fast path: an explicit `name`, else the directory's last segment — which is what Nx names a
 * project created at `apps/<name>` (and what scaffold.sh has always passed as `--project=$APP`).
 * Fallback: if that name isn't in the workspace, scan for the project whose `root` matches the
 * requested directory (covers any Nx version whose path→name derivation differs). Throws an
 * actionable error rather than letting a downstream generator fail cryptically.
 */
function resolveEmittedProjectName(
  tree: Tree,
  directory: string,
  explicitName?: string
): string {
  if (explicitName) return explicitName;

  const base = basename(directory);
  try {
    readProjectConfiguration(tree, base);
    return base;
  } catch {
    // fall through to the root-match scan
  }

  const wanted = directory.replace(/\/+$/, '');
  for (const [name, config] of getProjects(tree)) {
    if (config.root === wanted) return name;
  }

  throw new Error(
    `[app] Could not resolve the project name @nx/angular:application emitted for directory ` +
      `"${directory}". Pass an explicit --name.`
  );
}
