// bespunky-project-starter — the house band's state contract.
//
// The band (hooks/band.tsx) is a VIEW over `check-house-version.sh --json`: the
// SessionStart hook's own detection, recorded as notices instead of relayed as
// text. Its poller writes this ONE session value and the drawing reads only it.
// Declared here because `$.state` values are typed by the owner's `PluginState`
// entry, and anyone may read them.

/**
 * What a notice asks of a human — the script decides, the band only maps it to
 * a button:
 * - `sync`           a sync is the fix (`/sync`, the bespunky-project-starter:sync skill).
 * - `update-toolkit` this machine's toolkit is behind; a sync here would be wrong or refuse.
 * - `fix-mounts`     the container's post-create failed on an unwritable mount point.
 */
export type HouseAction = 'sync' | 'update-toolkit' | 'fix-mounts'

/** One notice, as `check-house-version.sh --json` prints it. */
export type HouseNotice = {
  /** Which check fired (`toolkit-moved`, `layer-drift`, `dependency-ahead`, `machine-behind`, `post-create-failed`). */
  kind: string
  action: HouseAction
  /** One line, for a person. */
  summary: string
}

/**
 * The band's whole state for the session.
 *
 * - `projectDir` the directory the check ran against (the session's start cwd).
 * - `notices`    what the check said last; empty draws nothing.
 * - `dismissed`  the person closed the band; it stays closed for the session.
 */
export type HouseBand = {
  projectDir: string
  notices: readonly HouseNotice[]
  dismissed: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'bespunky-project-starter': { band: HouseBand }
  }
}
