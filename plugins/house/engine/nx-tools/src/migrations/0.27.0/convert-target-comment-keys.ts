// 0.26.0 — move `"//name": "…"` documentation keys out of `targets` and onto the target's `metadata.description`.
//
// THE DEFECT IS NX'S, AND IT IS NOT COSMETIC. `//`-prefixed keys are the conventional way to comment JSON that
// has no comments, and they are harmless nearly everywhere in a project.json. Inside `targets` they are not:
// that is the one object where Nx expects EVERY value to be a TargetConfiguration, and
// `mergeTargetConfigurations` reaches into the string as if it were one. Verified against Nx 23.1.0:
//
//     TypeError: Cannot use 'in' operator to search for '0' in "Specs are TRANSPILED by the unit-test…"
//         at processKey (nx/…/project-configuration/target-merging.js)
//         at mergeTargetConfigurations
//         at readProjectConfiguration
//
// The `'0'` is a character index — the string being spread key-by-key. On OLDER Nx the same path did not throw;
// it wrote the spread result back, turning a 555-character comment into a 555-key object inside project.json.
// That is how this was found: a house generator "corrupted" a file it never touched, because the damage happens
// in the devkit round-trip (read → mutate → write), not in anything the generator writes.
//
// Position matters, and only one position is affected. Probed independently, each in isolation:
//
//     project root (sibling of `targets`)      INTACT
//     inside `targets` (sibling of a target)   THROWS   ← this migration
//     inside a target (sibling of `executor`)  INTACT
//     inside a target's `options`              INTACT
//
// So this converts ONLY direct children of `targets`. Sweeping every `//` key in the file would rewrite
// comments that are perfectly safe and that the project deliberately wrote — the over-reach the house rule
// against guessing exists to prevent.
//
// WHY `metadata.description`. Nx models this: `TargetConfiguration.metadata?: TargetMetadata` carries a
// `description`, declared in nx/src/config/workspace-json-project-json.d.ts and available across the range the
// payload supports (`@nx/devkit >= 23.0.0`). Verified to survive the same read → mutate → write round-trip
// unchanged. It is a schema field rather than a key that happens to be ignored, so it also shows up in Nx
// tooling instead of only in the file.
//
// ── RAW JSON ONLY. THIS MIGRATION CANNOT USE THE DEVKIT PROJECT APIS ────────────────────────────────────────
//
// `getProjects()`, `readProjectConfiguration()` and `updateProjectConfiguration()` all route through the merge
// path above, so calling any of them here would crash on precisely the shape this exists to repair. Everything
// below reads and writes `project.json` as plain JSON (`readJson`/`writeJson`, `tree.children` to find them) —
// verified: raw reads are unaffected.
//
// The same fact has a consequence this migration cannot fix, so it is written down instead. Older migrations in
// the ladder — `unify-serve-targets` (0.24.0) and its neighbours — DO call `getProjects()`. A project that is
// both far enough behind to collect them AND carries one of these keys AND is on Nx 23 will fail there, before
// reaching this. That failure is loud (a thrown TypeError naming the comment's text) and the escape is one
// manual edit: delete or relocate the `//` key inside `targets`, then re-run the sync. A project already at or
// past 0.25.x — which is every project that hit the silent-corruption version of this bug — collects only this
// migration and is repaired without incident.
//
// SELF-CONTAINED ON PURPOSE, like every migration here: the scan and the rules are copied, not imported, so
// someone jumping several versions at once runs the behaviour this was written against rather than a future
// generator's idea of it.
import { type Tree, readJson, writeJson, logger } from '@nx/devkit';

/** Directories that never hold a project, and are expensive or meaningless to walk. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.nx', '.angular', '.firebase', 'dist', 'tmp', 'coverage']);

/** Deep enough for any sane workspace nesting; a guard against a symlink loop, not a real limit. */
const MAX_DEPTH = 12;

/** A documentation key: `//`, optionally more slashes, then the name of the target it documents. */
const COMMENT_KEY = /^\/\/+\s*(.*)$/;

interface Leftover {
  file: string;
  key: string;
  why: string;
}

