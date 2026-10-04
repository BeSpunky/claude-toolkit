// bespunky-workflow — THE MODS' VIEW OF THE BRANCH-MODEL ENGINE. `branches.mjs` is the ONE interpreter of
// `.bespunky/branches.json`; every mod that needs the model (the status line, the merge gate) reads it through
// here: each runs the engine itself, and this checks the answer against the frozen `statusShape` contract and
// folds it into `Model`. No mod reads the declaration itself, and none re-derives what the engine decides.
//
// Pure on purpose: a mod may not hand `$` across an import, so the running stays in each mod and only the
// reading lives here. Read-only by construction: `status --json` and `plan` never move a branch (lib/git.mjs).

/** What `branches.mjs status --json` said, already checked against its contract — or that it said nothing. */
export type Model =
  | {
      state: 'declared'
      summary: string
      /** The line work lands on. */
      integration: string
      /** Integration first, then each stage in promotion order. */
      chain: string[]
      remote: string
      protected: string[]
      protectedPatterns: string[]
    }
  | { state: 'undeclared'; protected: string[]; protectedPatterns: string[] }
  | { state: 'unreadable'; reason: string; protected: string[]; protectedPatterns: string[] }
  /** Not a git repo, no node, a crash: nothing honest to show. */
  | { state: 'absent' }

/**
 * Whether `branch` is a protected line: a name in the set, or a match for one of its globs. The globs are
 * the engine's published form (`toGlob`: each `{x}` → `*`), matched as the PreCompact hook matches them — a
 * shell `case`, where `*` spans any characters, `/` included.
 */
export function isProtected(branch: string, model: { protected: string[]; protectedPatterns: string[] }) {
  return model.protected.includes(branch) || model.protectedPatterns.some(glob => globToRegExp(glob).test(branch))
}

function globToRegExp(glob: string) {
  const source = [...glob]
    .map(ch => (ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('')

  return new RegExp(`^${source}$`)
}

/**
 * `status --json` parsed against its contract (`statusShape`). The exit code is not trusted on its own — a
 * crash exits non-zero too — so the SHAPE decides, exactly as the PreCompact hook decides.
 */
export function parseStatus(stdout: string): Model {
  let json: unknown
  try {
    json = JSON.parse(stdout)
  } catch {
    return { state: 'absent' }
  }
  const j = json as Record<string, unknown> | null

  if (!j || !isList(j.protected) || !isList(j.protectedPatterns)) {
    return { state: 'absent' }
  }
  const sets = { protected: j.protected, protectedPatterns: j.protectedPatterns }

  switch (j.state) {
    case 'declared':
      return declared(j.projection, sets)
    case 'undeclared':
      return { state: 'undeclared', ...sets }
    case 'unreadable':
      return { state: 'unreadable', reason: oneLine(String(j.reason || 'cannot be read')), ...sets }
    default:
      return { state: 'absent' }
  }
}

function declared(projection: unknown, sets: { protected: string[]; protectedPatterns: string[] }): Model {
  const p = projection as Record<string, unknown> | null | undefined
  const shaped =
    typeof p?.summary === 'string' &&
    typeof p.integration === 'string' &&
    typeof p.remote === 'string' &&
    isList(p.chain) &&
    p.chain[0] === p.integration

  return shaped
    ? { state: 'declared', summary: p.summary as string, integration: p.integration as string, chain: p.chain as string[], remote: p.remote as string, ...sets }
    : { state: 'absent' }
}

function isList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string' && x !== '')
}

/** The branch-model engine, shipped beside the mods in the same plugin (`$.plugin.root`). */
export function enginePath(pluginRoot: string) {
  return `${pluginRoot}/skills/branch-and-release/scripts/branches.mjs`
}

export function oneLine(text: string) {
  return text.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '')
}
