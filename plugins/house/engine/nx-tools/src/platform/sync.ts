// The platform sync generator's registration: a GLOBAL sync generator (nx.json `sync.globalGenerators`), run by
// `nx sync` and checked by `nx sync:check` — never before a task.
//
// WHY NOT ON THE LINT TARGET (0.50.0's first design, `targetDefaults.<lint>.syncGenerators`). Nx runs a task's sync
// generators before the task, and outside a terminal (`process.stdout.isTTY` false — Claude's Bash, a script, a git
// hook) it does not prompt: any pending change ends the run with "The workspace is out of sync" and exit 1, before
// anything was linted (nx tasks-runner/run-command — `sync.applyChanges: true` does not change that path). So one
// untagged library anywhere stopped `nx lint` of every project, and `nx run functions:deploy` (which depends on
// lint), for an agent — for a label, not a defect. On CI Nx skips task sync generators altogether (`isCI()`), so
// the registration bought no enforcement there either. Enforcement is lint's: the firewall fails an untagged
// project's imports, and every import of one, on its own (./firewall); this generator is the CONVENIENCE that
// fixes, in one command, every project whose evidence settles its platform — and lint's guidance names it.
//
// Registered only where a firewall exists: a classification nothing enforces is a label nobody checks.
import { type Tree } from '@nx/devkit';
import { updateJsonInPlace } from '../generators/_utils/json-edits';

export const PLATFORM_SYNC = '@bespunky/nx-tools:platform-sync';

/** Register the sync generator as a global one. True when it changed nx.json. */
export function registerPlatformSync(tree: Tree): boolean {
  if (!tree.exists('nx.json')) return false;
  return updateJsonInPlace<{ sync?: { globalGenerators?: string[] } }>(tree, 'nx.json', (nxJson) => {
    const sync = (nxJson.sync ??= {});
    if (!(sync.globalGenerators ?? []).includes(PLATFORM_SYNC)) sync.globalGenerators = [...(sync.globalGenerators ?? []), PLATFORM_SYNC];
  });
}
