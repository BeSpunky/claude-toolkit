// Migration 0.24.1 — give the Firebase emulator suite ONE home, and retire the build variants that
// "no emulators" used to be expressed as.
//
// Three one-way changes landed on the Firebase shape and are folded together here because they are the same
// change seen from three sides:
//   1. The `emulators` / `emulators:<svc>` targets used to live on the APP's project.json. The emulator suite
//      is a WORKSPACE concept (one suite, one project id, singleProjectMode) — it is not an app concern — so
//      it became its own workspace-level Nx project, `firebase`. A project that still has them on the app has
//      two homes for one thing the moment the current generator runs, and `nx run <app>:emulators` and
//      `nx run firebase:emulators` start drifting apart.
//   2. "No emulators" stopped being a BUILD variant (`build:no-emulators`, and its interim name `standalone`)
//      and became a RUNTIME choice (`?emulate=none` / the serve executor's `--no-emulators`). The retired
//      configurations are dead weight that still point at…
//   3. …`environment.no-emulators.ts` / `environment.standalone.ts`, env files nothing compiles anymore.
//
// WHY 0.24.1 AND NOT 0.24.0. The serve migration ships at 0.24.0 and reshapes the app's `serve` / `dev-server`
// targets. Both touch the same project.json, and the runner orders by version, so a distinct — later —
// version is what guarantees this one sees the app AFTER the serve migration is done with it rather than
// interleaved with it. Ordering by declaration order in migrations.json would be a comment in a JSON file
// pretending to be a guarantee; the version is the guarantee.
//
// SELF-CONTAINED by rule: nothing here imports a generator or a shared util. Someone jumping 0.23 → 0.31 must
// get the behaviour this migration was written against, not whatever `firebase-emulators`/`registry` became.
// That is why the canonical `firebase` project shape below is a literal rather than a call into the generator.
//
// WHAT THIS IS NOT. It never brings the Firebase layer into being (rule 5). Every branch is conditioned on
// state that already exists — a root firebase.json, emulator targets actually present on an app, a retired
// configuration actually present on a build target. A project that never had the old shape comes out
// byte-identical, and a project that never had Firebase at all is left before the first line of work.
//
// AND IT NEVER TAKES THE LADDER DOWN. Nx runs the whole migration set in ONE ordered pass, so anything this
// file throws also stops every LATER migration — including ones that touch nothing it touches. Two things
// could throw and both are handled rather than trusted: a project file that does not parse (skipped
// individually, out loud) and `getProjects` itself refusing to build the graph (fall back to a direct scan).
// A workspace is a place where somebody is mid-edit; a migration that assumes otherwise is a migration that
// punishes them for it.
import { type Tree, getProjects, joinPathFragments, logger, readJson, writeJson } from '@nx/devkit';

/**
 * The targets earlier generations put on the app. Canonical order — it is also the order they are written
 * into the `firebase` project, so a relocated project.json reads like a freshly generated one.
 */
const EMULATOR_TARGETS = [
  'emulators',
  'emulators:auth',
  'emulators:firestore',
  'emulators:storage',
  'emulators:functions',
] as const;

/**
 * Retired build configuration → the environment file that configuration existed to swap in, and whether the
 * name alone is enough to condemn it.
 *
 * `no-emulators` is an unambiguous house name: nothing else in this workspace has any reason to call a build
 * configuration that, and the concept it names does not exist anymore, so the NAME is the evidence. Requiring
 * a matching fileReplacement on top of it would let a config survive merely because someone had edited or
 * relocated its env file — leaving behind exactly the dead build variant this migration exists to retire.
 *
 * `standalone` is the opposite case: it was only ever an INTERIM house name, and it is a word a project may
 * legitimately use for its own build variant. There the fileReplacement is what tells our config apart from
 * theirs, and deleting a user's configuration because it shares a name would be exactly the destruction
 * rule 4 forbids. So that one, and only that one, must still carry our fileReplacement to be removed.
 */
const RETIRED_BUILD_CONFIGURATIONS: Record<string, { envFile: string; nameIsProof: boolean }> = {
  'no-emulators': { envFile: 'environment.no-emulators.ts', nameIsProof: true },
  'standalone': { envFile: 'environment.standalone.ts', nameIsProof: false },
};

/** The workspace-level home the emulator targets move to, when one has to be created. */
const FIREBASE_PROJECT_PATH = 'firebase/project.json';

