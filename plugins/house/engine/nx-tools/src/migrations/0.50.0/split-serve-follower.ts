// 0.50.0 — `nx serve <app>` fails when its stack dies: the continuous composer moves to `dev-stack`, and `serve`
// becomes the non-continuous follower that ends with the stack's exit status.
//
// WHAT CHANGED. Nx completes a continuous task that ends while nothing depends on it as SUCCEEDED, whatever its exit
// code. `serve` WAS the continuous composer, so `nx serve <app>` with a dead stack (emulators without Java, a
// dev-server that failed to bind) printed "succeeded" and exited 0 — and background runners trust that. Now:
//   - `dev-stack` — the composer, unchanged (@bespunky/nx-tools:serve, continuous, depends on serve-preflight with
//     its flags forwarded, mirrors the leaf): the running stack Nx shares, what an e2e target depends on;
//   - `serve`     — @bespunky/nx-tools:follow-stack, NOT continuous, depending on `dev-stack` with its flags
//     forwarded: a dying stack is a crashed dependency, and the follower ends with the stack's own status.
//
// THE ONE-WAY HAZARD, and why this rung retargets references rather than only renaming. A target that depends on
// `serve` for a RUNNING server (an e2e target, most often the project's own) would now wait for the stack to END —
// forever. So every reference to a split project's `serve` is retargeted to `dev-stack`, wherever it is
// unambiguous: `dependsOn` entries in every project.json (string `serve` / `<p>:serve`, or `{ target: 'serve' }`
// naming the project or none), and option values naming the target (`devServerTarget: "web:serve"`,
// `"web:serve:production"`), in every target and configuration. Each rewrite is logged with its project.
// What it REPORTS and leaves: references it cannot resolve to one split project — `^serve` (a dependency's serve),
// `{ target: 'serve', projects: <pattern or a mix> }`, and nx.json `targetDefaults` that depend on `serve` — and a
// project with a `dev-stack` target of its own (the composer needs the name; nothing is split there).
// Commands that RUN `nx serve <app>` (a Playwright webServer, a script) still work and are not touched: `serve`
// still starts the stack.
//
// SELF-CONTAINED by the migration contract: executor ids, target names and the follower's shape are frozen here.
import { type Tree, getProjects, logger, readNxJson, updateProjectConfiguration } from '@nx/devkit';

const TAG = '[migrate 0.50.0 split-serve-follower]';
const SERVE_EXECUTOR = '@bespunky/nx-tools:serve';
const FOLLOW_EXECUTOR = '@bespunky/nx-tools:follow-stack';
const STACK = 'dev-stack';
const SERVE = 'serve';

type Target = {
  executor?: string;
  continuous?: boolean;
  dependsOn?: unknown[];
  options?: Record<string, unknown>;
  configurations?: Record<string, Record<string, unknown>>;
  defaultConfiguration?: string;
  [key: string]: unknown;
};

/** The follower for a composer — frozen copy of _utils/dev-server `followerFor`. */
function follower(composer: Target): Target {
  return {
    executor: FOLLOW_EXECUTOR,
    dependsOn: [{ target: STACK, params: 'forward' }],
    cache: false,
    ...(composer.configurations ? { configurations: Object.fromEntries(Object.keys(composer.configurations).map((n) => [n, {}])) } : {}),
    ...(composer.defaultConfiguration ? { defaultConfiguration: composer.defaultConfiguration } : {}),
  };
}

