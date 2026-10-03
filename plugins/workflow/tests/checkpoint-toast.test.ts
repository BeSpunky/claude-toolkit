// The checkpoint toast against the engine: the script's `--last` receipt is
// faked beneath the plugin (process.run), and the test's own classic.PreCompact
// hook stands for the command hook that writes (or does not write) a checkpoint.
import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { brandLine } from '../hooks/_brand.tsx'
import { checkpointToast, parseReceipt } from '../hooks/checkpoint-toast.ts'

const ROOT = '/work/project'
const FILE = 'docs/features/2026-10-03-demo/handoffs/2026-10-03T1200Z-auto.md'
const receipt = (id: string, file = FILE) => JSON.stringify({ id, file, asOf: '2026-10-03T1200Z', branch: 'feat/demo' })

/** A project whose receipt is `current`; `writes` is what the compaction's command hook leaves behind. */
function world(on: On, current: string, writes?: string) {
  let receiptText = current
  const toasts: string[] = []
  const ran: { argv: string[]; env?: Record<string, string> }[] = []

  on('session.root', () => ({ value: ROOT }))
  on('process.run', ($, e) => {
    ran.push({ argv: [...e.argv], env: e.init?.env })

    return { value: { exitCode: 0, stdout: receiptText, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('classic.PreCompact', () => {
    if (writes !== undefined) receiptText = writes

    return {}
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  return { toasts, ran }
}

describe('checkpoint toast', () => {
  test('a checkpoint written during compaction is toasted with its relative path', async ($, on) => {
    const w = world(on, receipt('1-1', 'docs/features/old/handoffs/old-auto.md'), receipt('2-2'))
    await $.classic.PreCompact({ trigger: 'auto', custom_instructions: null })
    expect(w.toasts).toEqual([brandLine(`checkpoint saved → ${FILE}`)])
    expect(w.ran[0]?.argv.slice(-2)).toEqual([expect.stringMatching(/\/hooks\/checkpoint-on-compact\.sh$/), '--last'])
    expect(w.ran[0]?.env?.CLAUDE_PROJECT_DIR).toBe(ROOT)
  })

  test('the first checkpoint ever (no receipt before) is toasted', async ($, on) => {
    const w = world(on, '', receipt('1-1'))
    await $.classic.PreCompact({ trigger: 'manual', custom_instructions: null })
    expect(w.toasts).toEqual([brandLine(`checkpoint saved → ${FILE}`)])
  })

  test('no checkpoint written (protected line, no package) is silent', async ($, on) => {
    const w = world(on, receipt('1-1'))
    await $.classic.PreCompact({ trigger: 'auto', custom_instructions: null })
    expect(w.toasts).toEqual([])
  })

  test('no receipt at all is silent', async ($, on) => {
    const w = world(on, '')
    await $.classic.PreCompact({ trigger: 'auto', custom_instructions: null })
    expect(w.toasts).toEqual([])
  })
})

describe('the policy', () => {
  test('a rewrite of the same file still counts as new; garbage reads as none', () => {
    const a = parseReceipt(receipt('1-1'))
    const b = parseReceipt(receipt('1-2'))
    expect(checkpointToast(a, b)).toBe(`checkpoint saved → ${FILE}`)
    expect(checkpointToast(a, a)).toBeUndefined()
    expect(parseReceipt('not json')).toBeUndefined()
    expect(parseReceipt('{"id":"","file":"x"}')).toBeUndefined()
    expect(parseReceipt('null')).toBeUndefined()
  })
})