/** The name that home carries. A SECOND project under this name would break every `nx` command — see below. */
const FIREBASE_PROJECT_NAME = 'firebase';

/** Directories the fallback scan never descends into. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.nx', '.angular', '.firebase', 'dist', 'tmp', 'coverage']);

/** Depth bound for the fallback scan: `apps/<app>/project.json` is 3, and no house layout goes near this. */
const MAX_DEPTH = 12;

/** Minimal shape of a project.json — deliberately open, so everything we don't understand round-trips. */
interface ProjectJson {
  name?: string;
  targets?: Record<string, unknown>;
  nx?: { name?: string; targets?: Record<string, unknown> };
  [key: string]: unknown;
}

interface FileReplacement {
  replace?: string;
  with?: string;
}

interface BuildConfiguration {
  fileReplacements?: FileReplacement[];
  [key: string]: unknown;
}

interface BuildTarget {
  options?: BuildConfiguration;
  configurations?: Record<string, BuildConfiguration>;
  [key: string]: unknown;
}

/**
 * One project, as a FILE we can read and write.
 *
 * `kind` is the whole point of this record. Nx lets a project be declared by a `project.json` OR by a
 * `package.json`'s `nx` block, and the targets sit at a different place in each. An earlier revision filtered
 * the package.json shape out entirely, which silently left those projects with their app-level `emulators*`
 * targets, a retired `no-emulators` configuration and a stale env file — a project that looked migrated and
 * was not. Carrying the kind is what lets one set of rules apply to both.
 */
interface ProjectFile {
  name: string;
  root: string;
  path: string;
  kind: 'project.json' | 'package.json';
  /**
   * Did we learn this project's REAL Nx name, or is `name` just a stand-in derived from its path?
   *
   * It matters for exactly one thing: target references. Nx addresses a target as `<project>:<target>`, by
   * NAME — so a repair keyed on a path (`apps/web/project.json:build:no-emulators`) matches nothing, while
   * the retire step that motivated the repair has already deleted the configuration. That combination is
   * strictly worse than doing nothing, and it only arises on the degraded scan, where `getProjects` threw
   * and a `project.json` happens to carry no `name` key.
   */
  nameResolved: boolean;
}

export default function relocateEmulatorTargets(tree: Tree): void {
  // No root firebase.json, no Firebase in this workspace, nothing to relocate or retire. This is the guard
  // that makes the migration a no-op for the majority of projects rather than something they have to trust.
  if (!tree.exists('firebase.json')) return;

  // Per-run state: the same file is re-read by each of the three steps below, and one warning per file is
  // the useful amount. Reset here rather than at module scope so a second run in the same process (a test, a
  // sync that re-invokes the runner) reports independently.
  reported.clear();

  const projects = projectFiles(tree);

  relocateTargetsToFirebaseProject(tree, projects);
  const retired = dropRetiredBuildConfigurations(tree, projects);
  // Repair BEFORE deleting the files: the reference sweep in step 3 must see the post-repair set of
  // fileReplacements, and a target still pointing at a build configuration that no longer exists is exactly
  // the kind of dangling reference this migration must not leave behind.
  repairRetiredBuildTargetReferences(tree, projects, retired.buildTargets);
  deleteRetiredEnvironmentFiles(tree, projects, retired.envFiles);
}

/**
 * Every project in the workspace, as a readable, writable file.
 *
 * `getProjects` is used for DISCOVERY only, never as the thing we edit. The configurations it returns are the
 * project graph's MERGED view — inferred targets from Nx plugins included — so writing one back with
 * `updateProjectConfiguration` would bake inference into the file and permanently freeze targets the plugin
 * is supposed to keep deriving. Every read and write below therefore goes through the raw JSON file, which is
 * also the only place the old app-level emulator targets can actually be.
 *
 * Two failure modes are absorbed here rather than propagated. A project whose file does not PARSE is dropped
 * with a warning naming it — this migration cannot edit what it cannot read, and refusing to run at all
 * would punish every other project (and every later migration) for one bad file. And `getProjects` REFUSING
 * outright — which it does on the first unparseable file, and on a duplicate project name — falls back to
 * walking the tree for project files directly, which is strictly more robust and only slightly less complete.
 */
