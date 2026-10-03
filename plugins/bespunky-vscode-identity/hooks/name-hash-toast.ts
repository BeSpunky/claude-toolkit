// bespunky-vscode-identity — the NAME-HASH TOAST: tells the person, once per
// project, that the window colour is still the scaffold-time placeholder while a
// design system now exists to derive a real one from.
//
// WHY IT ASKS THE SCRIPT. Whether there is anything to say — an identity marker,
// a `name-hash` source, a design system, no recorded decline — is decided by
// `check-window-identity.sh`'s gates alone. `--json` prints which gate decided;
// this mod toasts only on `upgradable`. It re-implements none of them.
//
// ONCE PER PROJECT. A toast cannot report being dismissed, so being SHOWN is the
// dismissal: `$.store` (the person's own, across sessions) remembers each project
// it was shown for, and a later session there stays quiet. That is this person's
// memory, beside the project's own decline snooze, which the script honours.
//
// DETECT, DON'T EXECUTE. It shows a fact; the upgrade stays the window-identity
// skill's, on consent. THE PLUGIN WORKS WITHOUT IT: the SessionStart command
// hook relays the same fact to the model.

import type { EngineInterface, Register } from 'claude-code'

import { brandLine } from './_brand.tsx'

/** What `check-window-identity.sh --json` names: the gate that decided. */
export type IdentityState = 'unapplied' | 'resolved' | 'no-design-system' | 'declined' | 'upgradable'

const STATES: readonly IdentityState[] = ['unapplied', 'resolved', 'no-design-system', 'declined', 'upgradable']
const TOAST_MS = 12_000

export const TOAST_TEXT =
  "Window colour is still the name-hash placeholder, but this project now has a design system. " +
  'Ask Claude to "upgrade the window identity" to derive it from the brand primary.'

/** The state in `--json`'s output, or undefined for anything else. */
export function parseState(stdout: string): IdentityState | undefined {
  try {
    const { state } = JSON.parse(stdout.trim()) as { state?: unknown }

    return STATES.find(known => known === state)
  } catch {
    return undefined
  }
}

/** The toast for this session, if any: the whole policy, pure. */
export function identityToast(state: IdentityState | undefined, wasShown: boolean) {
  return state === 'upgradable' && !wasShown ? TOAST_TEXT : undefined
}

/** The `$.store` key remembering that the toast was shown for `project`. */
export const shownKey = (project: string) => `name-hash-toast-shown:${project}`

export const register: Register = on => {
  on('session.start', ($, e, next) => {
    // Off the startup path (the script greps the workspace), and only where a person can see it:
    // a toast nobody saw must not be remembered as shown.
    if (e.isInteractive) {
      $.clock.after(0, () => void announce($))
    }

    return next(e)
  })
}

async function announce($: EngineInterface) {
  try {
    const project = await $.session.root()
    const key = shownKey(project)
    const text = identityToast(await detect($, project), (await $.store.get(key)) === true)

    if (text !== undefined) {
      $.ui.toast(brandLine(text), { timeoutMs: TOAST_MS })
      await $.store.set(key, true)
    }
  } catch (error) {
    $.ui.log(`name-hash toast skipped: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
  }
}

/** Asks the script which gate decided; a failure is "unknown", which never toasts. */
async function detect($: EngineInterface, project: string) {
  const ran = await $.process.run(['bash', `${$.plugin.root}/hooks/check-window-identity.sh`, '--json'], {
    env: { CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_ROOT: $.plugin.root },
    timeoutMs: 10_000,
  })

  return ran.exitCode === 0 ? parseState(ran.stdout) : undefined
}
