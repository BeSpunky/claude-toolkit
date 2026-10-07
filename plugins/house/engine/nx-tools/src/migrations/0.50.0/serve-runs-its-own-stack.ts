// 0.50.0 — `nx serve <app>` is its own stack, and ends with its exit status: `serve` stops being continuous, and its
// continuous twin `dev-stack` is what an e2e target depends on.
//
// WHAT CHANGED. Two Nx rules about CONTINUOUS tasks made the shipped `serve` (the continuous composer) wrong twice:
//   - Nx completes a continuous task that ends while nothing depends on it as SUCCEEDED, whatever its exit code. So
//     `nx serve <app>` with a dead stack (emulators without Java, a dev-server that failed to bind) printed
//     "succeeded" and exited 0 — and background runners, an agent's included, trust that.
//   - Nx shares a continuous task between invocations of one workspace. So a second `nx serve <app>` — Claude testing
//     beside the developer's server, as the house's local-server-isolation rule requires — did not start a stack: it
//     waited on the first one, then reported a success it never had.
// Both vanish when `serve` is NOT continuous: Nx never shares a non-continuous task, so every `nx serve` is its own
// stack (the dev engine claims its own port block), and the run's status is the engine's. Now, per house app:
//   - `serve`     — @bespunky/nx-tools:serve, the same options and configurations, `continuous: false` (EXPLICIT: Nx
//     fills an absent key from targetDefaults or the executor schema), `cache: false`;
//   - `dev-stack` — the same, `continuous: true`: the running stack an e2e target depends on (sharing is right there).
//
// THE ONE-WAY HAZARD, and why this rung retargets references rather than only reshaping. A target that depends on
// `serve` for a RUNNING server (an e2e target, most often the project's own) would now wait for the stack to END —
// forever. So every reference to a house app's `serve` is retargeted to `dev-stack`, wherever it is unambiguous:
// `dependsOn` entries in every project.json (string `serve` / `<p>:serve`, or `{ target: 'serve' }` naming the
// project or none), and option values naming the target (`devServerTarget: "web:serve"`, `"web:serve:production"`),
// in every target and configuration. Each rewrite is logged with its project.
// What it REPORTS and leaves: references it cannot resolve to one house app — `^serve` (a dependency's serve),
// `{ target: 'serve', projects: <pattern or a mix> }`, and nx.json `targetDefaults` that depend on `serve` — and a
// project with a `dev-stack` target of its own (the continuous twin needs the name; nothing is changed there).
// NOT reported: a targetDefaults entry (keyed `serve` or by the executor) that sets `continuous` or `cache`. The
// values written here are explicit, and an explicit project.json value wins over targetDefaults (Nx 23
// target-defaults.js: the targetDefaults layer sits BELOW the project.json plugin's results in the merge).
// Commands that RUN `nx serve <app>` (a Playwright webServer, a script) still work and are not touched: `serve`
// still starts the stack.
//
// COMPLETE ON ITS OWN. Every house app is left in the final shape by this rung alone — never relying on the per-app
// `serve` generator running afterwards (an upgrade refreshes only the app it resolves, and none under
// UPGRADE_PARTIAL). An app already in the current shape (recompose-pre-0.3-serve-leftovers runs the live generator
// earlier in this ladder) is only checked and completed.
//
// SELF-CONTAINED by the migration contract: executor id and target names are frozen here.
import { type Tree, getProjects, logger, readNxJson } from '@nx/devkit';
import { updateProjectConfigInPlace } from '../../generators/_utils/project-files';

const TAG = '[migrate 0.50.0 serve-runs-its-own-stack]';
const SERVE_EXECUTOR = '@bespunky/nx-tools:serve';
const STACK = 'dev-stack';
const SERVE = 'serve';

type Target = {
  executor?: string;
  continuous?: boolean;
  cache?: boolean;
  dependsOn?: unknown[];
  options?: Record<string, unknown>;
  configurations?: Record<string, Record<string, unknown>>;
  defaultConfiguration?: string;
  [key: string]: unknown;
};

