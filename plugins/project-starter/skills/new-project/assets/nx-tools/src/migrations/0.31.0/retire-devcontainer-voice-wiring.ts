// MIGRATION 0.31.0 — clear the hand-placed voice wiring out of `devcontainer.json`, now that the
// `./features/voice` DevContainer feature declares the same two things itself.
//
// WHAT MOVED. Voice used to be two halves in two files: the `/mnt/wslg` bind mount and the
// `PULSE_SERVER` remoteEnv entry, both written into `devcontainer.json` by the devcontainer generator's
// `{{#voice}}` blocks, plus the apt engine installed by `post-create.sh`. 0.31.0 makes the capability ONE
// unit — a local DevContainer feature at `.devcontainer/features/voice/` whose
// `devcontainer-feature.json` declares the mount, `PULSE_SERVER` and `BESPUNKY_VOICE=1`, and whose
// `install.sh` installs the engine. The generator's template no longer emits either entry.
//
// WHY A MIGRATION IS OWED AT ALL — and why for EVERY project, not only adopted ones.
//
// The obvious reading is that only an ADOPTED devcontainer is at risk: `mergeIntoExisting(…, 'adopt')`
// adds missing keys and appends missing array members and never removes, so a house entry it appended
// once survives forever. That much is true — but it is not the whole population, and assuming it was
// would have left most projects broken.
//
// Since `1ffe9bd` ("ownership re-asserts house keys, it no longer rewrites the file", payload 0.26.0)
// OWNING a devcontainer no longer means rewriting it either. `tree.write(rendered)` happens on exactly
// one path — the file does not exist yet. Every other run, owned or adopted, goes through the same
// additive merge, which iterates the keys the HOUSE renders and, for arrays, only ever appends. A key
// the template has STOPPED rendering is therefore never visited, and an array member it has stopped
// rendering is never removed. So `remoteEnv.PULSE_SERVER` and the `/mnt/wslg` mount would sit in an
// OWNED devcontainer just as permanently as in an adopted one. Ownership is not the axis; "the file
// already exists" is. This migration is deliberately blind to the ownership marker's `owned` flag.
//
// WHY THE LEFTOVER IS MORE THAN UNTIDY. The feature declares the same bind target and the same env var,
// so a project that keeps its old copies has two sources of truth for one capability — and, with the
// feature in place, two mounts claiming the target `/mnt/wslg`. The generator's own merge treats a mount
// as identified BY ITS TARGET for exactly this reason ("adding a second one for the same target is what
// breaks a container rather than enriching it"), and a duplicated bind target is a plausible hard
// failure at container creation. The house rule this discharges is *carrying data means clearing the
// original*: the feature is the new home, so the old copies must go.
//
// THE GATE: THE COLLISION EXISTS ONLY WHERE VOICE IS ON, SO THAT IS THE ONLY PLACE THIS DELETES.
//
// The feature folder is written only when the devcontainer generator runs with `--voice=true`, and
// `scaffold.sh` derives that from the ownership marker's `flags.voice` (voice has no workspace trace to
// detect, so its previous answer is STICKY — see the `_dc_voice` block in the rendered sync sequence).
// One consequence, and it is the whole safety argument: where the marker says voice is on, the same sync
// that runs this migration writes the feature moments later, so the bridge is handed over, not removed.
// Where it does not, no feature is written, no collision can arise, and the entries in `devcontainer.json`
// may well be the ONLY thing giving that container audio — a hand-added bridge, or a marker predating
// `flags`. Deleting there would be a guess that silently kills someone's microphone, so those are LEFT
// and REPORTED, with the one command that resolves them.
//
// SCOPED TO THE HOUSE VALUE, for the same reason. Candidates are found by TARGET (the house's own notion
// of mount identity), then each is removed only if it IS the house mount — `source=/mnt/wslg`,
// `target=/mnt/wslg`, `type=bind`, nothing else. A member targeting `/mnt/wslg` with a different source
// is not hypothetical: the template's own comment told people to swap the source to
// `/run/desktop/mnt/host/wslg` on the Docker Desktop WSL2 backend. That is a deliberate, host-specific
// choice carrying information this migration cannot reconstruct, so it is left and named. `PULSE_SERVER`
// is removed only when it holds the house value; any other value is the project's own answer.
//
// THE ORPHANED PROSE IS PART OF THE OLD SHAPE. jsonc-parser removes a member together with the text
// preceding it, so the house comment block explaining the mount disappears with it whenever the mount is
// the LAST member of `mounts` — which is how the template renders it. It is not always still last: later
// releases append their own mounts after it. In that case the removal leaves a paragraph describing a
// mount that no longer exists, silently re-attached to the member below. So once no live wiring remains,
// the standalone comment lines that talk about the WSLg bridge go too — a comment about a deleted thing
// is a dangling reference like any other.
//
// SELF-CONTAINED by the migration contract: the paths, the house values and the JSONC helpers below are
// copies of the generator's, not imports from it. A migration must execute the behaviour it was written
// against, whatever the generators look like by the time a project climbs the ladder.
import { type Tree, logger, parseJson } from '@nx/devkit';
import { applyEdits, modify } from 'jsonc-parser';

