// 0.24.0 — collapse every historical serve target into the current `serve` + `dev-server` pair.
//
// The house dev loop used to be a fan of targets, each a stage of the same idea: a `serve` orchestrator
// (nx:run-commands) composing an inner Angular dev-server that lived under whichever name that generation
// happened to use (`serve-app` → `serve-standalone` → `serve-no-emulators` → `serve-with-emulators`), plus
// two extra axes parked as their own targets (`serve-worktree`, `serve-with-shared-browser`). 0.3.0 replaced
// all of it with ONE composing executor (@bespunky/nx-tools:serve) driving ONE leaf named `dev-server`, with
// the worktree and shared-browser axes as flags on it.
//
// The `serve` generator already heals this shape — but only on a project it actually runs against. It is a
// PER-APP generator invoked with `--project`, so it only ever reaches the apps a sync knows to pass it: a
// second app added by hand, a library that once carried a dev-server, or a project in a workspace whose sync
// no longer ensures the `web` layer keeps the stale targets forever. Hence a migration, which sweeps EVERY
// project once, on the way up to 0.24.0.
//
// SELF-CONTAINED ON PURPOSE. The target names and the reshaping rules below are copied, not imported, from
// ../generators/serve/generator.ts. A migration must execute the behaviour it was written against: someone
// jumping 0.23 → 0.31 resolves implementations out of the NEWEST package, so an import would silently hand
// this migration a future generator's idea of what the house shape is.
import {
  type Tree,
  type TargetConfiguration,
  type ProjectConfiguration,
  getProjects,
  updateProjectConfiguration,
  readJson,
  writeJson,
  logger,
} from '@nx/devkit';

/** The one canonical name for the app's real dev-server — the leaf the `serve` composer drives by name. */
const DEV_SERVER = 'dev-server';

/**
 * Every name the app dev-server has historically hidden under, NEWEST FIRST.
 *
 * The order is the priority order for the rename below, and it is the same order the `serve` generator's
 * `findExistingDevServer` uses — deliberately, so this migration promotes the SAME target the generator
 * would have carried forward. On the Firebase trio (`serve-with-emulators` + `serve-no-emulators`) that
 * means the emulator-env dev-server wins; its emulator-free sibling is not lost capability but a flag on the
 * unified serve (`nx serve <app> --no-emulators`).
 *
 * `serve` is deliberately NOT in this list. It is the only name that ever held the run-commands orchestrator,
 * and promoting an orchestrator to the `dev-server` leaf would give the composer a composer to drive.
 */
const LEGACY_DEV_SERVER_NAMES = ['serve-with-emulators', 'serve-no-emulators', 'serve-standalone', 'serve-app'];

/**
 * Per-app targets the unified serve subsumed, deleted outright — neither carries state worth preserving:
 *   - `serve-worktree` — its executor (@bespunky/nx-tools:serve-worktree) was RENAMED to `serve` in 0.3.0, so
 *     the target now points at an executor that does not exist. Left in place it is not merely redundant, it
 *     is a target that throws the moment anyone runs it.
 *   - `serve-with-shared-browser` — its serve-then-navigate behaviour became a default layer of the serve
 *     executor, so the target duplicates what `nx serve <app>` already does.
 */
const RETIRED_SERVE_TARGETS = ['serve-worktree', 'serve-with-shared-browser'];

/** The legacy orchestrator's executor — the `serve` shape that must not carry `host`. See below. */
const RUN_COMMANDS_EXECUTOR = 'nx:run-commands';

/** The current `serve`: ONE composing executor driving the `dev-server` leaf + emulators + shared browser. */
const SERVE_EXECUTOR = '@bespunky/nx-tools:serve';

/**
 * Every target name the 0.24.x collapse takes away from an app — the set whose appearance in the legacy
 * orchestrator's commands makes those commands DANGLING.
 *
 * `emulators` is in here even though this migration never touches it: the very next migration (0.24.1) moves
 * the emulator suite off the app onto the workspace-level `firebase` project, so an orchestrator that runs
 * `nx run <app>:emulators` is broken by the end of the same ladder. Ordering makes that a fact, not a guess —
 * and a migration that repaired half the references would be no better than one that repaired none.
 */
const COLLAPSED_TARGET_NAMES = [...LEGACY_DEV_SERVER_NAMES, ...RETIRED_SERVE_TARGETS, 'emulators'];