/** `serve` and `dev-stack` from what `serve` holds now — frozen copy of _utils/dev-server `serveTargetsFor`'s shape. */
function pair(serve: Target): { stack: Target; serve: Target } {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { continuous, cache, ...rest } = serve;
  return {
    stack: { continuous: true, ...rest },
    serve: { continuous: false, executor: rest.executor, cache: false, ...rest },
  };
}

export default function update(tree: Tree): void {
  const house = new Set<string>();

  for (const [name, config] of getProjects(tree)) {
    const targets = (config.targets ?? {}) as Record<string, Target>;
    const serve = targets[SERVE];
    if (!serve || typeof serve !== 'object' || serve.executor !== SERVE_EXECUTOR) continue;
    const own = targets[STACK];
    if (own && (typeof own !== 'object' || own.executor !== SERVE_EXECUTOR)) {
      logger.warn(
        `${TAG} ${name} has a \`${STACK}\` target of its own, so its \`serve\` was NOT changed: \`nx serve ${name}\` still ` +
          `exits 0 when the stack dies, and a second one waits on the first. Rename that target (and what depends on it), ` +
          `then run the house upgrade again.`,
      );
      continue;
    }
    house.add(name);
    const next = pair(serve);
    const current = serve.continuous === false && serve.cache === false && own && own.continuous === true;
    if (current) continue;

    if (serve.continuous !== false) {
      // The shipped shape: `serve` IS the continuous composer. Rebuilt rather than re-keyed so `dev-stack` sits where
      // `serve` was and `serve` right after it — in place, in the file's own form: nothing but the pair changes.
      updateProjectConfigInPlace(tree, config.root, (onDisk) => {
        const rebuilt: Record<string, Target> = {};
        for (const [key, value] of Object.entries((onDisk.targets ?? {}) as Record<string, Target>)) {
          if (key === STACK) continue;
          if (key === SERVE) {
            rebuilt[STACK] = own ? { ...own, continuous: true } : next.stack;
            rebuilt[SERVE] = next.serve;
          } else rebuilt[key] = value;
        }
        onDisk.targets = rebuilt as typeof onDisk.targets;
      });
      logger.info(`${TAG} ${name}: \`serve\` is no longer continuous — each \`nx serve ${name}\` is its own stack and ends with its exit status; \`${STACK}\` is the continuous stack an e2e target depends on.`);
    } else {
      // Already the non-continuous `serve` (the live generator wrote it): complete what is missing, nothing else.
      updateProjectConfigInPlace(tree, config.root, (onDisk) => {
        const t = (onDisk.targets ?? {}) as Record<string, Target>;
        t[SERVE].cache = false;
        if (!t[STACK]) t[STACK] = next.stack;
        else t[STACK].continuous = true;
      });
      logger.info(`${TAG} ${name}: completed \`serve\` / \`${STACK}\`.`);
    }
  }
  if (!house.size) return;

  // ── Every reference to a house app's `serve` ──────────────────────────────────────────────────────────────
  for (const [name, config] of getProjects(tree)) {
    const touchedTargets = new Set<string>();
    for (const [targetName, target] of Object.entries((config.targets ?? {}) as Record<string, Target>)) {
      let touched = false;
      if (!target || typeof target !== 'object') continue;
      if (house.has(name) && (targetName === SERVE || targetName === STACK)) continue; // the pair itself
      const where = `${name}:${targetName}`;
      if (Array.isArray(target.dependsOn)) {
        target.dependsOn = target.dependsOn.map((dep) => {
          const next = retargetDep(dep, name, house, where);
          if (next !== dep) touched = true;
          return next;
        });
      }
      for (const holder of [target.options, ...Object.values(target.configurations ?? {})]) {
        if (holder && typeof holder === 'object' && retargetValues(holder, house, where)) touched = true;
      }
      if (touched) touchedTargets.add(targetName);
    }
    if (touchedTargets.size) {
      updateProjectConfigInPlace(tree, config.root, (onDisk) => {
        onDisk.targets ??= {};
        for (const targetName of touchedTargets) onDisk.targets[targetName] = config.targets![targetName];
      });
    }
  }

  // nx.json targetDefaults apply by target NAME to every project: which project's `serve` they mean is not knowable
  // here, so they are reported.
  const defaults = readNxJson(tree)?.targetDefaults ?? {};
  for (const [key, value] of Object.entries(defaults)) {
    for (const dep of (value as { dependsOn?: unknown[] })?.dependsOn ?? []) {
      if (namesServe(dep)) {
        logger.warn(
          `${TAG} nx.json targetDefaults["${key}"] depends on \`serve\`. If that means an app's running server, depend on ` +
            `\`${STACK}\` instead — \`serve\` now waits for the stack to END. Left as is.`,
        );
      }
    }
  }
}