const DEVCONTAINER = '.devcontainer/devcontainer.json';
const MARKER = '.devcontainer/.bespunky-devcontainer.json';

/** The bind target the feature now claims. Mount identity is the target — see the generator's `sameMember`. */
const WSLG_TARGET = '/mnt/wslg';

/** The mount the `{{#voice}}` block rendered, field for field. Anything else targeting WSLG_TARGET is not ours. */
const HOUSE_MOUNT: Record<string, string> = { source: '/mnt/wslg', target: '/mnt/wslg', type: 'bind' };

const PULSE_KEY = 'PULSE_SERVER';

/** The value the `{{#voice}}` block rendered into `remoteEnv`. Only this exact string is removed. */
const HOUSE_PULSE = 'unix:/mnt/wslg/PulseServer';

/** How the feature now supplies the same two things — quoted in every message, so the log is actionable. */
const FEATURE = '.devcontainer/features/voice';

type Json = Record<string, unknown>;

export default function retireDevcontainerVoiceWiring(tree: Tree): void {
  if (!tree.exists(DEVCONTAINER)) return;

  const text = tree.read(DEVCONTAINER, 'utf8') ?? '';
  const parsed = tryParse(text);

  if (!parsed) {
    // Unparseable: no edit is possible and none is attempted — the generator's merge refuses this file
    // too. Silent when there is nothing here to clear; a leftover we cannot reach is still a leftover, so
    // if the wiring IS in there it gets named rather than swallowed.
    if (mentionsVoiceWiring(text)) {
      logger.warn(
        `[migrate 0.31.0] \`${DEVCONTAINER}\` could not be parsed as JSONC, so the voice wiring inside it ` +
          `was LEFT AS-IS. Once the file parses, remove the mount targeting \`${WSLG_TARGET}\` and the ` +
          `\`remoteEnv.${PULSE_KEY}\` entry by hand: \`${FEATURE}\` declares both, and two mounts claiming ` +
          `the same bind target can fail the container build.`
      );
    }
    return;
  }

  const mounts = Array.isArray(parsed.mounts) ? (parsed.mounts as unknown[]) : [];
  const remoteEnv = isPlainObject(parsed.remoteEnv) ? parsed.remoteEnv : undefined;

  // Candidates by TARGET, classified by VALUE. `foreign` is everything that claims the target without
  // being the mount the house wrote.
  const candidates = mounts
    .map((member, index) => ({ member, index }))
    .filter(({ member }) => mountTarget(member) === WSLG_TARGET);
  const ours = candidates.filter(({ member }) => isHouseMount(member));
  const foreign = candidates.filter(({ member }) => !isHouseMount(member));

  const pulse = remoteEnv?.[PULSE_KEY];
  const pulseIsHouse = pulse === HOUSE_PULSE;

  // Nothing of either kind: a project that never enabled voice, or one that has already climbed this
  // rung. The idempotency fixed point, and the overwhelmingly common case.
  if (candidates.length === 0 && pulse === undefined) return;

  // THE GATE. No voice flag -> no feature will be written -> nothing collides, and what is here may be
  // the only bridge this container has. Report the whole lot and touch none of it.
  if (!voiceEnabled(tree)) {
    logger.warn(
      `[migrate 0.31.0] \`${DEVCONTAINER}\` carries voice wiring ` +
        `(${describe(candidates.length, `mount(s) targeting ${WSLG_TARGET}`, pulse !== undefined)}), but ` +
        `\`${MARKER}\` does not record \`flags.voice: true\` — so this sync writes no \`${FEATURE}\` and ` +
        `these entries are the only WSLg bridge here. They were LEFT EXACTLY AS-IS: removing them would ` +
        `take away audio nothing else provides. To move this project onto the feature (one unit: mount, ` +
        `${PULSE_KEY}, and the espeak-ng/pulseaudio-utils engine), re-run the sync with \`--voice\` — the ` +
        `next run of this migration then clears these entries.`
    );
    return;
  }

  // --- remove, house value only -----------------------------------------------------------------------
  // Descending index order: each edit re-computes offsets from the CURRENT text, and removing a later
  // element cannot move an earlier one. Ascending would shift every index after the first removal.
  let next = text;
  for (const { index } of [...ours].sort((a, b) => b.index - a.index)) {
    next = applyEdits(next, modify(next, ['mounts', index], undefined, { formattingOptions: JSONC_FORMAT }));
  }
  if (pulseIsHouse) {
    next = applyEdits(next, modify(next, ['remoteEnv', PULSE_KEY], undefined, { formattingOptions: JSONC_FORMAT }));
  }

  // --- and the prose that described them ----------------------------------------------------------------
  // Only once the file has no live wiring left: while a mount or an env var about the bridge survives,
  // the comments explaining it are still true, and deleting them would strip the explanation off the very
  // entry this migration deliberately refused to touch.
  let commentsRemoved = 0;
  if (!hasLiveVoiceWiring(next)) {
    const swept = stripVoiceComments(next);
    next = swept.text;
    commentsRemoved = swept.removed;
  }

  const changed = ours.length > 0 || pulseIsHouse;
  if (changed || commentsRemoved > 0) tree.write(DEVCONTAINER, next);

  if (changed) {
    logger.info(
      `[migrate 0.31.0] Cleared the hand-placed voice wiring from \`${DEVCONTAINER}\` — ` +
        `${ours.length > 0 ? `${ours.length} mount(s) targeting \`${WSLG_TARGET}\`` : 'no mount'}` +
        `${pulseIsHouse ? ` and \`remoteEnv.${PULSE_KEY}\`` : ''}` +
        `${commentsRemoved > 0 ? `, plus ${commentsRemoved} now-orphaned comment line(s) about the WSLg bridge` : ''}. ` +
        `\`${FEATURE}\` declares the mount, ${PULSE_KEY} and \`BESPUNKY_VOICE=1\` itself, so the capability ` +
        `is one unit instead of two halves — keeping both would have left two mounts claiming the same bind ` +
        `target. The feature is written by the devcontainer generator later in this sync; if you ran the ` +
        `migrations on their own (\`nx migrate --run-migrations\`), run \`scaffold.sh --sync\` so it lands. ` +
        `Either way the container must be REBUILT before voice works again.`
    );
  }

  // Left behind, deliberately — say so, name it, say why. An unexplained leftover is indistinguishable
  // from an oversight, and this one now sits next to a feature declaring the same bind target.
  if (foreign.length > 0) {
    logger.warn(
      `[migrate 0.31.0] \`${DEVCONTAINER}\` has ${foreign.length} mount(s) targeting \`${WSLG_TARGET}\` that ` +
        `this generator did not write — ${foreign.map(({ member }) => JSON.stringify(member)).join(', ')} — ` +
        `so they were LEFT IN PLACE. A different \`source=\` is a deliberate host-specific choice (the old ` +
        `template told people to swap it to \`/run/desktop/mnt/host/wslg\` on the Docker Desktop WSL2 ` +
        `backend), and this migration cannot reconstruct it. But \`${FEATURE}\` now declares a mount on the ` +
        `SAME target: reconcile them by hand — drop yours if the feature's plain \`/mnt/wslg\` source works ` +
        `on this host, or keep yours and drop \`"./features/voice"\` from \`features\` if it does not.`
    );
  }

  if (pulse !== undefined && !pulseIsHouse) {
    logger.warn(
      `[migrate 0.31.0] \`${DEVCONTAINER}\` sets \`remoteEnv.${PULSE_KEY}\` to ${JSON.stringify(pulse)}, ` +
        `which is not the house value (\`${HOUSE_PULSE}\`) — so it was LEFT AS-IS: a project pointing at its ` +
        `own PulseAudio sink is not this migration's to overrule. Note that \`${FEATURE}\` also declares ` +
        `${PULSE_KEY} (in \`containerEnv\`); \`remoteEnv\` wins for editor-spawned processes, so YOUR value ` +
        `still applies there and the feature's applies to everything else. Remove one of the two to have a ` +
        `single answer.`
    );
  }
}