function projectFiles(tree: Tree): ProjectFile[] {
  const candidates: Array<{ name?: string; root: string }> = [];

  try {
    for (const [name, project] of getProjects(tree)) candidates.push({ name, root: project.root });
  } catch (error) {
    logger.warn(
      `[migrate 0.24.1] Nx could not read this workspace's projects (${errorText(error)}) — normally one ` +
        `project file that does not parse, or two projects sharing a name. Falling back to a direct scan of ` +
        `the project files: every readable one is still handled, and unreadable ones are named below.`,
    );
    candidates.length = 0;
    for (const root of scanProjectRoots(tree)) candidates.push({ root });
  }

  const files: ProjectFile[] = [];
  for (const { name, root } of candidates) {
    // project.json wins when both exist — the same precedence Nx applies.
    const kind = tree.exists(joinPathFragments(root, 'project.json'))
      ? 'project.json'
      : tree.exists(joinPathFragments(root, 'package.json'))
      ? 'package.json'
      : null;
    if (!kind) continue;

    const path = joinPathFragments(root, kind);
    const json = tryReadJson(tree, path);
    if (!json) continue; // Already reported.

    const resolved = name ?? json.nx?.name ?? json.name ?? null;
    files.push({ name: resolved ?? path, root, path, kind, nameResolved: resolved !== null });
  }
  return files;
}

/** Every directory holding a `project.json`, or a `package.json` with an `nx` block — the fallback scan. */
function scanProjectRoots(tree: Tree): string[] {
  const roots = new Set<string>();
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let children: string[];
    try {
      children = tree.children(dir);
    } catch {
      return;
    }
    for (const child of children) {
      if (SKIP_DIRS.has(child)) continue;
      const path = dir === '.' ? child : `${dir}/${child}`;
      if (!tree.isFile(path)) {
        walk(path, depth + 1);
        continue;
      }
      if (child === 'project.json') roots.add(dir);
      // A package.json is only a PROJECT when it declares one. Treating every package.json in an npm-workspaces
      // repo as a project would invent projects Nx never had.
      if (child === 'package.json' && tryReadJson(tree, path)?.nx) roots.add(dir);
    }
  };
  walk('.', 0);
  return [...roots];
}

/**
 * The targets object of a project file — `targets` in a project.json, `nx.targets` in a package.json.
 *
 * Returned BY REFERENCE, so callers mutate it and write the whole document back. No container is ever
 * created: a project that declares no targets has nothing here to relocate, and adding an empty `nx` block to
 * somebody's package.json would be this migration inventing structure.
 */
function targetsOf(file: ProjectFile, json: ProjectJson): Record<string, unknown> | undefined {
  return file.kind === 'package.json' ? json.nx?.targets : json.targets;
}

/**
 * Step 1 — move `emulators` / `emulators:<svc>` off every app that still carries them, onto `firebase`.
 *
 * The targets are carried AS THEY ARE, and that is a deliberate limit on this migration's job rather than a
 * promise about the end state: moving state is what this file does, rewriting it is not. Note that a
 * `--sync --firebase` run in the same session WILL then re-assert the five canonical definitions over the
 * carried ones (the firebase-emulators generator merges canonical-last), so a tuned command survives the MOVE
 * but not the sync. If a project has genuinely tuned emulator commands, the place to keep them is a
 * differently-named target beside these — user-added targets are preserved by both this file and the
 * generator.
 */
