// bespunky-browser-automation — the SHARED-BROWSER STATUS ENTRY: while the
// shared browser is up, one status line under the prompt carries its noVNC URL,
// so the human can open the live view without asking Claude for it.
//
// WHY IT ONLY ASKS THE SCRIPT. The shared browser is a stack of daemons the
// project's own `tools/shared-browser/shared-browser` starts, and that script is
// the ONE source of truth for its URL (the noVNC port is allocated out of a band
// shared by every container on the host, so a composed URL is a wrong URL). The
// entry therefore never derives anything: it polls `status --json` — read-only —
// and draws what it says. `url` is null until the port is a real allocation, and
// a null URL draws nothing, never a guess.
//
// DETECT, DON'T EXECUTE. It never starts, stops or repairs the browser; a
// project without the script, a script that fails, or a browser that is down
// all mean the same thing here: no entry. It degrades to silence.

import type { EngineInterface, Register } from 'claude-code'

import { brandLine } from './_brand.tsx'

/** Modest: the browser comes and goes on `up`/`down`, not every second. */
const POLL_MS = 10_000
const STATUS_TIMEOUT_MS = 8_000
/** Where the web layer's generator puts the CLI, relative to the workspace root. */
const SCRIPT = 'tools/shared-browser/shared-browser'

/** The fields of `shared-browser status --json` this entry reads. */
export type BrowserStatus = {
  up?: boolean
  url?: string | null
  /** `"true"` = the host port was proven to reach this browser; `"false"` = something else answers there. */
  hostVerified?: 'true' | 'false' | 'unknown' | boolean
}

/**
 * The status line for one `status --json` answer, or undefined for none: the
 * whole policy, pure, so the poller is only plumbing.
 */
export function entryFor(status: BrowserStatus | undefined): string | undefined {
  if (!status?.up || typeof status.url !== 'string' || status.url === '') {
    return undefined
  }
  const isUnverified = status.hostVerified === 'false' || status.hostVerified === false

  return isUnverified
    ? `⚠ shared browser: ${status.url} (host forward not confirmed)`
    : `shared browser: ${status.url}`
}

/** Parses the script's stdout; anything that isn't a status object is none. */
export function parseStatus(stdout: string): BrowserStatus | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout)

    return parsed !== null && typeof parsed === 'object' ? (parsed as BrowserStatus) : undefined
  } catch {
    return undefined
  }
}

export const register: Register = on => {
  let poller: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    poller?.cancel()
    poller = startPolling($)

    return next(e)
  })
}

/** Polls the script into `$.ui.status`, writing only on a change. */
function startPolling($: EngineInterface) {
  let shown: string | undefined
  let isPolling = false

  const tick = async () => {
    if (isPolling) {
      return
    }
    isPolling = true
    try {
      const next = entryFor(await readStatus($))
      if (next !== shown) {
        shown = next
        // The toolkit's mark goes on at the boundary: the policy says what, the brand says whose.
        $.ui.status(next === undefined ? undefined : brandLine(next))
      }
    } finally {
      isPolling = false
    }
  }

  void tick()

  return $.clock.every(POLL_MS, () => void tick())
}

/** `shared-browser status --json`, or undefined whenever it can't answer. */
async function readStatus($: EngineInterface): Promise<BrowserStatus | undefined> {
  const script = await findScript($)
  if (script === undefined) {
    return undefined
  }
  try {
    const ran = await $.process.run(['bash', script, 'status', '--json'], { timeoutMs: STATUS_TIMEOUT_MS })

    return ran.exitCode === 0 ? parseStatus(ran.stdout) : undefined
  } catch {
    return undefined
  }
}

/**
 * The CLI in the nearest workspace at or above the session's project root (a
 * session may run in a project's subdirectory), or undefined when none has it.
 */
async function findScript($: EngineInterface): Promise<string | undefined> {
  let dir = (await $.session.root()).replace(/\/+$/, '') || '/'

  for (;;) {
    const candidate = `${dir === '/' ? '' : dir}/${SCRIPT}`
    const found = await $.fs.stat(candidate).catch(() => undefined)
    if (found?.kind === 'file') {
      return candidate
    }
    if (dir === '/') {
      return undefined
    }
    dir = dir.slice(0, dir.lastIndexOf('/')) || '/'
  }
}