/**
 * Does the ownership marker record voice as ON?
 *
 * Deliberately the same fact `scaffold.sh` reads when it decides whether to pass `--voice=true` to the
 * generator (its `_dc_voice` stickiness check greps this file for `"voice": true`). Reading the same
 * source is what makes "the feature will exist by the end of this sync" true rather than hopeful — the
 * two answers cannot disagree, because the generator only ever writes that flag under `flags`.
 */
function voiceEnabled(tree: Tree): boolean {
  if (!tree.exists(MARKER)) return false;
  const marker = tryParse(tree.read(MARKER, 'utf8') ?? '');
  const flags = marker && isPlainObject(marker.flags) ? marker.flags : undefined;
  return flags?.voice === true;
}

/**
 * A mount member's bind target — the house's own notion of mount IDENTITY (see `sameMember` in the
 * devcontainer generator). Handles both spellings: the `source=…,target=…` string the template rendered,
 * and the object form a project may have written by hand.
 */
function mountTarget(member: unknown): string | undefined {
  if (typeof member === 'string') return /(?:^|,)\s*target=([^,]+)/.exec(member)?.[1];
  if (isPlainObject(member)) return typeof member.target === 'string' ? member.target : undefined;
  return undefined;
}

/**
 * Is this member the mount the `{{#voice}}` block rendered — exactly, field for field?
 *
 * Exact is the point. An extra option (`consistency=cached`), a different source, anything the house
 * never emitted, means somebody made a decision here, and the value cannot say which. Both spellings
 * qualify: an object form carrying the same three fields is semantically the mount the feature now
 * declares, so removing it loses nothing.
 */
