// bespunky-workflow — the STANDING PANE: `/standing` opens a pane listing this project's
// feature packages grouped live / dormant / concluded, each in-flight one with its newest
// handoff baton and a Resume button.
//
// WHY IT IS A VIEW OVER THE ENGINE. What a feature package is, whether it is in flight, how
// recently it moved and which baton is newest are DERIVED by the project-standing engine
// (skills/project-standing/scripts/standing.mjs), the same one the SessionStart notice reads.
// This module runs it (`--json`), folds the result into one `$.state` value
// (types/index.d.ts) and draws that; it never re-derives anything, so the pane and the notice
// cannot disagree.
//
// DETECT, DON'T EXECUTE. The pane changes nothing. Resume only queues a prompt for Claude
// ("resume <slug> — read its newest handoff"), which the person can watch and interrupt; the
// orientation itself stays the skill's job. Free text from the repo (a summary, tags) is
// drawn, never put into a prompt; the prompt carries only names the engine validated.
//
// NEVER OPENED UNASKED. A session start only registers the command. The pane opens when the
// person runs /standing; the floor without mods is the skill and the SessionStart notice.

import { update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Standing, StandingPackage, StandingView } from '../types/index.d.ts'

const VIEW = { plugin: 'bespunky-workflow', key: 'standing' } as const
const PANE = 'standing'
const COMMAND = 'standing'
const ENGINE = 'skills/project-standing/scripts/standing.mjs'

const PACKAGE_DIR = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+$/
const BATON = /^handoffs\/[A-Za-z0-9._-]{1,120}$/
/** Digits 1–9 press the first nine Resume buttons. */
const HOTKEYS = '123456789'

/** The engine's JSON, checked for the shape the pane relies on; anything else is no standing. */
export function parseStanding(stdout: string): Standing | undefined {
  try {
    const value = JSON.parse(stdout) as Standing
    const isShaped =
      value?.version === 1 &&
      Array.isArray(value.packages) &&
      typeof value.now === 'number' &&
      value.packages.every(pkg => typeof pkg?.dir === 'string' && typeof pkg.slug === 'string' && typeof pkg.state === 'string')

    return isShaped ? value : undefined
  } catch {
    return undefined
  }
}

/** What the pane shows for one engine run. */
export function viewOf(standing: Standing | undefined): StandingView {
  if (standing === undefined) return { phase: 'empty', why: 'the project-standing engine did not answer' }
  if (standing.repo === null) return { phase: 'empty', why: 'this is not a git repository' }
  if (!standing.repo.hasFeatures) return { phase: 'empty', why: 'this project has no docs/features/' }

  return { phase: 'ready', standing }
}

export type Groups = { live: StandingPackage[]; dormant: StandingPackage[]; concluded: StandingPackage[] }

/** The packages by state, most recently active first. */
export function groups(standing: Standing): Groups {
  const newest = (a: StandingPackage, b: StandingPackage) => b.lastActivity - a.lastActivity || b.dir.localeCompare(a.dir)
  const of = (state: StandingPackage['state']) => standing.packages.filter(pkg => pkg.state === state).sort(newest)

  return { live: of('live'), dormant: of('dormant'), concluded: of('concluded') }
}

/**
 * The prompt Resume queues, built only from validated names; undefined when a name fails,
 * so a package the contract did not vouch for gets no button.
 */
export function resumePrompt(pkg: StandingPackage): string | undefined {
  if (!PACKAGE_DIR.test(pkg.dir)) return undefined
  const where = `docs/features/${pkg.dir}/`
  if (pkg.baton === undefined) {
    return `Resume ${pkg.slug}: it has no handoff baton yet, so orient from ${where} (bespunky-workflow:project-standing, then bespunky-workflow:session-handoff).`
  }
  if (!BATON.test(pkg.baton)) return undefined

  return `Resume ${pkg.slug}: read its newest handoff, ${where}${pkg.baton}, and pick up from there (bespunky-workflow:session-handoff).`
}

/** "today", "3d ago", "5w ago", "4mo ago". */
export function age(now: number, then: number) {
  const days = Math.floor((now - then) / 86400)
  if (days < 1) return 'today'
  if (days < 14) return `${days}d ago`
  if (days < 60) return `${Math.floor(days / 7)}w ago`

  return `${Math.floor(days / 30)}mo ago`
}