function relocateTargetsToFirebaseProject(tree: Tree, projects: ProjectFile[]): void {
  // WHERE THE TARGETS ARE GOING IS DECIDED BEFORE ANY ARE TAKEN AWAY. The destination can fail to exist
  // (fine, we create it) but it can also be UNCREATABLE — a workspace that already has a project named
  // `firebase` somewhere else turns a new `firebase/project.json` into two projects with one name, which
  // makes EVERY subsequent `nx` command fail ("defined in multiple locations"), including the rest of the
  // sync. Resolving first means we never delete a target we have nowhere to put.
  const home = resolveFirebaseHome(tree, projects);
  if (home === 'blocked') return; // resolveFirebaseHome has said why. Nothing is taken off any app.

  const carried: Record<string, unknown> = {};
  /** Duplicate definitions the "first project wins" rule discards — named, never silently dropped. */
  const dropped: Array<{ target: string; from: string }> = [];

  for (const file of projects) {
    // The destination is not a source. Without this a workspace that already has a `firebase` project would
    // read its targets, delete them, and hand them back to itself.
    if (home !== 'create' && file.path === home.path) continue;

    const json = tryReadJson(tree, file.path);
    if (!json) continue;
    const targets = targetsOf(file, json);
    if (!targets) continue;

    const present = EMULATOR_TARGETS.filter((name) => name in targets);
    if (present.length === 0) continue;

    for (const name of present) {
      // First project wins. Two apps carrying the same target name is not a shape the house ever generated,
      // so there is no principled way to merge them — keeping the first and dropping the rest at least leaves
      // one working definition instead of an arbitrary last-write-wins.
      //
      // The CHOICE is deliberate; the silence was not. A log saying only "Moved emulators off `admin`" reads
      // as a relocation when it was a deletion, and the definition is gone from the tree by the time anyone
      // could notice. So the discarded ones are named, with the project they came off.
      if (name in carried) dropped.push({ target: name, from: file.name });
      else carried[name] = targets[name];
      delete targets[name];
    }

    writeJson(tree, file.path, json);
    logger.info(
      `[migrate 0.24.1] Moved ${present.join(', ')} off \`${file.name}\` — the emulator suite is a ` +
        `workspace concept and now lives on the \`${FIREBASE_PROJECT_NAME}\` project.`,
    );
  }

  for (const { target, from } of dropped) {
    logger.warn(
      `[migrate 0.24.1] Discarded \`${from}\`'s \`${target}\` definition: another project's \`${target}\` was ` +
        `relocated to \`${FIREBASE_PROJECT_NAME}\` first, and one workspace suite cannot have two definitions. ` +
        `If \`${from}\`'s was the tuned one, restore it from git onto \`${FIREBASE_PROJECT_PATH}\`.`,
    );
  }

  if (Object.keys(carried).length === 0) return;

  if (home === 'create') createFirebaseProject(tree, carried);
  else mergeIntoFirebaseProject(tree, home, carried);
}

/**
 * Where the relocated targets belong: an existing project file, or `'create'` for a new `firebase/project.json`.
 *
 * The order is precedence. The canonical path wins if it is already there; otherwise a project ALREADY NAMED
 * `firebase` is the workspace's emulator home wherever it happens to live (someone moved it, or Nx inferred
 * it) and merging into it is both correct and the only way to avoid a duplicate-name workspace; otherwise a
 * project sitting at the `firebase/` root under some other name owns that directory, and writing a
 * project.json beside its package.json would silently RENAME it. Only when none of that is true is the path
 * genuinely free.
 *
 * `'blocked'` is the fourth answer, and it exists because "we could not READ it" was being answered with
 * "then we will WRITE it". A `firebase/project.json` that does not parse is dropped by `projectFiles` with a
 * warning promising its contents "were left as they are" — after which falling through to `'create'` had this
 * migration `writeJson` straight over the very file it had just refused to read, destroying whatever
 * hand-tuned emulator commands were in it. Nothing is relocated in that state: a destination we cannot read
 * is a destination we cannot merge into, and moving targets we have nowhere safe to put is the one thing
 * this step promises never to do.
 */
function resolveFirebaseHome(tree: Tree, projects: ProjectFile[]): ProjectFile | 'create' | 'blocked' {
  const canonical = projects.find((file) => file.path === FIREBASE_PROJECT_PATH);
  if (canonical) return canonical;

  // Present on disk but not among the readable project files — it did not parse (the only other way to get
  // here is a project.json Nx does not consider a project, which is equally not something to overwrite).
  if (tree.exists(FIREBASE_PROJECT_PATH)) {
    logger.warn(
      `[migrate 0.24.1] \`${FIREBASE_PROJECT_PATH}\` exists but could not be read, so NO emulator targets ` +
        `were relocated — overwriting a file this migration cannot parse would destroy whatever is in it. ` +
        `Fix that file and re-run \`nx migrate\` to finish the move.`,
    );
    return 'blocked';
  }

  const byName = projects.find((file) => file.name === FIREBASE_PROJECT_NAME);
  if (byName) {
    logger.info(
      `[migrate 0.24.1] A project named \`${FIREBASE_PROJECT_NAME}\` already exists at \`${byName.path}\`, so ` +
        `the relocated emulator targets go there rather than into a new \`${FIREBASE_PROJECT_PATH}\` — two ` +
        `projects under one name would break every \`nx\` command in this workspace.`,
    );
    return byName;
  }

  const byRoot = projects.find((file) => file.root === FIREBASE_PROJECT_NAME);
  if (byRoot) {
    logger.info(
      `[migrate 0.24.1] \`${FIREBASE_PROJECT_NAME}/\` is already the root of project \`${byRoot.name}\`, so ` +
        `the relocated emulator targets were merged into \`${byRoot.path}\` instead of a new project.json ` +
        `beside it (which would have renamed that project).`,
    );
    return byRoot;
  }

  return 'create';
}

