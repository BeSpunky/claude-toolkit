// ATTACH — give one app everything the workspace's layers give an app, by running those layers' per-app steps.
//
// This is what made the `app` generator a fixed composition list (serve, serve-options, design-system-styles,
// firebase-emulators) and why a new capability was an edit to it. A capability already DECLARES what it does
// to an app: its descriptor's `generators.app` steps, which a sync runs against the sync's app. A new app is
// owed exactly the same thing, so the app generator runs exactly those steps — the plan and the app share one
// statement of "what this capability attaches", and a new capability attaches to new apps by being registered.
//
// Steps are run IN PROCESS (the factories `nx g` would load, resolved through this package's generators.json),
// with the plan's argv words parsed back into options — the same words a sync passes, so the two paths cannot
// drift. Creation is the baseline act, so every active layer counts as ENSURED (provider wiring happens now
// or never; see _utils/wire-provider).
import { type Tree, type GeneratorCallback, logger } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LayerId, PlanContext } from '../../layers/descriptor';
import { LAYERS } from '../../layers/registry';

type Factory = (tree: Tree, options: Record<string, unknown>) => Promise<GeneratorCallback | void> | GeneratorCallback | void;

const PACKAGE_ROOT = join(__dirname, '..', '..', '..');

export interface AttachContext {
  app: string;
  /** The workspace identity (seeds demo project ids, the tab label's base host). */
  workspaceName: string;
  /** Detected ∪ what this run is bringing into being. */
  active: ReadonlySet<LayerId>;
  staging: boolean;
}

export async function attachCapabilities(tree: Tree, context: AttachContext): Promise<GeneratorCallback[]> {
  const ctx: PlanContext = {
    tree,
    mode: 'upgrade',
    active: context.active,
    ensured: context.active,
    project: context.workspaceName,
    app: context.app,
    voice: false,
    staging: context.staging,
  };

  const callbacks: GeneratorCallback[] = [];
  for (const layer of LAYERS) {
    if (!context.active.has(layer.id)) continue;
    const missing = layer.requires.filter((required) => !context.active.has(required));
    if (missing.length) {
      logger.warn(`[app] The ${layer.id} layer needs ${missing.join(', ')} — not attached to \`${context.app}\`.`);
      continue;
    }
    for (const step of layer.generators?.app ?? []) {
      const skipped = step.skip?.(ctx);
      if (skipped) {
        logger.info(`[app] ${skipped.reason}`);
        continue;
      }
      const callback = await factory(step.generator)(tree, { ...options(step.args?.(ctx) ?? []), skipFormat: true });
      if (typeof callback === 'function') callbacks.push(callback);
    }
  }
  return callbacks;
}

/** The generator factory `nx g @bespunky/nx-tools:<name>` would load. */
function factory(name: string): Factory {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'generators.json'), 'utf8')) as {
    generators: Record<string, { factory: string }>;
  };
  const entry = manifest.generators[name];
  if (!entry) throw new Error(`[app] A layer names the generator "${name}", which this package does not ship.`);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loaded = require(join(PACKAGE_ROOT, entry.factory)) as { default?: Factory } & Factory;
  return loaded.default ?? loaded;
}

/** The plan's argv words (`--k=v`, `--flag`) back into an options object, booleans coerced as `nx g` would. */
function options(words: readonly string[]): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  for (const word of words) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(word);
    if (!match) throw new Error(`[app] Unexpected positional plan argument "${word}".`);
    const [, key, value] = match;
    parsed[key] = value === undefined || value === 'true' ? true : value === 'false' ? false : value;
  }
  return parsed;
}
