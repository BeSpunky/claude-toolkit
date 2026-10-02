// House generator: attach the Firebase CLIENT to one app — the per-app half of the Firebase layer.
//
// The emulator suite, Cloud Functions, App Hosting config and the scripts are the framework-neutral CORE
// (`firebase-emulators`). What an app needs on top of them depends on its framework — environment files, the
// SDK initialisation, the provider in its bootstrap — so this generator asks the app's STACK ADAPTER for its
// `firebase` port and lets it do the wiring. An app whose stack has no such port is REPORTED and left alone:
// a Node service or a Python app beside Firebase is a legitimate shape, not an error.
//
// The one framework-neutral act here is the `platform:web` tag, which puts the app under the core's
// platform firewall (server-only SDKs never reach browser code).
//
// Composed by the `app` generator (every later app in a Firebase workspace is wired with no flag), and run per
// app by the `firebase` layer on a sync.
import { type Tree, type GeneratorCallback, readProjectConfiguration, updateProjectConfiguration, formatFiles } from '@nx/devkit';
import { portOf } from '../../adapters/registry';

export interface FirebaseClientSchema {
  project: string;
  /** The WORKSPACE identity that seeds the offline `demo-<workspaceName>` project id. */
  workspaceName?: string;
  staging?: boolean;
  /** See wireProviders in schema.json — wiring is a BASELINE act, never a sync-time one. */
  wireProviders?: boolean;
  skipFormat?: boolean;
}

const noop: GeneratorCallback = () => {};

export default async function firebaseClientGenerator(
  tree: Tree,
  options: FirebaseClientSchema,
): Promise<GeneratorCallback> {
  if (!options.project) throw new Error('firebase-client generator requires --project=<app>.');

  const client = portOf(tree, options.project, 'firebase', 'firebase-client', 'the Firebase client wiring');
  if (!client) return noop;

  const config = readProjectConfiguration(tree, options.project);
  config.tags = [...new Set([...(config.tags ?? []), 'platform:web'])];
  updateProjectConfiguration(tree, options.project, config);

  const install = client.attach(tree, options.project, {
    workspaceName: options.workspaceName ?? options.project,
    staging: options.staging === true,
    wireProviders: options.wireProviders === true,
  });

  if (!options.skipFormat) await formatFiles(tree);
  return install;
}