/**
 * Create the workspace-level `firebase` project, carrying only what was relocated.
 *
 * It gets no `seed:build`, no `reset`, no tooling: those are capability, and a migration that added them
 * would be creating the Firebase layer (rule 5) for a project that never asked for it. The current generator
 * adds them the next time someone actually runs it with `--firebase`.
 */
function createFirebaseProject(tree: Tree, carried: Record<string, unknown>): void {
  writeJson(tree, FIREBASE_PROJECT_PATH, {
    name: FIREBASE_PROJECT_NAME,
    // One level down from the workspace root — `firebase/` — hence the single `../`.
    $schema: '../node_modules/nx/schemas/project-schema.json',
    projectType: 'application',
    // The suite runs server-side tooling; the tag is what the `platform:` ESLint firewall keys off, so a
    // project created here without it would be a hole in that firewall.
    tags: ['platform:server'],
    targets: ordered(carried),
  });
  logger.info(
    `[migrate 0.24.1] Created \`${FIREBASE_PROJECT_PATH}\` to hold the relocated emulator targets ` +
      '(definitions carried over as-is).',
  );
}

/**
 * Merge the carried targets into the emulator home that already exists.
 *
 * Its OWN definition of a target wins: the workspace-level one is the current shape (and possibly a tuned
 * one), while the app-level leftover is by definition the older copy.
 */
function mergeIntoFirebaseProject(tree: Tree, home: ProjectFile, carried: Record<string, unknown>): void {
  const json = tryReadJson(tree, home.path);
  if (!json) return;

  // The one place a container IS created — we have already taken the targets off the app, so the destination
  // must be able to receive them.
  const container: { targets?: Record<string, unknown> } =
    home.kind === 'package.json' ? (json.nx ??= {}) : json;
  const targets = (container.targets ??= {});

  let changed = false;
  for (const [name, definition] of Object.entries(ordered(carried))) {
    if (name in targets) continue;
    targets[name] = definition;
    changed = true;
  }
  if (changed) writeJson(tree, home.path, json);
}

/** Canonical order, so the file reads like a generated one regardless of which app the targets came off. */
function ordered(source: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(EMULATOR_TARGETS.filter((name) => name in source).map((name) => [name, source[name]]));
}

/**
 * Step 2 — delete the retired `no-emulators` / `standalone` build configurations.
 *
 * Returns two things, because deleting a build configuration orphans two kinds of thing:
 *   - `envFiles` — the environment files those configurations swapped in, so step 3 deletes exactly the
 *     files that just lost their last consumer instead of guessing at names;
 *   - `buildTargets` — the `<project>:build:<retired>` ids that no longer resolve, so the repair pass can
 *     re-point whatever still names them. The 0.24.0 migration promotes `serve-no-emulators` to the
 *     `dev-server` leaf WITH its options, `buildTarget: "<app>:build:no-emulators"` among them; deleting
 *     the configuration here without repairing that leaves `nx run <app>:dev-server` failing on a
 *     configuration that this very ladder removed.
 */