/** Directories the fallback scan never descends into. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.nx', '.angular', 'dist', 'tmp', 'coverage']);

/** Depth bound for the fallback scan: `apps/<app>/project.json` is 3, and no house layout goes near this. */
const MAX_DEPTH = 12;

export default function unifyServeTargets(tree: Tree): void {
  // ONE UNREADABLE FILE MUST NOT TAKE THE LADDER DOWN. `getProjects` parses every project file in the
  // workspace and throws outright on the first one it cannot read — and Nx runs the whole migration set in a
  // single ordered pass, so that throw does not merely skip this migration: it stops every LATER one too,
  // including ones (like `stamp-devcontainer-ownership`) that never touch a project file and would have
  // succeeded. So the graph is asked for, not depended on: when it refuses, we fall back to reading the
  // project.json files directly and skip — individually, and out loud — only the files that will not parse.
  const graph = tryGetProjects(tree);

  if (graph) {
    for (const [projectName, project] of graph) {
      const targets = project.targets;
      // A project with no targets at all has nothing of this shape to move. Skipping keeps it byte-identical —
      // `updateProjectConfiguration` rewrites the whole project.json (adding `$schema`, reordering keys), so
      // "no change" has to mean "no write", not "write the same values back".
      if (!targets) continue;
      if (reshapeServeTargets(targets, projectName)) updateProjectConfiguration(tree, projectName, project);
    }
    return;
  }

  // DEGRADED PATH — raw project FILES. Nx lets a project be declared by a `project.json` OR by a
  // `package.json`'s `nx` block, and the targets sit at a different place in each; the sibling migrations
  // (0.24.1, 0.24.2) both handle the second shape, so this one must too. An earlier revision walked for
  // `project.json` only, which meant that on a degraded run — one malformed file anywhere — a
  // package.json-defined project kept `serve-with-emulators` and a dangling `serve-worktree` while 0.24.1
  // happily relocated its `emulators`: a project half-collapsed by the same ladder. The reshaping itself is
  // the SAME function on both paths, so what a project gets can never depend on how it was found.
  for (const { path, kind } of projectFilePaths(tree)) {
    let json: ProjectFileJson;
    try {
      json = readJson(tree, path);
    } catch (error) {
      logger.warn(
        `[migrate 0.24.0] Skipped ${path}: it does not parse (${errorText(error)}). Its serve targets were ` +
          `left as they are — fix the file and re-run \`nx migrate\` to sweep it.`,
      );
      continue;
    }
    const targets = kind === 'package.json' ? json.nx?.targets : json.targets;
    if (!targets) continue;
    if (reshapeServeTargets(targets, json.nx?.name ?? json.name ?? path)) writeJson(tree, path, json);
  }
}

/** Minimal shape of a project file — deliberately open, so everything we don't understand round-trips. */
interface ProjectFileJson {
  name?: string;
  targets?: Record<string, TargetConfiguration>;
  nx?: { name?: string; targets?: Record<string, TargetConfiguration> };
  [key: string]: unknown;
}

/**
 * Collapse one project's serve targets onto the current shape, in place. Returns whether anything changed.
 *
 * The whole transformation lives here, in ONE function called by both discovery paths, so "what the migration
 * does" can never depend on which path found the project.
 */
