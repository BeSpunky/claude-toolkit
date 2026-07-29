// MIGRATION 0.24.4 — give a devcontainer written BEFORE the ownership marker existed a marker of its own.
//
// THE POPULATION THIS REACHES, and why 0.24.0 cannot. `0.24.0/stamp-devcontainer-ownership` repairs a marker
// that exists but predates the `owned` flag. It opens with `if (!tree.exists(MARKER)) return;` under the
// comment "a project that never had a house devcontainer has no marker" — and for every project scaffolded at
// nx-tools 0.15.0 or earlier that assumption is simply false. The marker did not exist at all before 0.16.0
// (`2ace14b` introduced the file; `5812cb1`, two commits later, added the flag), while the devcontainer
// generator had been writing `.devcontainer/devcontainer.json` unconditionally for many releases before that.
//
// So those projects have a house-written devcontainer and NO marker. On their first sync to a modern toolkit
// the generator computes `owning = !exists || marker?.owned === true` — the file exists, there is no marker —
// concludes the devcontainer is somebody else's, and merges into it additively from then on. Nothing errors.
// The file simply freezes: `mergeIntoForeign` only ever ADDS, so a changed image is skipped, a retired port or
// extension is never removed, and the container drifts further from the house standard on every release while
// HOUSE.md is stamped current on the same run. That is the degradation this closes.
//
// WHY IT IS REGISTERED ABOVE THE VERSION THAT INTRODUCED THE CHANGE. The obvious key would be 0.16.0, the
// release where the marker appeared. It would be wrong. A ≤0.15.0 project that has ALREADY taken one sync
// past 0.16.0 has been misclassified and stamped with that newer version, so a 0.16.0 key would skip exactly
// the projects that carry the damage. The migration is keyed above every published version instead, and made
// a no-op for everyone it does not concern.
//
// SELF-CONTAINED by the migration contract: the constants and helpers below are copies of 0.24.0's, not
// imports from it or from ../../generators/**. A migration must execute the behaviour it was written against.
import { type Tree, logger, parseJson } from '@nx/devkit';

const DEVCONTAINER = '.devcontainer/devcontainer.json';
const MARKER = '.devcontainer/.bespunky-devcontainer.json';

/**
 * The first line of every `devcontainer.json` the generator has ever RENDERED, and one the adoption path
 * cannot produce: merging splices JSON values through jsonc-parser and has no route by which house comment
 * prose enters a foreign file. Its presence means `render()` wrote this file.
 */
const HOUSE_HEADER = '// BeSpunky-standard devcontainer.';

/**
 * Every top-level key any revision of the house template has ever emitted. The second half of the
 * fingerprint: an unrecognised key means the file has grown something the house never wrote, which demotes
 * the verdict to ambiguous — whether that came from a hand-copied template or a human's own extension.
 */
const HOUSE_TOP_LEVEL_KEYS = new Set([
  'name',
  'image',
  'features',
  'customizations',
  'postCreateCommand',
  'remoteUser',
  'runArgs',
  'forwardPorts',
  'portsAttributes',
  'otherPortsAttributes',
  'containerEnv',
  'remoteEnv',
  'mounts',
]);

export default function claimLegacyDevcontainerOwnership(tree: Tree): void {
  // Nothing to classify. The generator already treats a missing devcontainer as its own (`owning = !exists`)
  // and stamps `owned: true` itself on the run that follows this one.
  if (!tree.exists(DEVCONTAINER)) return;

  if (tree.exists(MARKER)) {
    // A marker with a decision in it is a decision we do not overturn — see the note below. The only thing
    // left to do is tell a human when that decision looks like it was made on missing evidence.
    const marker = tryParse(tree.read(MARKER, 'utf8') ?? '');
    if (marker && marker['owned'] === false && looksGeneratorWritten(tree)) {
      // DELIBERATELY A WARNING, NOT A REWRITE. `owned: false` on a conclusively house-written file has two
      // possible authors, and nothing in the file distinguishes them: the generator, which wrote it after
      // misjudging a marker-less devcontainer (the bug above), or a HUMAN who set it to stop the generator
      // overwriting a devcontainer they had made their own — which is precisely what 0.24.0's own log message
      // invites them to do, in reverse. Flipping it would silently hand back overwrite permission over
      // someone's container, on their next sync, with no undo but the backup tag. A one-word manual fix is
      // the right price for not doing that to the people who chose it.
      logger.warn(
        `[migrate 0.24.4] \`${MARKER}\` records \`owned: false\`, but \`${DEVCONTAINER}\` looks generator-` +
          `written. If this project's devcontainer predates the ownership marker it was misclassified once ` +
          `and has stopped receiving house updates; set \`"owned": true\` there to resume them. If you set ` +
          `it to false deliberately, nothing needs doing — this run changed nothing.`
      );
    }
    return;
  }

  // No marker, and a devcontainer that exists: the ≤0.15.0 shape. Decide once, record it explicitly, and
  // never make anyone reason about it again — an explicit `false` is as valuable as an explicit `true`,
  // because it is what stops the next generator run from re-deriving the same ambiguity.
  const owned = looksGeneratorWritten(tree);
  tree.write(MARKER, `${JSON.stringify({ generator: '@bespunky/nx-tools:devcontainer', owned }, null, 2)}\n`);

  logger.info(
    owned
      ? `[migrate 0.24.4] \`${DEVCONTAINER}\` predates the ownership marker and is generator-written — ` +
          `recorded \`owned: true\`, so it resumes receiving house updates instead of only ever being added to.`
      : `[migrate 0.24.4] \`${DEVCONTAINER}\` predates the ownership marker and could not be shown to be ` +
          `generator-written — recorded \`owned: false\`, so house settings are only ever ADDED to it and ` +
          `nothing of yours is overwritten. If it really is the toolkit's, set \`"owned": true\` there by hand.`
  );
}

/**
 * Is `.devcontainer/devcontainer.json` conclusively a file this generator RENDERED? Conclusive or nothing —
 * every uncertain answer is `false`, because `false` is the direction that cannot destroy anyone's work.
 */
function looksGeneratorWritten(tree: Tree): boolean {
  const text = tree.read(DEVCONTAINER, 'utf8') ?? '';
  if (!text.includes(HOUSE_HEADER)) return false;

  // A file we cannot parse is a file we cannot vouch for, and one the generator's own merge path already
  // refuses to touch.
  const parsed = tryParse(text);
  if (!parsed) return false;

  return Object.keys(parsed).every((key) => HOUSE_TOP_LEVEL_KEYS.has(key));
}

/** JSONC -> plain object, or `undefined` for anything that isn't a parseable object. */
function tryParse(source: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = parseJson(source);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
