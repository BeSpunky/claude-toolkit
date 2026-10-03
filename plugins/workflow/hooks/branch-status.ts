// bespunky-workflow — the BRANCH-MODEL STATUS LINE: where this checkout sits in the declared branch model,
// pinned under the prompt. `feat/x → development → main` on a work branch; a warning on a protected line,
// where committing breaks the house rules; an honest word when no model is declared or it cannot be read.
//
// WHY IT IS A VIEW OVER THE ENGINE. `branches.mjs` is the ONE interpreter of `.bespunky/branches.json`
// (which copy is in force, the undeclared fallbacks, the effective protected set). This module never reads
// the file: it runs `branches.mjs status --json` (its frozen `statusShape`) and, for the violations count,
// `branches.mjs verify --json`, and only folds their answers — plus the current branch from git — into one
// line. The fold is `statusLine`, pure; everything else here is plumbing.
//
// DETECT, DON'T EXECUTE. It displays; it never moves a branch, writes the declaration, or runs a mutating
// command. Both engine commands are read-only by construction (lib/git.mjs).
//
// THE PLUGIN WORKS WITHOUT IT. The skill and the PreCompact hook consult the engine themselves; with mods off
// nothing is missed but the line. Never put behaviour here that the floor needs.
//
// WHEN IT REFRESHES. Cheapest first:
//   - the person's prompt: the branch only (one `git symbolic-ref`), and the model again if the branch moved —
//     this is what catches a checkout made in another terminal;
//   - session start, and after a Bash call that can have touched git (`git`/`gh`) or a worktree move: the
//     branch, the model, and the violations count (verify is the one costly read, so it runs only here).

import type { EngineInterface, Register } from 'claude-code'

import { brandStatus } from './_brand.tsx'

/** What `branches.mjs status --json` said, already checked against its contract — or that it said nothing. */
export type Model =
  | { state: 'declared'; summary: string; protected: string[]; protectedPatterns: string[] }
  | { state: 'undeclared'; protected: string[]; protectedPatterns: string[] }
  | { state: 'unreadable'; reason: string; protected: string[]; protectedPatterns: string[] }
  /** Not a git repo, no node, a crash: nothing honest to show. */
  | { state: 'absent' }

/** HEAD: a branch name, `detached`, or no repository at all. */
export type Head = { kind: 'branch'; name: string } | { kind: 'detached' } | { kind: 'none' }

/** The whole policy: what the line says, from the facts. `undefined` clears it. */
export function statusLine(head: Head, model: Model, violations?: number): string | undefined {
  if (head.kind === 'none' || model.state === 'absent') {
    return undefined
  }
  if (model.state === 'unreadable') {
    return `⚠ branch model unreadable: ${model.reason}`
  }

  const branch = head.kind === 'branch' ? head.name : undefined
  const onProtected = branch !== undefined && isProtected(branch, model)

  if (model.state === 'undeclared') {
    return onProtected ? `⚠ on protected ${branch} · branch model undeclared` : `${branch ?? 'detached HEAD'} · branch model undeclared`
  }

  const where = onProtected
    ? `⚠ on protected ${branch}, don't commit here · ${model.summary}`
    : `${branch ?? 'detached HEAD'} → ${model.summary}`
  const broken = violations ? ` · ⚠ ${violations} violation${violations === 1 ? '' : 's'}` : ''

  return `${where}${broken}`
}

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
  const isList = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string' && x !== '')

  if (!j || !isList(j.protected) || !isList(j.protectedPatterns)) {
    return { state: 'absent' }
  }
  const sets = { protected: j.protected, protectedPatterns: j.protectedPatterns }
  const projection = j.projection as { summary?: unknown } | null | undefined

  switch (j.state) {
    case 'declared':
      return typeof projection?.summary === 'string' ? { state: 'declared', summary: projection.summary, ...sets } : { state: 'absent' }
    case 'undeclared':
      return { state: 'undeclared', ...sets }
    case 'unreadable':
      return { state: 'unreadable', reason: oneLine(String(j.reason || 'cannot be read')), ...sets }
    default:
      return { state: 'absent' }
  }
}

/** `verify --json`'s `violations`, or nothing when it did not answer in shape. */
export function parseViolations(stdout: string): number | undefined {
  try {
    const n = (JSON.parse(stdout) as { violations?: unknown }).violations

    return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : undefined
  } catch {
    return undefined
  }
}