function reshapeServeTargets(targets: Record<string, TargetConfiguration>, projectName: string): boolean {
  let changed = false;

  // (1) PROMOTE, don't delete. If the project has no `dev-server` but does have a legacy one, the legacy
  //     target IS the app's dev-server — carrying whatever the user tuned on it (host, proxyConfig, ssl,
  //     headers, a pinned buildTarget). Renaming moves the whole target object across, options and
  //     configurations intact; deleting it and letting the generator write a fresh leaf would silently
  //     throw those values away. A project that already has `dev-server` is on the current shape, so its
  //     leaf is left completely untouched and only the stale siblings below are swept.
  if (!targets[DEV_SERVER]) {
    const legacyName = LEGACY_DEV_SERVER_NAMES.find((name) => targets[name]);
    if (legacyName) {
      targets[DEV_SERVER] = targets[legacyName] as TargetConfiguration;
      delete targets[legacyName];
      changed = true;
      logger.info(`[migrate] ${projectName}: renamed \`${legacyName}\` → \`${DEV_SERVER}\` (options preserved).`);
    }
  }

  // Now the duplicates. Whatever legacy names remain are either siblings of the target just promoted, or
  // siblings of a `dev-server` that already existed — both cases are stale copies of the same dev-server.
  for (const name of LEGACY_DEV_SERVER_NAMES) {
    if (targets[name]) {
      delete targets[name];
      changed = true;
    }
  }

  // (2) The retired axes.
  for (const name of RETIRED_SERVE_TARGETS) {
    if (targets[name]) {
      delete targets[name];
      changed = true;
    }
  }

  // (3) The legacy `serve` orchestrator, which is the ONE target that can be left pointing at what steps
  //     (1) and (2) just took away.
  //
  //     A `serve` on the current @bespunky/nx-tools:serve executor is explicitly NOT touched here: the
  //     composer DELEGATES `host` to the dev-server it drives, so there `host` is correct and required.
  const serve = targets.serve;
  if (serve?.executor === RUN_COMMANDS_EXECUTOR) {
    // (3a) DANGLING REFERENCES. The orchestrator's whole body is `nx run <app>:<one of the names this
    //      migration removes>` — so once those targets are gone, so is everything the orchestrator said.
    //      Leaving it is not "preserving the user's config", it is leaving a `nx serve <app>` that throws
    //      ("Cannot find target"), permanently: the `serve` generator only re-runs against the ONE app a
    //      `web`-layer sync infers, so a second app, a lib with a dev-server, or a non-`web` sync never
    //      gets it back.
    //
    //      REPLACED WITH THE COMPOSER rather than textually rewritten, because the composer IS what those
    //      commands composed — dev-server + emulator suite + shared browser under one Ctrl+C — and it
    //      reaches the relocated `firebase:emulators` by itself, which no rewrite of `nx run <app>:emulators`
    //      could do without inventing a project that may not exist yet. Capability the generator adds later
    //      (the development/production configurations, host/proxyConfig delegation) is deliberately NOT
    //      invented here: this restores a working `nx serve`, it does not pretend to be the generator.
    const dangling = referencesCollapsedTarget(serve);
    if (dangling) {
      if (targets[DEV_SERVER]) {
        targets.serve = { continuous: true, executor: SERVE_EXECUTOR };
        changed = true;
        logger.info(
          `[migrate 0.24.0] ${projectName}: replaced the legacy \`serve\` orchestrator with the ` +
            `\`${SERVE_EXECUTOR}\` composer — its commands ran \`${dangling}\`, which this upgrade removes.`,
        );
      } else {
        // Nothing to compose. Replacing `serve` with a composer that drives a `dev-server` this project does
        // not have would trade one broken target for another, so the state is reported instead of guessed at.
        logger.warn(
          `[migrate 0.24.0] ${projectName}: its \`serve\` orchestrator runs \`${dangling}\`, which this ` +
            `upgrade removes, but the project has no \`${DEV_SERVER}\` target to compose in its place. ` +
            `\`nx serve ${projectName}\` will fail until you add a \`${DEV_SERVER}\` target and run ` +
            `\`nx g @bespunky/nx-tools:serve --project=${projectName}\`.`,
        );
      }
    }

    // (3b) The orchestrator's `host` — only reachable when (3a) left the orchestrator in place. A
    //      `nx:run-commands` serve forwards its options to the child command as bare flags, so a `host`
    //      option there becomes a stray `--host=…` appended to whatever it runs. Only that ONE key is
    //      removed: the rest of a genuinely user-authored orchestrator is the user's.
    const kept = targets.serve;
    if (kept?.executor === RUN_COMMANDS_EXECUTOR && kept.options && 'host' in kept.options) {
      delete (kept.options as Record<string, unknown>).host;
      changed = true;
    }
  }

  // IDEMPOTENT BY CONSTRUCTION: every branch above is check-then-act, and each one removes the very
  // condition that selected it. A second run finds a `dev-server`, no legacy names, no retired targets and
  // no `host` on the orchestrator — `changed` stays false and the file is never rewritten. That matters:
  // the HOUSE.md stamp only moves at the END of a sync, so a sync that dies half-way re-runs this exact
  // migration on the state it already produced.
  return changed;
}

/**
 * The first collapsed target name a run-commands orchestrator actually runs, or `undefined` when it runs
 * none of them.
 *
 * This is the test that separates "the house orchestrator this migration is replacing" from "a project's own
 * target that merely happens to be called `serve`". The latter is left alone — a migration that replaced
 * every run-commands `serve` in the workspace would be destroying configuration it never wrote.
 */