export default async function convertTargetCommentKeys(tree: Tree): Promise<void> {
  const files = findProjectJsonFiles(tree);
  const converted: string[] = [];
  const leftovers: Leftover[] = [];

  for (const file of files) {
    const json = tryReadJson(tree, file);
    // A project.json that is not an object, or has no `targets` object, has nothing this migration cares about.
    if (!json || typeof json !== 'object') continue;
    const targets = (json as Record<string, unknown>).targets;
    if (!targets || typeof targets !== 'object' || Array.isArray(targets)) continue;

    const targetMap = targets as Record<string, unknown>;
    let changed = false;

    for (const key of Object.keys(targetMap)) {
      const match = COMMENT_KEY.exec(key);
      if (!match) continue;
      const value = targetMap[key];

      // Only a STRING value triggers the Nx defect (it is spread character by character). A `//` key holding an
      // object is a different animal — Nx would treat it as a real target — and guessing what the author meant
      // by it is not this migration's business. Report it.
      if (typeof value !== 'string') {
        leftovers.push({
          file,
          key,
          why: `its value is of type '${Array.isArray(value) ? 'array' : typeof value}', not a documentation string`,
        });
        continue;
      }

      const targetName = match[1].trim();
      const target = targetName ? targetMap[targetName] : undefined;

      // No target of that name: the comment documents something that does not exist here — a target removed
      // long ago, a note about the file as a whole, or a name that never matched. Moving it would invent a home
      // for it and deleting it would destroy the only copy, so it stays and is named in the log. It is still
      // dangerous where it sits, which is exactly why silence would be the wrong answer.
      if (!target || typeof target !== 'object' || Array.isArray(target)) {
        leftovers.push({
          file,
          key,
          why: targetName
            ? `no target named '${targetName}' exists in this project`
            : 'it names no target',
        });
        continue;
      }

      const targetConfig = target as Record<string, unknown>;
      const metadata = (targetConfig.metadata ??= {}) as Record<string, unknown>;

      // Never overwrite a description the project already wrote. Two sources of truth is the failure mode; so
      // is silently picking one. Keep what is there, leave the comment, and say so.
      if (typeof metadata.description === 'string' && metadata.description.trim() && metadata.description !== value) {
        leftovers.push({
          file,
          key,
          why: `target '${targetName}' already has a metadata.description, and overwriting it would discard one of the two`,
        });
        continue;
      }

      metadata.description = value;
      delete targetMap[key];
      changed = true;
      converted.push(`${file}: '${key}' -> targets.${targetName}.metadata.description`);
    }

    if (changed) writeJson(tree, file, json);
  }

  if (converted.length === 0 && leftovers.length === 0) return;

  for (const line of converted) logger.info(`[convert-target-comment-keys] ${line}`);

  if (converted.length > 0) {
    logger.info(
      `[convert-target-comment-keys] Moved ${converted.length} documentation key(s) out of 'targets'. Left where ` +
        `they were, they make every house generator throw on Nx 23 and silently corrupt project.json on older Nx.`
    );
  }

  // The leftovers are the half that is easy to skip and expensive to miss: each one is still a live hazard,
  // and an unexplained one is indistinguishable from an oversight.
  for (const leftover of leftovers) {
    logger.warn(
      `[convert-target-comment-keys] LEFT IN PLACE: '${leftover.key}' in ${leftover.file} — ${leftover.why}.`
    );
  }
  if (leftovers.length > 0) {
    logger.warn(
      `[convert-target-comment-keys] ${leftovers.length} key(s) inside 'targets' could not be converted without ` +
        `guessing, so they were not touched. Each one still breaks Nx's project-configuration read: move it to ` +
        `the project root, onto the target it documents, or into that target's metadata.description by hand.`
    );
  }
}

/** Every `project.json` in the workspace, found by walking the tree — never via the devkit project APIs. */
function findProjectJsonFiles(tree: Tree): string[] {
  const found: string[] = [];
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
      if (child === 'project.json') found.push(path);
    }
  };
  walk('.', 0);
  return found;
}

/** A project.json that is not valid JSON is not this migration's problem to diagnose — skip it, don't crash. */
function tryReadJson(tree: Tree, path: string): unknown {
  try {
    return readJson(tree, path);
  } catch {
    return null;
  }
}
