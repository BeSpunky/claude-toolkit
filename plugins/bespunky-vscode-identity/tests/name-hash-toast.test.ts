// The name-hash toast against the engine: the script's `--json` verdict is faked
// beneath the plugin (process.run), the session's project root is mocked, and
// the plugin's own `$.store` carries "already shown" from one session to the next.
import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { brandLine } from '../hooks/_brand.tsx'
import { TOAST_TEXT, identityToast, parseState } from '../hooks/name-hash-toast.ts'

const ROOT = '/work/project'

function world(on: On, stdout: string) {
  const toasts: string[] = []
  const ran: { argv: string[]; env?: Record<string, string> }[] = []
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on)

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('process.run', ($, e) => {
    ran.push({ argv: [...e.argv], env: e.init?.env })

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  return { toasts, ran, clock }
}

async function start($: Engine, w: ReturnType<typeof world>, isInteractive = true) {
  await $.session.start({ cwd: ROOT, surface: isInteractive ? 'terminal' : null, isInteractive })
  await w.clock.advance(10)
}

describe('name-hash toast', () => {
  test('upgradable: toasts once, and a later session for the same project stays quiet', async ($, on) => {
    const w = world(on, '{"state":"upgradable"}\n')
    await start($, w)
    expect(w.toasts).toEqual([brandLine(TOAST_TEXT)])
    expect(w.ran[0]?.argv.slice(-2)).toEqual([expect.stringMatching(/\/hooks\/check-window-identity\.sh$/), '--json'])
    expect(w.ran[0]?.env?.CLAUDE_PROJECT_DIR).toBe(ROOT)

    await start($, w)
    expect(w.toasts).toEqual([brandLine(TOAST_TEXT)])
  })

  for (const state of ['unapplied', 'resolved', 'no-design-system', 'declined']) {
    test(`${state}: silent`, async ($, on) => {
      const w = world(on, `{"state":"${state}"}`)
      await start($, w)
      expect(w.toasts).toEqual([])
    })
  }

  test('a headless session neither toasts nor spends the once', async ($, on) => {
    const w = world(on, '{"state":"upgradable"}')
    await start($, w, false)
    expect(w.ran).toEqual([])
    await start($, w)
    expect(w.toasts).toEqual([brandLine(TOAST_TEXT)])
  })

  test('the script saying nothing usable is silent', async ($, on) => {
    const w = world(on, '')
    await start($, w)
    expect(w.toasts).toEqual([])
  })
})

describe('the policy', () => {
  test('only an unshown upgradable toasts; garbage reads as unknown', () => {
    expect(identityToast('upgradable', false)).toBe(TOAST_TEXT)
    expect(identityToast('upgradable', true)).toBeUndefined()
    expect(identityToast('declined', false)).toBeUndefined()
    expect(identityToast(undefined, false)).toBeUndefined()
    expect(parseState('{"state":"upgradable"}')).toBe('upgradable')
    expect(parseState('{"state":"maybe"}')).toBeUndefined()
    expect(parseState('nope')).toBeUndefined()
  })
})