function dropRetiredBuildConfigurations(
  tree: Tree,
  projects: ProjectFile[],
): { envFiles: Set<string>; buildTargets: Map<string, string> } {
  const orphaned = new Set<string>();
  const buildTargets = new Map<string, string>();

  for (const file of projects) {
    // DELETING A BUILD CONFIGURATION IS ONLY SAFE IF WE CAN ALSO REPAIR REFERENCES TO IT, and references are
    // by project NAME. On the degraded scan a `project.json` with no `name` key leaves us holding a path
    // instead, so the repair below would silently match nothing while the delete still happened — leaving
    // `<project>:build:no-emulators` pointing at a configuration this very migration removed. Skipping is the
    // conservative half: the retired configuration survives one more release and nothing breaks, which is
    // the right trade against handing someone a workspace whose dev-server no longer resolves.
    if (!file.nameResolved) {
      logger.warn(
        `[migrate 0.24.1] Could not determine the project name for \`${file.path}\` (the project graph was ` +
          'unreadable and the file declares no `name`), so its retired build configurations were left in ' +
          'place — removing them without being able to repair `<project>:build:<configuration>` references ' +
          'would break the build. Fix the unparseable project file and re-run the sync.',
      );
      continue;
    }
    const json = tryReadJson(tree, file.path);
    if (!json) continue;
    const configurations = (targetsOf(file, json)?.['build'] as BuildTarget | undefined)?.configurations;
    if (!configurations) continue;

    let changed = false;
    for (const [name, retired] of Object.entries(RETIRED_BUILD_CONFIGURATIONS)) {
      const configuration = configurations[name];
      if (!configuration) continue;

      const replaced = swappedInFile(configuration, retired.envFile);
      // For an ambiguous name, no fileReplacement naming the retired env file means this configuration is no
      // longer the one we generated — someone repurposed the name. Leave it, and leave its env file alone in
      // step 3. For an unambiguous house name the name itself is the proof, so the configuration goes either
      // way and step 3 falls back to the conventional env-file location.
      if (!replaced && !retired.nameIsProof) continue;

      delete configurations[name];
      if (replaced) orphaned.add(replaced);
      buildTargets.set(`${file.name}:build:${name}`, `${file.name}:build`);
      changed = true;
      logger.info(
        `[migrate 0.24.1] Removed the retired \`${name}\` build configuration from \`${file.name}\` — ` +
          'going all-real is a runtime choice now (`?emulate=none`), not a build variant.',
      );
    }

    if (changed) writeJson(tree, file.path, json);
  }

  return { envFiles: orphaned, buildTargets };
}

/**
 * Step 2b — re-point every `buildTarget` that names a build configuration step 2 just deleted.
 *
 * Swept across the WHOLE workspace rather than only the project the configuration lived on, because a
 * `buildTarget` is a fully-qualified `<project>:build:<configuration>` id and nothing stops one project's
 * target from naming another's. Only an EXACT match of a removed id is rewritten — to the same target
 * without the configuration, i.e. the build's own default — so a `buildTarget` pointing at a configuration
 * that still exists is never touched.
 */
function repairRetiredBuildTargetReferences(
  tree: Tree,
  projects: ProjectFile[],
  retired: Map<string, string>,
): void {
  if (retired.size === 0) return;

  for (const file of projects) {
    const json = tryReadJson(tree, file.path);
    if (!json) continue;
    const targets = targetsOf(file, json);
    if (!targets) continue;

    let changed = false;
    for (const [targetName, definition] of Object.entries(targets)) {
      const target = definition as BuildTarget | undefined;
      if (!target || typeof target !== 'object') continue;
      for (const options of [target.options, ...Object.values(target.configurations ?? {})]) {
        const current = options?.['buildTarget'];
        if (typeof current !== 'string') continue;
        const repaired = retired.get(current);
        if (!repaired) continue;
        (options as BuildConfiguration)['buildTarget'] = repaired;
        changed = true;
        logger.info(
          `[migrate 0.24.1] \`${file.name}\`: re-pointed \`${targetName}\`'s buildTarget from \`${current}\` ` +
            `to \`${repaired}\` — the \`${current.slice(current.lastIndexOf(':') + 1)}\` build configuration ` +
            'is retired.',
        );
      }
    }

    if (changed) writeJson(tree, file.path, json);
  }
}

/**
 * The path a configuration swaps IN for the given retired env file, or `undefined` when it swaps in no such
 * thing. Matched on the file name rather than a root-derived path: the recorded path is whatever the
 * generator wrote at the time, and these file names are unique enough in a workspace to identify themselves.
 */
function swappedInFile(configuration: BuildConfiguration, envFile: string): string | undefined {
  const replacements = Array.isArray(configuration.fileReplacements) ? configuration.fileReplacements : [];
  return replacements.find((entry) => entry?.with?.endsWith(`/${envFile}`))?.with;
}

/**
 * Step 3 — delete the retired environment files, once nothing points at them.
 *
 * The referenced-check is not ceremony. A project may well swap this file in from somewhere we don't retire —
 * a configuration renamed to something the house never generated, or the build target's own `options` —
 * and deleting the file out from under it turns a working build into a missing-file error, a migration
 * breaking the very thing it was meant to tidy. Any file still referenced is kept and reported instead, so
 * the human can finish the job with the full picture.
 *
 * It sweeps EVERY target, not just `build`. `fileReplacements` is an option of the Angular *builder*, and a
 * `dev-server`, a `test` or a second build-like target carries its own — an earlier revision looked only at
 * `build` and deleted an env file a `dev-server` configuration still swapped in, which is exactly the
 * missing-file error the check exists to prevent.
 */