/** A Bash command that can have moved HEAD or the model in force. */
const TOUCHES_GIT = /(^|[^\w-])(git|gh)(\s|$)/
/** The worktree tools. Module-private on purpose: `claude plugin validate` reads a matcher only from a const nothing else references. */
const WORKTREE_MOVE = /^(EnterWorktree|ExitWorktree)$/

export const register: Register = on => {
  const line = keeper()

  on('session.start', async ($, e, next) => {
    // Not awaited: the first session.start holds turn one, and verify is the costly read.
    void refresh($, line, 'full')

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    void refresh($, line, 'branch')

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (TOUCHES_GIT.test(e.command)) {
      void refresh($, line, 'full')
    }

    return ran
  })

  on('tool.call', { tool: WORKTREE_MOVE }, async ($, e, next) => {
    const ran = await next(e)
    void refresh($, line, 'full')

    return ran
  })
}

type Depth = 'branch' | 'full'

/**
 * The facts last read and the line last shown. A refresh asked while one runs is folded into one more run
 * afterwards at the deeper of the two depths, so a burst of git calls costs at most two reads.
 */
type Keeper = {
  head: Head
  model: Model
  violations?: number
  shown?: string
  running?: Promise<void>
  queued?: Depth
}

function keeper(): Keeper {
  return { head: { kind: 'none' }, model: { state: 'absent' } }
}

async function refresh($: EngineInterface, k: Keeper, depth: Depth): Promise<void> {
  if (k.running) {
    k.queued = k.queued === 'full' || depth === 'full' ? 'full' : 'branch'

    return k.running
  }
  k.running = (async () => {
    try {
      let todo: Depth | undefined = depth
      while (todo) {
        k.queued = undefined
        await readInto($, k, todo).catch(error => $.ui.log(`bespunky-workflow: branch status failed: ${error}`, { to: 'debug' }))
        todo = k.queued
      }
    } finally {
      k.running = undefined
    }
  })()

  return k.running
}

/** One read at `depth`, then the line re-pinned if it changed. */
async function readInto($: EngineInterface, k: Keeper, depth: Depth) {
  const before = k.head
  k.head = await readHead($)
  const moved = JSON.stringify(k.head) !== JSON.stringify(before)

  if (k.head.kind === 'none') {
    k.model = { state: 'absent' }
    k.violations = undefined
  } else if (depth === 'full' || moved || k.model.state === 'absent') {
    k.model = await readModel($)
    if (depth === 'full') {
      k.violations = k.model.state === 'declared' ? await readViolations($) : undefined
    }
  }

  const line = statusLine(k.head, k.model, k.violations)
  if (line !== k.shown) {
    k.shown = line
    // The toolkit's mark goes on at the boundary: the fold says what, the brand says whose.
    $.ui.status(line === undefined ? undefined : brandStatus(line))
  }
}

async function readHead($: EngineInterface): Promise<Head> {
  const ran = await run($, ['git', 'symbolic-ref', '--short', '-q', 'HEAD'])
  if (ran?.exitCode === 0 && ran.stdout.trim()) {
    return { kind: 'branch', name: ran.stdout.trim() }
  }
  // symbolic-ref says 1 for a detached HEAD and 128 outside a repository; tell them apart by asking for HEAD.
  const inside = await run($, ['git', 'rev-parse', '--verify', '-q', 'HEAD'])

  return inside?.exitCode === 0 ? { kind: 'detached' } : { kind: 'none' }
}

async function readModel($: EngineInterface): Promise<Model> {
  const ran = await run($, ['node', engine($), 'status', '--json'])

  return ran ? parseStatus(ran.stdout) : { state: 'absent' }
}

async function readViolations($: EngineInterface) {
  const ran = await run($, ['node', engine($), 'verify', '--json'], 60_000)

  return ran ? parseViolations(ran.stdout) : undefined
}

/** The branch-model engine, shipped beside this module in the same plugin. */
function engine($: EngineInterface) {
  return `${$.plugin.root}/skills/branch-and-release/scripts/branches.mjs`
}

/** A host command, or nothing when it could not start (no git, no node) or overran. */
async function run($: EngineInterface, argv: string[], timeoutMs = 15_000) {
  try {
    return await $.process.run(argv, { timeoutMs })
  } catch {
    return undefined
  }
}

function oneLine(text: string) {
  return text.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '')
}
