// The shared-browser status entry against the engine: the project's CLI is
// faked beneath the plugin (fs.stat finds it, process.run answers its
// `status --json`), the clock is mocked, and every `$.ui.status` is recorded.
import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { entryFor, parseStatus } from '../hooks/status.tsx'

const WORKSPACE = '/work/project'
const SCRIPT = `${WORKSPACE}/tools/shared-browser/shared-browser`
const URL = 'http://localhost:6081/vnc.html?autoconnect=1'
const T0 = 1_800_000_000_000

type Answer = { exitCode: number; stdout: string }

/** A workspace whose CLI answers `answer`, seen from `root`; `hasScript` false = no web layer. */
function world(on: On, { root = WORKSPACE, hasScript = true } = {}) {
  const lines: (string | undefined)[] = []
  const ran: string[][] = []
  let answer: Answer = { exitCode: 0, stdout: JSON.stringify({ up: false, url: null, hostVerified: 'unknown' }) }
  const clock = mock.clock(on, { now: T0 })

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: root }))
  on('fs.stat', ($, e) => {
    if (!hasScript || e.path !== SCRIPT) throw new Error(`ENOENT: ${e.path}`)

    return { value: { kind: 'file' as const, size: 1, mtimeMs: T0, isLink: false } }
  })
  on('process.run', ($, e) => {
    ran.push([...e.argv])

    return { value: { ...answer, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.status', ($, e) => {
    lines.push(e.text)

    return { value: undefined }
  })

  const answers = (status: object | string, exitCode = 0) => {
    answer = { exitCode, stdout: typeof status === 'string' ? status : JSON.stringify(status) }
  }

  return { clock, lines, ran, answers }
}

async function started($: Engine, w: ReturnType<typeof world>) {
  await $.session.start({ cwd: WORKSPACE, surface: 'terminal', isInteractive: true })
  await w.clock.advance(100)
}

describe('entryFor', () => {
  test('a running, allocated browser shows its URL', () => {
    expect(entryFor({ up: true, url: URL, hostVerified: 'true' })).toBe(`🌐 shared browser: ${URL}`)
    expect(entryFor({ up: true, url: URL, hostVerified: 'unknown' })).toBe(`🌐 shared browser: ${URL}`)
  })

  test('an unverified host forward is a warning', () => {
    expect(entryFor({ up: true, url: URL, hostVerified: 'false' })).toBe(
      `⚠ shared browser: ${URL} (host forward not confirmed)`,
    )
    expect(entryFor({ up: true, url: URL, hostVerified: false })).toContain('⚠')
  })

  test('down, unallocated or unknown draws nothing', () => {
    expect(entryFor(undefined)).toBeUndefined()
    expect(entryFor({ up: false, url: URL })).toBeUndefined()
    expect(entryFor({ up: true, url: null })).toBeUndefined()
    expect(parseStatus('not json')).toBeUndefined()
    expect(parseStatus('null')).toBeUndefined()
  })
})

describe('shared-browser status entry', () => {
  test('asks the project CLI, read-only', async ($, on) => {
    const w = world(on)
    await started($, w)
    expect(w.ran[0]).toEqual(['bash', SCRIPT, 'status', '--json'])
  })

  test('finds the CLI from a subdirectory of the workspace', async ($, on) => {
    const w = world(on, { root: `${WORKSPACE}/apps/web` })
    w.answers({ up: true, url: URL, hostVerified: 'true' })
    await started($, w)
    expect(w.ran[0]).toEqual(['bash', SCRIPT, 'status', '--json'])
    expect(w.lines).toEqual([`🌐 shared browser: ${URL}`])
  })

  test('shows the entry when it comes up, warns, then clears when it stops', async ($, on) => {
    const w = world(on)
    await started($, w)
    expect(w.lines).toEqual([])

    w.answers({ up: true, url: URL, hostVerified: 'true' })
    await w.clock.advance(10_000)
    expect(w.lines).toEqual([`🌐 shared browser: ${URL}`])

    // Unchanged: no rewrite.
    await w.clock.advance(10_000)
    expect(w.lines).toHaveLength(1)

    w.answers({ up: true, url: URL, hostVerified: 'false' })
    await w.clock.advance(10_000)
    expect(w.lines.at(-1)).toBe(`⚠ shared browser: ${URL} (host forward not confirmed)`)

    w.answers({ up: false, url: URL, hostVerified: 'false' })
    await w.clock.advance(10_000)
    expect(w.lines.at(-1)).toBeUndefined()
    expect(w.lines).toHaveLength(3)
  })

  test('a failing CLI clears the entry', async ($, on) => {
    const w = world(on)
    w.answers({ up: true, url: URL, hostVerified: 'true' })
    await started($, w)
    w.answers('boom', 1)
    await w.clock.advance(10_000)
    expect(w.lines).toEqual([`🌐 shared browser: ${URL}`, undefined])
  })

  test('a project without the shared browser stays silent', async ($, on) => {
    const w = world(on, { hasScript: false })
    await started($, w)
    await w.clock.advance(30_000)
    expect(w.ran).toEqual([])
    expect(w.lines).toEqual([])
  })
})
