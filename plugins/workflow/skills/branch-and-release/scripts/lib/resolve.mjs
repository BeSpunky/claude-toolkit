// Which copy of the declaration is THE model — CONTRACT Amendment 1, the one resolution algorithm shared with
// `assets/house-branches.sh` (its reference implementation) and `checkpoint-on-compact.sh`. Keep them agreeing.
//
// The file is committed, so every branch carries its own copy — stale on an old feature branch, missing on one
// cut before the model was declared. The copy on the INTEGRATION LINE'S TIP is the model in force:
//   1. a readable working-tree copy names the integration line (`projection.integration`, `projection.remote`):
//      - that branch (local, else <remote>/<it>) holds a copy → that copy is the model (note when it differs);
//      - the branch holds no copy → the declaration has not landed → UNDECLARED, with a note;
//      - the branch exists nowhere (bootstrap, a clone without it) → the working-tree copy, with a note.
//   2. no readable working-tree copy → self-confirming search over the §3 names: a copy at that branch (local,
//      then origin/) counts only if its own projection.integration names that same branch.
//   3. nothing found → undeclared (a working-tree copy with no projection is still surfaced, so validation can
//      say what is wrong with it rather than the repo looking undeclared).
import fs from 'node:fs';
import path from 'node:path';
import { FILE, canonical, UNDECLARED_PROTECTED } from './model.mjs';

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
const integrationOf = (m) => (m && typeof m.projection?.integration === 'string' ? m.projection.integration : null);

/**
 * @returns {{ declared: false, warnings: string[] } |
 *           { declared: true, model: object, source: string, warnings: string[] }}
 */
export function resolveModel(git, top) {
  const warnings = [];
  const localPath = path.join(top, FILE);
  const localText = fs.existsSync(localPath) ? fs.readFileSync(localPath, 'utf8') : null;
  const local = localText === null ? undefined : parse(localText);
  const copyAt = (ref) => {
    const text = git.try(['show', `${ref}:${FILE}`]);
    return text === null ? null : { text, model: parse(text) };
  };

  const integ = integrationOf(local);
  if (integ) {
    const remote = typeof local.projection.remote === 'string' ? local.projection.remote : 'origin';
    const ref = git.ref(integ, remote);
    if (ref) {
      const tip = copyAt(ref);
      if (!tip) {
        warnings.push(`this tree carries ${FILE} naming "${integ}" as its integration line, but "${integ}" does not — a declaration is not in force until it lands there`);
        return { declared: false, warnings };
      }
      if (tip.model === undefined) throw new Error(`${ref}:${FILE}: not valid JSON`);
      if (canonical(tip.model) !== canonical(local)) warnings.push(`this tree's copy of ${FILE} differs from the one on "${integ}" — the integration line's copy is the model in force`);
      return { declared: true, model: tip.model, source: `${ref}:${FILE}`, warnings };
    }
    warnings.push(`the integration line "${integ}" could not be resolved (no local or ${remote} branch), so this tree's copy of ${FILE} was read`);
    return { declared: true, model: local, source: FILE, warnings };
  }

  for (const name of UNDECLARED_PROTECTED) {
    const ref = git.ref(name, 'origin');
    const tip = ref && copyAt(ref);
    if (tip && integrationOf(tip.model) === name) {
      warnings.push(`no readable ${FILE} in this tree (it predates the declaration) — read the one on ${ref}`);
      return { declared: true, model: tip.model, source: `${ref}:${FILE}`, warnings };
    }
  }

  if (localText !== null) {
    if (local === undefined) throw new Error(`${FILE}: not valid JSON`);
    warnings.push(`this tree's ${FILE} has no projection (it was not written by \`branches.mjs write\`) — read as-is`);
    return { declared: true, model: local, source: FILE, warnings };
  }
  return { declared: false, warnings };
}
