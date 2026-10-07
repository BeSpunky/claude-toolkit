// 0.50.0 — the processes a dev stack composes are no longer `continuous` Nx tasks.
//
// WHAT CHANGED. Nx runs ONE instance of a continuous task per workspace: a second invocation waits on the running
// one ("Waiting for <id> in another nx process") and, when that stops, reports success without having run. The
// dev engine runs one dev-server and one emulator suite PER STACK (tree + offset, each on its own shifted ports) —
// through `nx run <app>:dev-server` and `nx run firebase:emulators`. With those targets continuous, a second stack
// of the same tree (Claude testing beside the developer's server, as the house's local-server-isolation rule
// requires) never started its own processes: it waited on the first stack's, listening on the OTHER ports.
//
// The targets the engine drives are now EXPLICITLY `continuous: false` — nothing depends on them but the engine.
// Explicit, not merely absent: Nx fills an absent `continuous` from nx.json targetDefaults or the executor's schema
// (nx target-normalization), and @nx/angular's `update-21-0-0/set-continuous-option` migration sets
// `continuous: true` on a dev-server target that lacks the key — an absent key is one Nx upgrade from shared again.
// The generators write `false`; this rung writes it into projects on disk, including those whose per-app steps an
// upgrade skips (UPGRADE_PARTIAL) — so the fix never depends on a re-assertion.
//
// What it touches, exactly:
//   - the `dev-server` leaf of every house app (its `serve` — or, once serve-runs-its-own-stack has run, its
//     `dev-stack` — is @bespunky/nx-tools:serve), when the leaf is the house's — an Angular dev-server builder, the
//     only stack whose leaf the house writes;
//   - every target of the workspace `firebase` project that launches `tools/emulators.sh`.
// What it REPORTS and leaves:
//   - a leaf of another executor (the project's own dev-server) that is not explicitly `continuous: false`: a second
//     stack of that app in one tree may wait on the first — the line says how to fix it;
//   - any target that `dependsOn` one of the targets it changed: it would now wait for a server to FINISH, so it
//     must depend on `dev-stack` (the continuous stack — see serve-runs-its-own-stack) instead.
//
// SELF-CONTAINED by the migration contract: the executor list and target names are frozen here.
import { type Tree, getProjects, logger } from '@nx/devkit';
import { updateProjectConfigInPlace } from '../../generators/_utils/project-files';

const TAG = '[migrate 0.50.0 stack-owned-dev-processes]';
const SERVE_EXECUTOR = '@bespunky/nx-tools:serve';
const HOUSE_LEAF_EXECUTORS = ['@angular/build:dev-server', '@angular-devkit/build-angular:dev-server', '@nx/angular:dev-server'];
const LEAF = 'dev-server';
const FIREBASE_PROJECT = 'firebase';
const launchesSuite = (target: { executor?: string; options?: { command?: unknown } }) =>
  target.executor === 'nx:run-commands' && typeof target.options?.command === 'string' && target.options.command.includes('tools/emulators.sh');

type Target = { executor?: string; continuous?: boolean; options?: { command?: unknown }; dependsOn?: unknown[]; [key: string]: unknown };

export default function update(tree: Tree): void {
  const projects = getProjects(tree);
  /** Every `project:target` this run made non-continuous — checked against every dependsOn below. */
  const changed: { project: string; target: string }[] = [];
  /** Every `project:target` this run wrote `continuous: false` on. */
  const written: { project: string; target: string }[] = [];

  for (const [name, config] of projects) {
    const targets = (config.targets ?? {}) as Record<string, Target>;
    let touched = false;

    const leaf = targets[LEAF];
    const houseApp = [targets.serve, targets['dev-stack']].some((t) => t && typeof t === 'object' && t.executor === SERVE_EXECUTOR);
    if (houseApp && leaf && typeof leaf === 'object' && leaf.continuous !== false) {
      if (HOUSE_LEAF_EXECUTORS.includes(leaf.executor ?? '')) {
        const was = leaf.continuous;
        leaf.continuous = false;
        touched = true;
        if (was) changed.push({ project: name, target: LEAF });
        written.push({ project: name, target: LEAF });
        logger.info(`${TAG} ${name}:${LEAF} is now explicitly not continuous — the dev engine runs one per stack.`);
      } else {
        logger.warn(
          `${TAG} ${name}:${LEAF} (${leaf.executor}) is your own dev-server, so it was left as is — and it is not ` +
            `"continuous": false, so Nx may run it as a continuous task (${leaf.continuous ? 'it says so' : 'from its executor schema or nx.json targetDefaults'}). ` +
            `Then a second stack of ${name} in the same tree waits on the first instead of starting. ` +
            `Set "continuous": false on it in ${config.root}/project.json unless something depends on it.`,
        );
      }
    }

    if (name === FIREBASE_PROJECT) {
      for (const [targetName, target] of Object.entries(targets)) {
        if (!target || typeof target !== 'object' || target.continuous === false || !launchesSuite(target)) continue;
        const was = target.continuous;
        target.continuous = false;
        touched = true;
        if (was) changed.push({ project: name, target: targetName });
        written.push({ project: name, target: targetName });
        logger.info(`${TAG} ${name}:${targetName} is now explicitly not continuous — the dev engine runs one suite per stack.`);
      }
    }

    // In place: only the `continuous` members change — devkit's updateProjectConfiguration rebuilt each target and
    // moved its `options` below `dependsOn`. An existing key keeps its position; a new one leads the target.
    if (touched) updateProjectConfigInPlace(tree, config.root, (onDisk) => {
      for (const { target } of written.filter((c) => c.project === name)) {
        const t = onDisk.targets?.[target] as Target | undefined;
        if (!t) continue;
        if ('continuous' in t) t.continuous = false;
        else onDisk.targets![target] = { continuous: false, ...t } as never;
      }
    });
  }

  if (!changed.length) return;
  // A dependent of a now non-continuous server would wait for it to finish — forever. Nothing the house writes
  // depends on them; anything that does was hand-written, so it is reported, not rewritten.
  for (const [name, config] of getProjects(tree)) {
    for (const [targetName, target] of Object.entries((config.targets ?? {}) as Record<string, Target>)) {
      for (const dep of target?.dependsOn ?? []) {
        const hit = changed.find((c) => dependsOnHits(dep, name, c));
        if (hit) {
          logger.warn(
            `${TAG} ${name}:${targetName} depends on ${hit.project}:${hit.target}, which is no longer continuous — it would wait ` +
              `for a server to exit. Depend on the app's \`dev-stack\` instead (the continuous stack, which Nx shares).`,
          );
        }
      }
    }
  }
}

/** Does one `dependsOn` entry (string or object form) name `c` from project `from`? */
function dependsOnHits(dep: unknown, from: string, c: { project: string; target: string }): boolean {
  if (typeof dep === 'string') {
    if (dep.startsWith('^')) return false;
    const [p, t] = dep.includes(':') ? dep.split(':') : [from, dep];
    return p === c.project && t === c.target;
  }
  if (!dep || typeof dep !== 'object') return false;
  const d = dep as { target?: string; projects?: string | string[]; dependencies?: boolean };
  if (d.target !== c.target || d.dependencies) return false;
  const projects = d.projects === undefined ? [from] : [d.projects].flat();
  return projects.includes(c.project);
}