function isHouseMount(member: unknown): boolean {
  const fields = mountFields(member);
  if (!fields) return false;
  const keys = Object.keys(fields);
  return (
    keys.length === Object.keys(HOUSE_MOUNT).length &&
    keys.every((key) => fields[key] === HOUSE_MOUNT[key])
  );
}

/** A mount member as a flat field map, or `undefined` for a shape we do not recognise. */
function mountFields(member: unknown): Record<string, string> | undefined {
  if (typeof member === 'string') {
    const fields: Record<string, string> = {};
    for (const part of member.split(',')) {
      const at = part.indexOf('=');
      if (at === -1) return undefined; // A bare segment is a spelling we did not write and will not guess at.
      fields[part.slice(0, at).trim()] = part.slice(at + 1).trim();
    }
    return fields;
  }
  if (isPlainObject(member)) {
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(member)) {
      if (typeof value !== 'string') return undefined;
      fields[key] = value;
    }
    return fields;
  }
  return undefined;
}

/** Any WSLg/PulseServer wiring still present in the file's VALUES (comments excluded — that is the point). */
function hasLiveVoiceWiring(text: string): boolean {
  const parsed = tryParse(text);
  return parsed ? mentionsVoiceWiring(JSON.stringify(parsed)) : true;
}

function mentionsVoiceWiring(source: string): boolean {
  return /mnt\/wslg|PULSE_SERVER/i.test(source);
}

/**
 * Delete the comment BLOCKS that talk about the WSLg bridge.
 *
 * Blocks, not lines, and that distinction is the whole of it. The house prose is a paragraph — four lines
 * about why the mount is opt-in and what to swap the source to on Docker Desktop — of which exactly one
 * happens to contain the word "WSLg". Matching line by line deletes that one and leaves the rest of the
 * sentence stranded above whichever member now follows, which is worse than leaving the paragraph whole:
 * it reads as a comment about the wrong mount. So a match on ANY line claims its entire contiguous run of
 * standalone comment lines. A run is one unit of prose; if part of it describes something that is gone,
 * all of it does.
 *
 * Only whole-line comments: a trailing comment after a value belongs to that value, and this pass must
 * never change what the file MEANS. Called solely when no live wiring remains, so every block it can match
 * is prose about something that is no longer there.
 */
function stripVoiceComments(text: string): { text: string; removed: number } {
  const lines = text.split('\n');
  const isComment = (line: string) => line.trim().startsWith('//');
  const mentions = (line: string) => /wslg|pulseserver|pulseaudio/i.test(line);

  const doomed = new Set<number>();
  lines.forEach((line, index) => {
    if (!isComment(line) || !mentions(line)) return;
    // Claim the whole run this line belongs to, in both directions.
    for (let i = index; i >= 0 && isComment(lines[i]); i--) doomed.add(i);
    for (let i = index; i < lines.length && isComment(lines[i]); i++) doomed.add(i);
  });

  if (doomed.size === 0) return { text, removed: 0 };

  return { text: lines.filter((_, index) => !doomed.has(index)).join('\n'), removed: doomed.size };
}

/** "2 mount(s) targeting /mnt/wslg and a PULSE_SERVER entry" — for the report, never for a decision. */
function describe(mounts: number, what: string, pulse: boolean): string {
  const parts: string[] = [];
  if (mounts > 0) parts.push(`${mounts} ${what}`);
  if (pulse) parts.push(`a \`remoteEnv.${PULSE_KEY}\` entry`);
  return parts.join(' and ');
}

const JSONC_FORMAT = { tabSize: 2, insertSpaces: true, eol: '\n' };

/** JSONC -> plain object, or `undefined` for anything that isn't a parseable object. */
function tryParse(source: string): Json | undefined {
  try {
    const parsed: unknown = parseJson(source);
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
