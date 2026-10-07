// 0.50.0 — the processes a dev stack composes are no longer `continuous` Nx tasks.
//
// WHAT CHANGED. Nx runs ONE instance of a continuous task per workspace: a second invocation waits on the running
// one ("Waiting for <id> in another nx process") and, when that stops, reports success without having run. The
// dev engine runs one dev-server and one emulator suite PER STACK (tree + offset, each on its own shifted ports) —
// through `nx run <app>:dev-server` and `nx run firebase:emulators`. With those targets continuous, a second stack
// of the same tree (Claude testing beside the developer's server, as the house's local-server-isolation rule
// requires) never started its own processes: it waited on the first stack's, listening on the OTHER ports.
//
// A stack's identity now lives at ONE level: the `serve` composer stays continuous (the Nx-visible stack, which an
// e2e target may depend on and share), and the targets the engine drives lose `continuous` — nothing depends on
// them but the engine. The generators stop writing it; this rung clears it from projects on disk, including those
// whose per-app steps an upgrade skips (UPGRADE_PARTIAL) — so the fix never depends on a re-assertion.
//
// What it touches, exactly:
//   - the `dev-server` leaf of every project whose `serve` is the house composer, when the leaf is the house's —
//     an Angular dev-server builder, the only stack whose leaf the house writes;
//   - every target of the workspace `firebase` project that launches `tools/emulators.sh`.
// What it REPORTS and leaves:
//   - a continuous leaf of another executor (the project's own dev-server): a second stack of that app in one tree
//     still waits — the line says how to fix it;
//   - any target that `dependsOn` one of the targets it changed: it would now wait for a server to FINISH, so it
//     must depend on `serve` (the continuous stack) instead.
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

type Target = { executor?: string; continuous?: boolean; options?: { command?: unknown }; dependsOn?: unknown[] };

export default function update(tree: Tree): void {
  const projects = getProjects(tree);
  /** Every `project:target` this run made non-continuous — checked against every dependsOn below. */
  const changed: { project: string; target: string }[] = [];

  for (const [name, config] of projects) {
    const targets = (config.targets ?? {}) as Record<string, Target>;
    let touched = false;

    const serve = targets.serve;
    const leaf = targets[LEAF];
    if (serve && typeof serve === 'object' && serve.executor === SERVE_EXECUTOR && leaf && typeof leaf === 'object' && leaf.continuous) {
      if (HOUSE_LEAF_EXECUTORS.includes(leaf.executor ?? '')) {
        delete leaf.continuous;
        touched = true;
        changed.push({ project: name, target: LEAF });
        logger.info(`${TAG} ${name}:${LEAF} is no longer continuous — the dev engine runs one per stack.`);
      } else {
        logger.warn(
          `${TAG} ${name}:${LEAF} (${leaf.executor}) is continuous and is your own dev-server, so it was left as is. ` +
            `While it stays continuous, a second stack of ${name} in the same tree waits on the first instead of starting. ` +
            `Remove "continuous" from it in ${config.root}/project.json unless something depends on it.`,
        );
      }
    }

    if (name === FIREBASE_PROJECT) {
      for (const [targetName, target] of Object.entries(targets)) {
        if (!target || typeof target !== 'object' || !target.continuous || !launchesSuite(target)) continue;
        delete target.continuous;
        touched = true;
        changed.push({ project: name, target: targetName });
        logger.info(`${TAG} ${name}:${targetName} is no longer continuous — the dev engine runs one suite per stack.`);
      }
    }

    // In place: only the `continuous` members go — devkit's updateProjectConfiguration rebuilt each target and
    // moved its `options` below `dependsOn`.
    if (touched) updateProjectConfigInPlace(tree, config.root, (onDisk) => {
      for (const { target } of changed.filter((c) => c.project === name)) delete (onDisk.targets?.[target] as Target | undefined)?.continuous;
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
              `for a server to exit. Depend on the app's \`serve\` instead (the continuous stack, which Nx shares).`,
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
