// bespunky-workflow — the CHECKPOINT TOAST: when the PreCompact hook writes its
// mechanical checkpoint, the person sees where it went ("checkpoint saved →
// docs/features/…/handoffs/…-auto.md"), not only the model.
//
// WHY IT ASKS THE SCRIPT. Where a checkpoint goes, whether one is written at
// all (a protected line, no package, an unreadable branch model) and what it is
// named are `checkpoint-on-compact.sh`'s decisions alone. The script records
// every checkpoint it writes in a receipt and prints it on `--last`; this mod
// reads that receipt before and after the compaction's classic hooks run, and
// toasts only when the hook wrote a new one. It re-derives nothing.
//
// DETECT, DON'T EXECUTE. It shows a fact; it writes nothing and starts no turn.
// THE PLUGIN WORKS WITHOUT IT: the command hook is the floor (it writes the
// checkpoint and asks the model to distill it); this is only the person's view.

import type { EngineInterface, Register } from 'claude-code'

/** What `checkpoint-on-compact.sh --last` prints: the last checkpoint written. */
export type CheckpointReceipt = {
  /** Unique per write, so a rewrite of the same file still reads as new. */
  id: string
  /** The checkpoint file, relative to the project dir. */
  file: string
}

const TOAST_MS = 8_000

/** The receipt in `--last`'s output, or undefined for none or anything malformed. */
export function parseReceipt(stdout: string): CheckpointReceipt | undefined {
  try {
    const value: unknown = JSON.parse(stdout.trim())
    if (typeof value !== 'object' || value === null) {
      return undefined
    }
    const { id, file } = value as Record<string, unknown>

    return typeof id === 'string' && id !== '' && typeof file === 'string' && file !== '' ? { id, file } : undefined
  } catch {
    return undefined
  }
}

/** The toast for a compaction, given the receipt before and after its hooks ran: the whole policy, pure. */
export function checkpointToast(before: CheckpointReceipt | undefined, after: CheckpointReceipt | undefined) {
  return after !== undefined && after.id !== before?.id ? `checkpoint saved → ${after.file}` : undefined
}

export const register: Register = on => {
  on('classic.PreCompact', async ($, e, next) => {
    const before = await lastCheckpoint($)
    const result = await next(e)
    const text = checkpointToast(before, await lastCheckpoint($))

    if (text !== undefined) {
      $.ui.toast(text, { timeoutMs: TOAST_MS })
    }

    return result
  })
}

/** Asks the script for its receipt; any failure is "none" — the toast is a nicety, never an error. */
async function lastCheckpoint($: EngineInterface) {
  try {
    const ran = await $.process.run(['bash', `${$.plugin.root}/hooks/checkpoint-on-compact.sh`, '--last'], {
      env: { CLAUDE_PROJECT_DIR: await $.session.root(), CLAUDE_PLUGIN_ROOT: $.plugin.root },
      timeoutMs: 5_000,
    })

    return ran.exitCode === 0 ? parseReceipt(ran.stdout) : undefined
  } catch {
    return undefined
  }
}
