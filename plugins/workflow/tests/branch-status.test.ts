// The branch-model status line against the engine: git and branches.mjs are faked beneath the plugin
// (process.run), and the pinned line is read off `ui.status`. The fold itself (`statusLine`) is pure and
// tested on its own.
import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { brandLine } from '../hooks/_brand.tsx'
import { isProtected, parseStatus } from '../hooks/branch-engine.ts'
import type { Model } from '../hooks/branch-engine.ts'
import { parseViolations, statusLine } from '../hooks/branch-status.ts'

const DECLARED = {
  state: 'declared',
  source: 'refs/heads/development',
  projection: { schema: 1, remote: 'origin', integration: 'development', chain: ['development', 'main'], summary: 'development → main' },
  protected: ['development', 'main'],
  protectedPatterns: [],
  notes: [],
  reason: null,
}
const UNDECLARED = { ...DECLARED, state: 'undeclared', source: null, projection: null, protected: ['main'] }
const UNREADABLE = { ...DECLARED, state: 'unreadable', projection: null, reason: 'branches.json is not valid JSON.' }

type Answer = { exitCode: number; stdout?: string }
type World = { branch?: string | 'DETACHED'; status?: Answer; verify?: Answer }

const ok = (json: unknown, exitCode = 0): Answer => ({ exitCode, stdout: JSON.stringify(json) })

/** git and the engine as the module sees them; `w` may be changed between steps. */
function world(on: On, w: World) {
  const ran: string[][] = []
  const lines: (string | undefined)[] = []
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.status', ($, e) => {
    lines.push(e.text)

    return { value: undefined }
  })
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    ran.push(argv)
    const answer = ((): Answer => {
      if (argv[0] === 'git' && argv[1] === 'symbolic-ref') {
        return w.branch === undefined ? { exitCode: 128 } : w.branch === 'DETACHED' ? { exitCode: 1 } : { exitCode: 0, stdout: `${w.branch}\n` }
      }
      if (argv[0] === 'git' && argv[1] === 'rev-parse') return { exitCode: w.branch === undefined ? 128 : 0, stdout: 'abc\n' }
      if (argv[0] === 'node' && argv[2] === 'status') return w.status ?? { exitCode: 2 }
      if (argv[0] === 'node' && argv[2] === 'verify') return w.verify ?? { exitCode: 2 }
      throw new Error(`unexpected command: ${argv.join(' ')}`)
    })()

    return { value: { stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...answer } }
  })

  return { ran, lines, clock, last: () => lines.at(-1) }
}

/** Lets the module's unawaited refresh finish: advancing the mocked clock settles the work in flight. */
const settle = (w: { clock: { advance: (ms: number) => Promise<unknown> } }) => w.clock.advance(1)

async function start($: Engine, w: Parameters<typeof settle>[0]) {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await settle(w)
}

