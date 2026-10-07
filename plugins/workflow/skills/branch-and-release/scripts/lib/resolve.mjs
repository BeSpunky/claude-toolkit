// Which copy of the declaration is THE model — CONTRACT Amendment 2, the resolution rule shared with
// `assets/house-branches.sh` (the only other resolver; both test suites run the same scenarios). Keep them agreeing.
//
// The file is committed, so every branch carries its own copy — stale on an old feature branch, missing on one
// cut before the model was declared. The copy on the INTEGRATION LINE is the model in force:
//   1. a working-tree copy that is unparseable, has no projection, or a projection.schema major other than 1 →
//      UNREADABLE: refuse to act; protect the §3 list.
//   2. a readable working-tree copy names integration I and remote R. Both refs/heads/I and refs/remotes/R/I
//      are considered; those that exist AND hold the file are candidates:
//      - neither ref exists (bootstrap, a clone without it) → the working-tree copy, with a note;
//      - refs exist, none holds the file → NOT LANDED: undeclared, but protected = §3 ∪ the copy's own protections;
//      - one holds it → that copy; both → identical → it; else the descendant's; diverged → the local one, noted.
//   3. no working-tree copy → self-confirming search over the §3 names, local AND origin/<name>: a copy counts
//      only if its own projection.integration names that same branch.
//   4. nothing found → undeclared.
// A chosen copy must itself be readable AND valid; one that is not is UNREADABLE (never guessed around). The one
// exception is a copy whose only problems are OUTDATED (model.mjs `check`: a format with one exact rewrite that
// leaves the projection unchanged — a bare-string `deploys`): it is the declared model it always was, and each
// problem goes into `notes`, remedy included, so every reader of `status` sees what to do. That remedy depends on
// WHERE the fix stands (model.mjs `outdatedRemedy`): when the working tree's own copy holds exactly the rewrite at
// every outdated path of the integration line's copy and otherwise checks clean (`carriesRewrite`), this branch
// carries the fix and it resolves on landing — telling such a branch to "run the upgrade" again would be wrong. Any
// other copy (one predating the notes, rewording or extending them, or with errors of its own) gets the rewrite
// guidance. The resolution rides in `outdated`.
import fs from 'node:fs';
import path from 'node:path';
import { FILE, canonical, UNDECLARED_PROTECTED, isSchemaMajor1, check, outdatedMessage, outdatedRemedy } from './model.mjs';

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Why a copy cannot be read as a model, or null when it can. */
function unreadableWhy(model, where) {
  if (model === undefined) return `${where}: not valid JSON`;
  if (model === null || typeof model !== 'object' || Array.isArray(model)) return `${where}: not a JSON object`;
  const p = model.projection;
  if (!p || typeof p !== 'object') return `${where}: no projection (it was not written by \`branches.mjs write\`)`;
  if (!isSchemaMajor1(p.schema)) return `${where}: projection.schema ${JSON.stringify(p.schema)} is a major this engine does not know (only 1)`;
  if (typeof p.integration !== 'string' || !p.integration) return `${where}: projection.integration is missing`;
  return null;
}

const uniq = (xs) => [...new Set(xs)];

/** The value at a problem's `field` path (`stages[0].deploys`, `releases.deploys`) in a declaration. */
const at = (model, field) => field.match(/[^.[\]]+/g).reduce((v, k) => (v !== null && typeof v === 'object' ? v[k] : undefined), model);

/**
 * True when `copy` already IS the fix for the in-force `model`'s `outdated` problems: at every outdated path it holds
 * exactly that path's rewrite — `{ "note": <the same string> }`, nothing more — and it otherwise checks clean. Only
 * then does landing it resolve them; a copy that predates the notes, drops them, rewords them, binds more, or carries
 * errors of its own does not, and gets the rewrite guidance like any other.
 */
function carriesRewrite(copy, model, outdated) {
  if (!outdated.length) return false;
  const own = check(copy);
  if (own.errors.length || own.outdated.length) return false;
  return outdated.every((o) => canonical(at(copy, o.field)) === canonical({ note: at(model, o.field) }));
}

/**
 * @returns {{ state: 'declared'|'undeclared'|'unreadable', declared: boolean, model: object|null,
 *             source: string|null, projection: object|null, protected: string[], protectedPatterns: string[],
 *             notes: string[], reason: string|null,
 *             outdated: null|{ resolution: 'rewrite'|'lands', line: string|null, problems: object[] } }}
 * `protected` / `protectedPatterns` are always the EFFECTIVE set for the state. `outdated` is set only on a declared
 * copy in an outdated format: its problems and where their fix stands (model.mjs `outdatedRemedy`).
 */