export const register: Register = on => {
  // Only where a person is at the prompt: the pane is for someone to read and press, and a
  // headless run has the skill. (The plugin's other mods hook every session start.)
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Where this project stands: feature packages by status, each with its newest handoff',
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const view = await refresh($)
    if (view.phase === 'empty') {
      return { text: `No project standing to show: ${view.why}.` }
    }
    await $.ui.open({ id: PANE, title: 'Standing' })
    const { live, dormant, concluded } = groups(view.standing)

    return { text: `Standing: ${live.length} live, ${dormant.length} dormant, ${concluded.length} concluded.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const { value: view } = await $.state.get(VIEW)
    const controls = (
      <Box flexDirection="row" gap={1}>
        <Button key="standing-refresh" label="Refresh" hotkey="r" onPress={() => void refresh($)} />
        <Button key="standing-close" label="Close" role="dismiss" onPress={() => void $.ui.close({ id: PANE })} />
      </Box>
    )

    if (view === undefined || view.phase === 'empty') {
      return (
        <Box flexDirection="column">
          <Text dimColor>{view === undefined ? 'Nothing derived yet.' : `Nothing to show: ${view.why}.`}</Text>
          {controls}
        </Box>
      )
    }

    const { standing } = view
    const { live, dormant, concluded } = groups(standing)
    const resumable = [...live, ...dormant]
    const hotkeyOf = (pkg: StandingPackage) => HOTKEYS[resumable.indexOf(pkg)]

    const inFlight = (pkg: StandingPackage) => {
      const prompt = resumePrompt(pkg)
      const hotkey = hotkeyOf(pkg)
      const where = pkg.baton ?? 'no baton yet'

      return (
        <Box key={`standing-row-${pkg.dir}`} flexDirection="row" gap={1}>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">
              <Text bold>{pkg.slug}</Text>
              <Text dimColor>
                {' '}
                {age(standing.now, pkg.lastActivity)}
                {pkg.hasWorktree ? ' · worktree' : ''} · {where}
              </Text>
            </Text>
          </Box>
          {prompt !== undefined && (
            <Button
              key={`standing-resume-${pkg.dir}`}
              label="Resume"
              {...(hotkey === undefined ? {} : { hotkey })}
              onPress={() => void resume($, pkg, prompt)}
            />
          )}
        </Box>
      )
    }

    const closed = (pkg: StandingPackage) => (
      <Text key={`standing-row-${pkg.dir}`} dimColor wrap="truncate-end">
        {pkg.slug}
        {pkg.status === 'concluded' ? '' : ` (${pkg.status})`}
        {pkg.summary ? ` — ${pkg.summary}` : ''}
      </Text>
    )

    const section = (title: string, rows: StandingPackage[], draw: (pkg: StandingPackage) => unknown) => (
      <Box key={`standing-${title.toLowerCase()}`} flexDirection="column">
        <Text bold>
          {title} ({rows.length})
        </Text>
        {rows.length === 0 ? <Text dimColor>none</Text> : rows.map(draw)}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {section('Live', live, inFlight)}
        {section('Dormant', dormant, inFlight)}
        {section('Concluded', concluded, closed)}
        {controls}
      </Box>
    )
  })
}

/** Runs the engine for the session's project and stores what the pane shows. */
async function refresh($: EngineInterface): Promise<StandingView> {
  const view = viewOf(await derive($))
  await update($, VIEW, () => view)

  return view
}

async function derive($: EngineInterface): Promise<Standing | undefined> {
  try {
    const root = await $.session.root()
    const ran = await $.process.run(['node', `${$.plugin.root}/${ENGINE}`, '--json'], {
      cwd: root,
      env: { CLAUDE_PROJECT_DIR: root },
      timeoutMs: 15_000,
    })

    return ran.exitCode === 0 ? parseStanding(ran.stdout) : undefined
  } catch (error) {
    $.ui.log(`bespunky-workflow: standing engine failed: ${error instanceof Error ? error.message : String(error)}`, {
      to: 'debug',
    })

    return undefined
  }
}

/** Queues the resume prompt for Claude; the pane itself does nothing else. */
async function resume($: EngineInterface, pkg: StandingPackage, prompt: string) {
  $.ui.toast(`Asked Claude to resume ${pkg.slug}`)
  await $.prompt.submit({ text: prompt, asUser: true })
}
