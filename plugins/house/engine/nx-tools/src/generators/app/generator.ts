// House generator: create a BeSpunky-standard application.
//
// The application sibling of `publishable-lib`, and the SINGLE SOURCE OF TRUTH for "what a BeSpunky app is", so
// the FIRST app (created by house.sh) and every LATER app a developer adds go through ONE code path — a second
// app is configured identically to the first, with no manual steps and no knowledge of the house conventions.
//
// Two halves, and neither names a capability:
//   1. CREATE — the stack adapter's `apps` port (src/adapters/<stack>): Angular today, with the house defaults
//      (minimal, scss, routing, no e2e). `--stack` picks one; the default is the workspace's own.
//   2. ATTACH — every capability the workspace wears gives the new app what it gives an app on a sync: its
//      layer's per-app steps (the web dev loop, the design system's sass channel and provider, the Firebase
//      client, …), run through ./attach. There is no composition list here to forget a capability in; a new
//      capability attaches to new apps by being registered.
//
// What the workspace "wears" is DETECTED, plus whatever this run is bringing into being alongside the app:
// `--layers` (house.sh passes its ensure set — at first-app time nothing it ensures exists yet, so nothing
// could be detected) and the legacy `--firebase` (an explicit true/false still overrides firebase.json detection).
//
// workspaceName is a WORKSPACE identity, not an app one. It seeds the emulators' offline `demo-<workspaceName>`
// project id and the tab label's base host, so it is resolved ONCE from the workspace root — never from the new
// app's name (which corrupted the workspace-level scripts the moment a second app was added).
import { type Tree, type GeneratorCallback, formatFiles } from '@nx/devkit';
import { detectLayers, inRegistryOrder, isPresent, layer } from '../../layers/registry';
import { ADAPTERS, adapter } from '../../adapters/registry';
import { workspaceStackWith } from '../../adapters/workspace';
import { attachCapabilities } from './attach';
import { resolveAppsDir } from '../_utils/workspace-layout';
import { joinWorkspace } from '../_utils/project-files';
import { workspaceIdentity } from '../_utils/workspace-identity';

interface AppGeneratorSchema {
  // Workspace-relative directory for the app (positional arg 0). Default: `<appsDir>/<name>`.
  directory?: string;
  // Explicit project name. Defaults to the directory's last segment.
  name?: string;
  // The stack to create the app with (an adapter id). Default: the workspace's stack that can create apps.
  stack?: string;
  // Layers this run is bringing into being alongside the app (csv) — attached as if detected.
  layers?: string;
  // Legacy tri-state Firebase opt-in: true/false override; UNSET → detected from firebase.json.
  firebase?: boolean;
  // Opt-in (Firebase only): also scaffold the staging environment bundle.
  staging?: boolean;
  // The component/directive style. House default: scss.
  style?: string;
  // Override the resolved workspace identity (internal — the default is correct everywhere).
  workspaceName?: string;
  skipFormat?: boolean;
}

export default async function appGenerator(tree: Tree, options: AppGeneratorSchema): Promise<GeneratorCallback> {
  // WHERE: the directory given, else the app's name in the workspace's apps directory — the same answer every
  // other house generator lands an app on (`resolveAppsDir`: nx.json `workspaceLayout`, else where the
  // workspace's apps already live, else `apps/`). A bare name is never guessed to be a directory or vice versa.
  const directory = options.directory ?? (options.name ? `${resolveAppsDir(tree)}/${options.name}` : undefined);
  if (!directory) {
    throw new Error(
      'app generator needs a directory (positional arg 0 / --directory) or a --name — with only a name, the app ' +
        `goes to ${resolveAppsDir(tree)}/<name>, this workspace's apps directory.`,
    );
  }

  // 1) CREATE, through the stack. Its precondition is stated here, as a sentence, rather than surfacing as a
  //    module-resolution trace from inside the framework's own generator.
  const stack = options.stack ? adapter(options.stack) : workspaceStackWith(tree, 'apps');
  if (!stack?.apps) {
    const creators = ADAPTERS.filter((a) => a.apps);
    throw new Error(
      `[app] ${options.stack ? `The ${options.stack} stack cannot create apps` : 'No stack in this workspace can create apps'} ` +
        `(stacks that can: ${creators.map((a) => a.id).join(', ')}). Add one — ` +
        `${creators.map((a) => `${a.id}: ${layer(a.layer).ensureHint}`).join('; ')} — and re-run.`,
    );
  }
  if (!isPresent(tree, stack.layer)) {
    throw new Error(`[app] The ${stack.id} stack needs the \`${stack.layer}\` layer, which this workspace does not have.`);
  }
  // Firebase constrains the framework version a fresh workspace is created at (@angular/fire supports only some
  // Angular majors), so it is asked BEFORE the app — and with it the framework — exists.
  const wearsFirebase =
    options.firebase ?? (csv(options.layers).includes('firebase') || detectLayers(tree).includes('firebase'));
  if (wearsFirebase) stack.firebase?.chooseFrameworkVersion?.(tree);

  const { project, callback } = await stack.apps.create(tree, {
    directory,
    name: options.name,
    style: options.style ?? 'scss',
  });

  // The framework's generator decides the app's files; the WORKSPACE decides whether that makes it a member.
  joinWorkspace(tree, directory);

  // 2) ATTACH every capability the workspace wears.
  const active = new Set([...detectLayers(tree), ...inRegistryOrder(csv(options.layers))]);
  if (options.firebase === true) active.add('firebase');
  if (options.firebase === false) active.delete('firebase');
  const attached = await attachCapabilities(tree, {
    app: project,
    workspaceName: options.workspaceName ?? workspaceIdentity(tree),
    active,
    staging: options.staging === true,
  });

  if (!options.skipFormat) await formatFiles(tree);

  // Every delegate's post-commit callback (each may trigger a package-manager install).
  return () => {
    callback();
    for (const run of attached) run();
  };
}

function csv(value: string | undefined): string[] {
  return (value ?? '').split(',').map((part) => part.trim()).filter(Boolean);
}