function referencesCollapsedTarget(serve: TargetConfiguration): string | undefined {
  const texts: string[] = [];
  const collect = (options: Record<string, unknown> | undefined): void => {
    if (!options) return;
    if (typeof options.command === 'string') texts.push(options.command);
    if (Array.isArray(options.commands)) {
      for (const entry of options.commands) {
        if (typeof entry === 'string') texts.push(entry);
        else if (entry && typeof entry === 'object' && typeof (entry as { command?: unknown }).command === 'string') {
          texts.push((entry as { command: string }).command);
        }
      }
    }
  };
  collect(serve.options as Record<string, unknown> | undefined);
  for (const configuration of Object.values(serve.configurations ?? {})) {
    collect(configuration as Record<string, unknown> | undefined);
  }

  const joined = texts.join('\n');
  // Only a TARGET reference counts — `<project>:<name>`, or an `nx run-many`-style `--target=<name>` / `-t
  // <name>`. A bare word would be far too eager: `bash tools/emulators.sh` is a project running a script, not
  // a project running the `emulators` target, and replacing that `serve` would be destroying a command this
  // migration never wrote. The trailing `(?![\w-])` is what keeps `web:serve-with-emulators` from also
  // reading as a reference to `serve-with` — and the leading `:` is what keeps it from reading as one to
  // `emulators`.
  return COLLAPSED_TARGET_NAMES.find((name) =>
    new RegExp(`(?::|--targets?=|-t[ =])${name}(?![\\w-])`).test(joined),
  );
}

/**
 * The workspace's projects, or `null` when Nx cannot read them.
 *
 * The catch is not defensive noise: `getProjects` throws on the FIRST unparseable project file, so on a
 * workspace with one bad file it is the difference between "one project is skipped" and "no migration after
 * this one runs at all". Nothing else here can throw, which is why this is the only place that catches.
 */
function tryGetProjects(tree: Tree): Map<string, ProjectConfiguration> | null {
  try {
    return getProjects(tree);
  } catch (error) {
    logger.warn(
      `[migrate 0.24.0] Nx could not read this workspace's projects (${errorText(error)}) — normally one ` +
        `project file that does not parse. Falling back to a direct scan of the project files (project.json, ` +
        `and package.json with an \`nx\` block): every readable one is still swept, and unreadable ones are ` +
        `reported and skipped. Fix the reported file and re-run \`nx migrate\` for a complete sweep.`,
    );
    return null;
  }
}

/**
 * Every project FILE in the workspace, found by walking the tree — the fallback for a broken graph.
 *
 * `project.json` wins wherever both exist, the same precedence Nx applies. A `package.json` counts only when
 * it declares an `nx` block: treating every package.json in an npm-workspaces repo as a project would invent
 * projects Nx never had. A package.json that does not parse is simply not a candidate — the project.json
 * path reports its own unparseable files, and warning about every unreadable package.json in the tree would
 * bury that.
 */
function projectFilePaths(tree: Tree): Array<{ path: string; kind: 'project.json' | 'package.json' }> {
  const found: Array<{ path: string; kind: 'project.json' | 'package.json' }> = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let children: string[];
    try {
      children = tree.children(dir);
    } catch {
      return;
    }
    const files = new Set<string>();
    const directories: string[] = [];
    for (const child of children) {
      if (SKIP_DIRS.has(child)) continue;
      const path = dir === '.' ? child : `${dir}/${child}`;
      if (tree.isFile(path)) files.add(child);
      else directories.push(path);
    }

    const here = (name: string): string => (dir === '.' ? name : `${dir}/${name}`);
    if (files.has('project.json')) found.push({ path: here('project.json'), kind: 'project.json' });
    else if (files.has('package.json') && declaresNxProject(tree, here('package.json'))) {
      found.push({ path: here('package.json'), kind: 'package.json' });
    }

    for (const path of directories) walk(path, depth + 1);
  };
  walk('.', 0);
  return found;
}

/** Does this package.json declare an Nx project (an `nx` block)? Unreadable ones are simply not candidates. */
function declaresNxProject(tree: Tree, path: string): boolean {
  try {
    return Boolean(readJson<ProjectFileJson>(tree, path).nx);
  } catch {
    return false;
  }
}

/** The message of whatever was thrown — a migration log must never print `[object Object]`. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