export function resolveModel(git, top) {
  const notes = [];
  const existing = (remotes) => {
    const names = new Set(remotes.flatMap((r) => git.branchNames(r)));
    return UNDECLARED_PROTECTED.filter((n) => names.has(n));
  };
  const exists = (ref) => git.ok(['show-ref', '--verify', '--quiet', ref]);
  const copyAt = (ref) => {
    const text = git.try(['show', `${ref}:${FILE}`]);
    return text === null ? null : { ref, model: parse(text), sha: git.sha(ref) };
  };

  /** `here`: `{ line, copy }` — the working tree's copy, which lands on `line` — when the model is read from that line. */
  const declared = (model, source, here = null) => {
    const why = unreadableWhy(model, source);
    if (why) return unreadable(why, source);
    const { errors, outdated } = check(model);
    if (errors.length) return unreadable(`${source}: ${errors.length} validation error(s): ${[...errors, ...outdated.map((o) => outdatedMessage(o))].join('; ')}`, source, model.projection);
    const remedy = here && carriesRewrite(here.copy, model, outdated) ? outdatedRemedy.lands(here.line) : outdatedRemedy.rewrite();
    for (const o of outdated) notes.push(`${source}: ${outdatedMessage(o, remedy)}`);
    const p = model.projection;
    return {
      state: 'declared', declared: true, model, source, projection: p, protected: [...(p.protected ?? [])], protectedPatterns: [...(p.protectedPatterns ?? [])], notes, reason: null,
      outdated: outdated.length ? { ...remedy, problems: outdated } : null,
    };
  };
  // Unreadable protects the whole §3 list — plus, when the copy's projection is itself readable, its own list
  // (never fewer protections than a copy declares).
  const unreadable = (reason, source, projection) => ({
    state: 'unreadable', declared: false, model: null, source: source ?? null, projection: null,
    protected: uniq([...UNDECLARED_PROTECTED, ...(Array.isArray(projection?.protected) ? projection.protected : [])]),
    protectedPatterns: uniq(Array.isArray(projection?.protectedPatterns) ? projection.protectedPatterns : []),
    notes, reason, outdated: null,
  });
  const undeclared = (reason, { remotes = ['origin'], extra = null } = {}) => ({
    state: 'undeclared', declared: false, model: null, source: null, projection: null,
    protected: uniq([...existing(remotes), ...(extra?.protected ?? [])]),
    protectedPatterns: uniq(extra?.protectedPatterns ?? []),
    notes, reason, outdated: null,
  });

  /** Among copies of the SAME line (local and remote-tracking), the one in force. */
  const pick = (copies, line) => {
    if (copies.length === 1) return copies[0];
    const [a, b] = copies; // a = local, b = remote-tracking
    if (canonical(a.model) === canonical(b.model)) return a;
    if (git.isAncestor(a.sha, b.sha)) return b;
    if (git.isAncestor(b.sha, a.sha)) return a;
    notes.push(`${a.ref} and ${b.ref} have diverged and carry different copies of ${FILE} — read the local one; reconcile "${line}" with its remote`);
    return a;
  };

  const localPath = path.join(top, FILE);
  if (fs.existsSync(localPath)) {
    const local = parse(fs.readFileSync(localPath, 'utf8'));
    const why = unreadableWhy(local, `working-tree ${FILE}`);
    if (why) return unreadable(why, 'working-tree');

    const I = local.projection.integration;
    const R = typeof local.projection.remote === 'string' && local.projection.remote ? local.projection.remote : 'origin';
    const refs = [`refs/heads/${I}`, `refs/remotes/${R}/${I}`].filter(exists);
    if (!refs.length) {
      notes.push(`the integration line "${I}" could not be resolved (no local or ${R} branch), so this tree's copy of ${FILE} was read`);
      return declared(local, 'working-tree');
    }
    const copies = refs.map(copyAt).filter(Boolean);
    if (!copies.length) {
      notes.push(`this tree carries ${FILE} naming "${I}" as its integration line, but "${I}" does not — a declaration is not in force until it lands there`);
      return undeclared(`not landed: ${refs.join(' and ')} ${refs.length > 1 ? 'hold' : 'holds'} no ${FILE}`, { remotes: uniq(['origin', R]), extra: local.projection });
    }
    const chosen = pick(copies, I);
    if (chosen.model !== undefined && canonical(chosen.model) !== canonical(local)) notes.push(`this tree's copy of ${FILE} differs from the one on "${I}" — the integration line's copy is the model in force`);
    return declared(chosen.model, chosen.ref, { line: I, copy: local });
  }

  for (const name of UNDECLARED_PROTECTED) {
    const copies = [`refs/heads/${name}`, `refs/remotes/origin/${name}`]
      .filter(exists)
      .map(copyAt)
      .filter((c) => c && c.model?.projection?.integration === name);
    if (!copies.length) continue;
    const chosen = pick(copies, name);
    notes.push(`no ${FILE} in this tree (it predates the declaration) — read the one on ${chosen.ref}`);
    return declared(chosen.model, chosen.ref);
  }
  return undeclared(`no ${FILE} on the integration line`);
}
