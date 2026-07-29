// MIGRATION 0.24.0 — write an explicit `owned` flag onto devcontainer markers that predate it.
//
// THE DEGRADATION THIS REPAIRS. The devcontainer generator decides "regenerate the file we maintain" vs
// "adopt somebody else's" from `.devcontainer/.bespunky-devcontainer.json`, and it reads that as
// `marker?.owned === true`. Markers written before the flag existed carry only `{ generator, flags }`, so
// they read as NOT owned: a devcontainer this toolkit wrote quietly became an adopted one and stopped
// receiving house updates to every key it already declares. Nothing breaks loudly; the project just drifts.
//
// WHY THIS IS NOT `owned: true` FOR EVERYONE. The legacy marker was written on BOTH paths — the run that
// ADOPTED a foreign devcontainer wrote one too (that is the very bug the `owned` flag was introduced to
// fix). So a legacy marker is evidence that this generator RAN here, not that it AUTHORED the file.
// Blanket-setting `owned: true` would hand the generator permission to overwrite devcontainers it had
// carefully merged into — someone's hand-written image, features and mounts, gone on their NEXT sync, with
// no undo short of the backup tag. Re-introducing that through a migration would be strictly worse than
// leaving the degradation in place, because a migration reaches every project at once.
//
// SO THE DECISION IS MADE BY EVIDENCE IN THE FILE ITSELF, and when the evidence is anything short of
// conclusive the answer is an explicit `owned: false` — the documented safe direction, and the same one the
// generator already takes for a missing flag. Writing it EXPLICITLY is the point: the file stops being
// ambiguous forever, so this reasoning never has to run again.
//
// SELF-CONTAINED by the migration contract: the constants and the parse helper below are copies, not
// imports from ../../generators/**. A migration must execute the behaviour it was written against, and an
// import would resolve against whatever the newest installed package became.
import { type Tree, logger, parseJson } from '@nx/devkit';

const DEVCONTAINER = '.devcontainer/devcontainer.json';
const MARKER = '.devcontainer/.bespunky-devcontainer.json';

/**
 * THE FINGERPRINT — the first line of `devcontainer.json.tpl`, present in every revision of that template
 * that has ever existed (checked across its full history), and therefore in every file the generator has
 * ever RENDERED.
 *
 * It is chosen because it cannot arrive by the other path. The adoption path never writes the template: it
 * edits the project's existing text with jsonc-parser, splicing in JSON VALUES only — an image string, an
 * extension, a mount. There is no code path by which a merge introduces house COMMENT PROSE. So this line
 * in the file means `render()` produced the file.
 *
 * Prose was preferred over structure (the noVNC portsAttributes band, the `--sysctl` runArg) for exactly
 * that reason: structure is what the merge ADDS, so an adopted devcontainer can legitimately end up with
 * the whole noVNC band in it. Comments are what the merge cannot add.
 */
const HOUSE_HEADER = '// BeSpunky-standard devcontainer.';

/**
 * Every top-level key any revision of the house template has ever emitted.
 *
 * This is the second half of the fingerprint, and it closes the one hole the first half leaves: somebody who
 * COPIED a house devcontainer.json into their project by hand, then ran a sync. The generator would have
 * adopted that file (no marker yet) and merged into it — leaving a legacy marker beside a file that carries
 * the house header and is nonetheless the project's own. A file in that state is very likely to have grown a
 * key the house template never writes, so an unrecognised top-level key demotes the verdict to ambiguous.
 *
 * It also demotes an owned devcontainer a human has since hand-extended. That is intended: once someone has
 * added their own key, additive merging is the behaviour that protects it.
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

export default function stampDevcontainerOwnership(tree: Tree): void {
  // SAFE ON ABSENCE. A project that never had a house devcontainer has no marker, and must come out of this
  // byte-identical — including the case where the marker is unparseable, which we are not equipped to repair
  // and must not replace (it may be the only record of an adoption report).
  if (!tree.exists(MARKER)) return;
  const marker = tryParse(tree.read(MARKER, 'utf8') ?? '');
  if (!marker) return;

  // IDEMPOTENCY, and respect for a decision already made. A marker that already carries `owned` — EITHER
  // value — is left exactly as it is. This is the whole idempotency guarantee: the stamp only moves at the
  // end of a sync, so a sync that fails midway re-selects this migration, and the second pass must find
  // nothing to do. It is also correct on its own terms — `owned: false` written by a newer generator is a
  // recorded adoption, not a gap to fill in.
  if ('owned' in marker) return;

  const owned = looksGeneratorWritten(tree);

  // Preserve every other key by construction: spread the parsed marker and add one field. Re-serialising is
  // safe here in a way it would not be for devcontainer.json — this file is machine-written by the generator
  // through JSON.stringify and is not a place anyone writes comments. Key order is irrelevant (the marker is
  // read by key), and the next generator run rewrites the file wholesale anyway.
  tree.write(MARKER, `${JSON.stringify({ ...marker, owned }, null, 2)}\n`);

  logger.info(
    owned
      ? `[migrate] \`${MARKER}\` now records \`owned: true\` — \`${DEVCONTAINER}\` is generator-written, so ` +
          `it resumes receiving house updates.`
      : `[migrate] \`${MARKER}\` now records \`owned: false\` — \`${DEVCONTAINER}\` could not be shown to be ` +
          `generator-written, so it stays ADOPTED and house settings are only ever added to it. If this ` +
          `project's devcontainer really is the toolkit's, set \`"owned": true\` there by hand.`
  );
}

/**
 * Is `.devcontainer/devcontainer.json` conclusively a file this generator RENDERED?
 *
 * Conclusive or nothing — every uncertain answer is `false`. A missing devcontainer.json also lands here as
 * `false`, and harmlessly so: with no file to protect the generator already treats itself as owning
 * (`owning = !exists || ours`) and will restamp the marker with `owned: true` on the very next run.
 */
function looksGeneratorWritten(tree: Tree): boolean {
  if (!tree.exists(DEVCONTAINER)) return false;

  const text = tree.read(DEVCONTAINER, 'utf8') ?? '';
  if (!text.includes(HOUSE_HEADER)) return false;

  // A file we cannot parse is a file we cannot vouch for — and one the generator's own merge path already
  // refuses to touch. Do not promote it to "ours".
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