export default function update(tree: Tree): void {
  const split = new Set<string>();

  for (const [name, config] of getProjects(tree)) {
    const targets = (config.targets ?? {}) as Record<string, Target>;
    const serve = targets[SERVE];
    if (!serve || typeof serve !== 'object' || serve.executor !== SERVE_EXECUTOR) continue;
    const own = targets[STACK];
    if (own && (typeof own !== 'object' || own.executor !== SERVE_EXECUTOR)) {
      logger.warn(
        `${TAG} ${name} has a \`${STACK}\` target of its own, so its \`serve\` was NOT split: \`nx serve ${name}\` still exits 0 ` +
          `when the stack dies. Rename that target (and what depends on it), then run the house upgrade again.`,
      );
      continue;
    }
    // Rebuilt rather than re-keyed so `dev-stack` sits where `serve` was and `serve` follows it.
    const rebuilt: Record<string, Target> = {};
    for (const [key, value] of Object.entries(targets)) {
      if (key === STACK) continue;
      if (key === SERVE) {
        const composer: Target = { ...serve, continuous: true };
        rebuilt[STACK] = composer;
        rebuilt[SERVE] = follower(composer);
      } else rebuilt[key] = value;
    }
    config.targets = rebuilt as typeof config.targets;
    updateProjectConfiguration(tree, name, config);
    split.add(name);
    logger.info(`${TAG} ${name}: the composer is now \`${STACK}\` (continuous); \`serve\` follows it and ends with its exit status.`);
  }
  if (!split.size) return;

  // ── Every reference to a split project's `serve` ──────────────────────────────────────────────────────────
  for (const [name, config] of getProjects(tree)) {
    let touched = false;
    for (const [targetName, target] of Object.entries((config.targets ?? {}) as Record<string, Target>)) {
      if (!target || typeof target !== 'object') continue;
      if (split.has(name) && (targetName === SERVE || targetName === STACK)) continue; // the pair just written
      const where = `${name}:${targetName}`;
      if (Array.isArray(target.dependsOn)) {
        target.dependsOn = target.dependsOn.map((dep) => {
          const next = retargetDep(dep, name, split, where);
          if (next !== dep) touched = true;
          return next;
        });
      }
      for (const holder of [target.options, ...Object.values(target.configurations ?? {})]) {
        if (holder && typeof holder === 'object' && retargetValues(holder, split, where)) touched = true;
      }
    }
    if (touched) updateProjectConfiguration(tree, name, config);
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

/** One dependsOn entry, retargeted when it unambiguously names a split project's `serve`; reported when it might. */
function retargetDep(dep: unknown, from: string, split: Set<string>, where: string): unknown {
  if (!namesServe(dep)) return dep;
  const unresolved = (why: string) => {
    logger.warn(`${TAG} ${where} depends on \`serve\` (${why}) — not retargeted. If it needs the running server, depend on \`${STACK}\`: \`serve\` now waits for the stack to END.`);
    return dep;
  };
  if (typeof dep === 'string') {
    if (dep.startsWith('^')) return unresolved(`"${dep}", the serve of a dependency`);
    const [project] = dep.includes(':') ? dep.split(':') : [from];
    if (!split.has(project)) return dep; // another project's own serve — not the house composer
    logger.info(`${TAG} ${where}: dependsOn "${dep}" → "${dep.includes(':') ? `${project}:${STACK}` : STACK}" (it needs the running stack).`);
    return dep.includes(':') ? `${project}:${STACK}` : STACK;
  }
  const d = dep as { target: string; projects?: string | string[]; dependencies?: boolean };
  if (d.dependencies) return unresolved('{ dependencies: true }, the serve of its dependencies');
  const projects = d.projects === undefined || d.projects === 'self' ? [from] : [d.projects].flat();
  const ours = projects.filter((p) => split.has(p));
  if (!ours.length) return dep;
  if (ours.length !== projects.length) return unresolved(`projects ${JSON.stringify(d.projects)} — a pattern, or a mix of house-served and other projects`);
  logger.info(`${TAG} ${where}: dependsOn { target: "serve"${d.projects === undefined ? '' : `, projects: ${JSON.stringify(d.projects)}`} } → "${STACK}".`);
  return { ...d, target: STACK };
}

/** Rewrite option values naming a split project's serve (`web:serve`, `web:serve:production`) — in place. */
function retargetValues(holder: Record<string, unknown>, split: Set<string>, where: string): boolean {
  let changed = false;
  for (const [key, value] of Object.entries(holder)) {
    if (typeof value === 'string') {
      const m = /^([^:\s]+):serve(:[^:\s]+)?$/.exec(value);
      if (m && split.has(m[1])) {
        holder[key] = `${m[1]}:${STACK}${m[2] ?? ''}`;
        logger.info(`${TAG} ${where}: option ${key} "${value}" → "${holder[key]}".`);
        changed = true;
      }
    } else if (value && typeof value === 'object') {
      if (retargetValues(value as Record<string, unknown>, split, `${where}.${key}`)) changed = true;
    }
  }
  return changed;
}