function deleteRetiredEnvironmentFiles(tree: Tree, projects: ProjectFile[], orphaned: Set<string>): void {
  // Re-read: step 2 has already written, so this sees the post-deletion set of references.
  const referenced = new Set<string>();
  for (const file of projects) {
    const json = tryReadJson(tree, file.path);
    if (!json) continue;
    for (const definition of Object.values(targetsOf(file, json) ?? {})) {
      const target = definition as BuildTarget | undefined;
      if (!target || typeof target !== 'object') continue;
      for (const configuration of [target.options, ...Object.values(target.configurations ?? {})]) {
        for (const entry of configuration?.fileReplacements ?? []) {
          if (entry?.with) referenced.add(entry.with);
          if (entry?.replace) referenced.add(entry.replace);
        }
      }
    }
  }

  // Candidates: what step 2 orphaned, plus the conventional location under every project — an older scaffold
  // could leave the file behind with no configuration ever pointing at it.
  //
  // The conventional-location sweep is limited to the names that are their OWN proof, and that limit is the
  // same judgement `nameIsProof` encodes one step up. `standalone` is a word a project may legitimately use
  // for its own build variant, so step 2 refuses to delete a `standalone` CONFIGURATION that does not swap in
  // our env file — and a `standalone` FILE with no such configuration pointing at it is exactly as
  // ambiguous. Protecting the configuration while deleting the file it might belong to protected nothing.
  // A `standalone` file only reaches this set through `orphaned`, i.e. when a configuration we PROVED was
  // ours named it.
  const candidates = new Set<string>(orphaned);
  for (const { root } of projects) {
    for (const { envFile, nameIsProof } of Object.values(RETIRED_BUILD_CONFIGURATIONS)) {
      if (nameIsProof) candidates.add(joinPathFragments(root, 'src/environments', envFile));
    }
  }

  for (const candidate of candidates) {
    if (!tree.exists(candidate)) continue;
    if (referenced.has(candidate)) {
      logger.warn(
        `[migrate 0.24.1] Kept ${candidate}: a build configuration still replaces a file with it. ` +
          'Retire that configuration and delete the file by hand — "no emulators" is a runtime choice now.',
      );
      continue;
    }
    tree.delete(candidate);
    logger.info(`[migrate 0.24.1] Deleted ${candidate} — nothing compiles it anymore.`);
  }

  // AND REPORT WHAT WAS DELIBERATELY LEFT. The ambiguous names above are excluded from the sweep on purpose —
  // `standalone` is a word a project may legitimately use for its own build variant, and deleting a source
  // file on a guess is not a trade this migration makes. But saying NOTHING about a file that nothing
  // references turns a considered decision into silent clutter, which is indistinguishable from an oversight
  // and is exactly how a workspace accumulates dead environment files nobody dares remove.
  for (const { root } of projects) {
    for (const { envFile, nameIsProof } of Object.values(RETIRED_BUILD_CONFIGURATIONS)) {
      if (nameIsProof) continue;
      const path = joinPathFragments(root, 'src/environments', envFile);
      if (!tree.exists(path) || referenced.has(path)) continue;
      logger.warn(
        `[migrate 0.24.1] ${path} is left over from a retired build variant and nothing references it — but ` +
          'its name is one a project may use for its own purposes, so it was NOT deleted. Remove it by hand ' +
          'if it is ours; "no emulators" is a runtime choice now (?emulate=none), not a build.',
      );
    }
  }
}

/** A project file's JSON, or `undefined` (reported once, by path) when it does not parse. */
function tryReadJson(tree: Tree, path: string): ProjectJson | undefined {
  try {
    return readJson<ProjectJson>(tree, path);
  } catch (error) {
    if (!reported.has(path)) {
      reported.add(path);
      logger.warn(
        `[migrate 0.24.1] Skipped ${path}: it does not parse (${errorText(error)}). Any app-level ` +
          `\`emulators*\` targets, retired build configurations and stale environment files in that project ` +
          `were left as they are — fix the file and re-run \`nx migrate\` to sweep it.`,
      );
    }
    return undefined;
  }
}

/** Paths already reported as unparseable this run — the three steps each re-read, and one warning is enough. */
const reported = new Set<string>();

/** The message of whatever was thrown — a migration log must never print `[object Object]`. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