/** Does a dependsOn entry name a `serve` target at all (any form)? */
function namesServe(dep: unknown): boolean {
  if (typeof dep === 'string') return dep.replace(/^\^/, '').split(':').pop() === SERVE;
  return Boolean(dep && typeof dep === 'object' && (dep as { target?: string }).target === SERVE);
}

/** One dependsOn entry, retargeted when it unambiguously names a house app's `serve`; reported when it might. */
function retargetDep(dep: unknown, from: string, house: Set<string>, where: string): unknown {
  if (!namesServe(dep)) return dep;
  const unresolved = (why: string) => {
    logger.warn(`${TAG} ${where} depends on \`serve\` (${why}) — not retargeted. If it needs the running server, depend on \`${STACK}\`: \`serve\` now waits for the stack to END.`);
    return dep;
  };
  if (typeof dep === 'string') {
    if (dep.startsWith('^')) return unresolved(`"${dep}", the serve of a dependency`);
    const [project] = dep.includes(':') ? dep.split(':') : [from];
    if (!house.has(project)) return dep; // another project's own serve — not the house's
    logger.info(`${TAG} ${where}: dependsOn "${dep}" → "${dep.includes(':') ? `${project}:${STACK}` : STACK}" (it needs the running stack).`);
    return dep.includes(':') ? `${project}:${STACK}` : STACK;
  }
  const d = dep as { target: string; projects?: string | string[]; dependencies?: boolean };
  if (d.dependencies) return unresolved('{ dependencies: true }, the serve of its dependencies');
  const projects = d.projects === undefined || d.projects === 'self' ? [from] : [d.projects].flat();
  const ours = projects.filter((p) => house.has(p));
  if (!ours.length) return dep;
  if (ours.length !== projects.length) return unresolved(`projects ${JSON.stringify(d.projects)} — a pattern, or a mix of house-served and other projects`);
  logger.info(`${TAG} ${where}: dependsOn { target: "serve"${d.projects === undefined ? '' : `, projects: ${JSON.stringify(d.projects)}`} } → "${STACK}".`);
  return { ...d, target: STACK };
}

/** Rewrite option values naming a house app's serve (`web:serve`, `web:serve:production`) — in place. */
function retargetValues(holder: Record<string, unknown>, house: Set<string>, where: string): boolean {
  let changed = false;
  for (const [key, value] of Object.entries(holder)) {
    if (typeof value === 'string') {
      const m = /^([^:\s]+):serve(:[^:\s]+)?$/.exec(value);
      if (m && house.has(m[1])) {
        holder[key] = `${m[1]}:${STACK}${m[2] ?? ''}`;
        logger.info(`${TAG} ${where}: option ${key} "${value}" → "${holder[key]}".`);
        changed = true;
      }
    } else if (value && typeof value === 'object') {
      if (retargetValues(value as Record<string, unknown>, house, `${where}.${key}`)) changed = true;
    }
  }
  return changed;
}