describe('statusLine', () => {
  const declared = parseStatus(JSON.stringify(DECLARED))

  test('a work branch leads into the chain', () => {
    expect(statusLine({ kind: 'branch', name: 'feat/x' }, declared)).toBe('feat/x → development → main')
  })
  test('a protected line is a warning', () => {
    expect(statusLine({ kind: 'branch', name: 'main' }, declared)).toBe("⚠ on protected main, don't commit here · development → main")
  })
  test('violations are counted', () => {
    expect(statusLine({ kind: 'branch', name: 'feat/x' }, declared, 2)).toBe('feat/x → development → main · ⚠ 2 violations')
    expect(statusLine({ kind: 'branch', name: 'feat/x' }, declared, 0)).toBe('feat/x → development → main')
  })
  test('undeclared and unreadable say so', () => {
    const undeclared = parseStatus(JSON.stringify(UNDECLARED))
    expect(statusLine({ kind: 'branch', name: 'feat/x' }, undeclared)).toBe('feat/x · branch model undeclared')
    expect(statusLine({ kind: 'branch', name: 'main' }, undeclared)).toBe('⚠ on protected main · branch model undeclared')
    expect(statusLine({ kind: 'branch', name: 'x' }, parseStatus(JSON.stringify(UNREADABLE)))).toBe(
      '⚠ branch model unreadable: branches.json is not valid JSON',
    )
  })
  test('no repository, or no answer in shape, shows nothing', () => {
    expect(statusLine({ kind: 'none' }, declared)).toBeUndefined()
    expect(statusLine({ kind: 'branch', name: 'x' }, parseStatus('boom'))).toBeUndefined()
    expect(statusLine({ kind: 'branch', name: 'x' }, parseStatus(JSON.stringify({ ...DECLARED, protected: 'main' })))).toBeUndefined()
  })
  test('a detached HEAD still shows the model', () => {
    expect(statusLine({ kind: 'detached' }, declared)).toBe('detached HEAD → development → main')
  })
  test('protected globs match as the shell does', () => {
    const model = { protected: ['main'], protectedPatterns: ['release/*'] }
    expect(isProtected('release/1.2', model)).toBe(true)
    expect(isProtected('release/1.2/x', model)).toBe(true)
    expect(isProtected('releases/1', model)).toBe(false)
    expect(isProtected('feat/release', model)).toBe(false)
  })
  test('violations parse only in shape', () => {
    expect(parseViolations('{"violations":3}')).toBe(3)
    expect(parseViolations('{"violations":"3"}')).toBeUndefined()
    expect(parseViolations('')).toBeUndefined()
  })
})

describe('branch status line', () => {
  test('session start pins the branch in the declared chain, with violations', async ($, on) => {
    const w = world(on, { branch: 'feat/x', status: ok(DECLARED), verify: ok({ violations: 1 }, 1) })
    await start($, w)
    expect(w.last()).toBe(brandLine('feat/x → development → main · ⚠ 1 violation'))
  })

  test('undeclared (exit 3) and unreadable (exit 1) are honest', async ($, on) => {
    const w = world(on, { branch: 'main', status: ok(UNDECLARED, 3) })
    await start($, w)
    expect(w.last()).toBe(brandLine('⚠ on protected main · branch model undeclared'))
    expect(w.ran.some(argv => argv[2] === 'verify')).toBe(false)
  })

  test('outside a repository nothing is pinned', async ($, on) => {
    const w = world(on, {})
    await start($, w)
    expect(w.lines.filter(Boolean)).toEqual([])
  })

  test('a checkout seen at the next prompt re-reads the model but not verify', async ($, on) => {
    const state: World = { branch: 'feat/x', status: ok(DECLARED), verify: ok({ violations: 0 }) }
    const w = world(on, state)
    await start($, w)
    expect(w.last()).toBe(brandLine('feat/x → development → main'))
    const verifies = () => w.ran.filter(argv => argv[2] === 'verify').length
    const before = verifies()

    state.branch = 'development'
    await $.prompt.submit({ text: 'hi' } as never).catch(() => undefined)
    await settle(w)
    expect(w.last()).toBe(brandLine("⚠ on protected development, don't commit here · development → main"))
    expect(verifies()).toBe(before)
  })

  test('a git Bash call refreshes in full; other Bash calls do not', async ($, on) => {
    const state: World = { branch: 'feat/x', status: ok(DECLARED), verify: ok({ violations: 0 }) }
    const w = world(on, state)
    on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
    await start($, w)
    const count = w.ran.length

    await $.tool.call({ tool: 'Bash', command: 'ls -la' } as never)
    await settle(w)
    expect(w.ran.length).toBe(count)

    state.branch = 'main'
    state.verify = ok({ violations: 2 }, 1)
    await $.tool.call({ tool: 'Bash', command: 'git checkout main' } as never)
    await settle(w)
    expect(w.last()).toBe(brandLine("⚠ on protected main, don't commit here · development → main · ⚠ 2 violations"))
  })
})
