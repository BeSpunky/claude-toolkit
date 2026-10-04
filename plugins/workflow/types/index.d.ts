// bespunky-workflow — the standing pane's state contract.
//
// The /standing pane (hooks/standing.tsx) is a VIEW over the project-standing engine
// (skills/project-standing/scripts/standing.mjs --json). The engine is the single source of
// truth for what a feature package is and which state it is in; the pane only folds one run of
// it into ONE session value and draws that. Declared here, in the plugin's contract, because
// `$.state` values are typed by the owner's `PluginState` entry and anyone may read them.

/** A feature package's closing status, from its DECISION.md (`in-flight` when it has none). */
export type StandingStatus = 'in-flight' | 'concluded' | 'abandoned' | 'superseded'

/**
 * Which group a package is drawn in: `live` (in flight and touched within the stale window, or
 * checked out in a worktree), `dormant` (in flight, untouched past it), `concluded` (closed).
 */
export type StandingState = 'live' | 'dormant' | 'concluded'

/** One feature package, as the engine derived it. Names are validated at the source. */
export type StandingPackage = {
  /** The package folder under docs/features/: `<YYYY-MM-DD>-<slug>`. */
  dir: string
  date: string
  slug: string
  status: StandingStatus
  state: StandingState
  /** Newest activity in the package (commit or uncommitted edit), seconds since the epoch. */
  lastActivity: number
  /** A worktree has a branch named for this slug checked out. */
  hasWorktree: boolean
  /**
   * Where the newest copy was found, when not in the session's checkout: that worktree's project
   * dir, relative to the session's when inside it, else absolute. Charset-validated at the source.
   */
  worktree?: string
  /** The newest baton, relative to the package: `handoffs/<name>`. */
  baton?: string
  /**
   * What the package is about, in one plain line (DECISION.md's summary, else BRIEF.md's summary or
   * first sentence); null when neither says. Free text: for display only, never a prompt.
   */
  about: string | null
  /** DECISION.md frontmatter of a closed package. Free text: for display only, never a prompt. */
  summary?: string
  concluded?: string
  tags?: string[]
  /** When a closed package closed (its `concluded:` date, else when DECISION.md last moved), seconds since the epoch. */
  closedAt?: number
}

/** What `standing.mjs --json` prints. `repo` is null outside a git repository. */
export type Standing = {
  version: 1
  staleDays: number
  /** When it was derived, seconds since the epoch. */
  now: number
  repo: { lastCommit: number; commitAgeDays: number; hasFeatures: boolean; hasRecentDoc: boolean } | null
  packages: StandingPackage[]
}

/**
 * What the pane shows.
 *
 * - `empty`  nothing to show (no engine, not a repo, no docs/features/); `why` says which.
 * - `ready`  one run of the engine.
 */
export type StandingView = { phase: 'empty'; why: string } | { phase: 'ready'; standing: Standing }

/** One move the merge gate offers: a button that queues `prompt` as the person's own. */
export type MergeGateMove = {
  /** Stable per move, for the button's key: `land`, `land-promote`, `push`, `promote`. */
  id: 'land' | 'land-promote' | 'push' | 'promote'
  label: string
  hotkey: string
  /** Built only from names the engine and git vouched for; never from Claude's free text. */
  prompt: string
}

/**
 * The merge gate (hooks/merge-gate.tsx): what Claude proposed, folded with the engine's and git's facts into
 * the moves the person can press. `null` when no proposal is standing.
 */
export type MergeGate = {
  /** What the moves act on: `feat/x → development · 3 commits`. */
  headline: string
  /** Claude's one line on what is ready. Free text: drawn, never a prompt. */
  note: string
  /** First is the main action. */
  moves: MergeGateMove[]
}

declare module 'claude-code' {
  interface PluginState {
    'bespunky-workflow': {
      standing: StandingView
      /** The pane lists the most recent concluded packages instead of one summary line. */
      showConcluded: boolean
      /** The standing proposal to land or promote, until the person answers it. */
      mergeGate: MergeGate | null
    }
  }
}
