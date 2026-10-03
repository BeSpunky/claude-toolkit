// bespunky-workflow — the STANDING PANE: `/standing` opens a pane listing this project's
// in-flight feature packages (live / dormant), each with its newest handoff baton and a Resume
// button. Its job is "what needs me?", so it leads with that answer ("Nothing in flight" when
// so) and draws a section only when it has rows; finished work is history, collapsed to one line
// (count + the latest) that a toggle expands to the most recent few.
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
// orientation itself stays the skill's job. Free text from the repo (the about line, a summary, tags) is
// drawn, never put into a prompt; the prompt carries only names the engine validated.
//
// NEVER OPENED UNASKED. A session start only registers the command. The pane opens when the
// person runs /standing; the floor without mods is the skill and the SessionStart notice. Because
// it never comes back by itself, closing it says how to: the control row carries the hint, and a
// close by any hand toasts it.
//
// THE TOOLKIT'S LOOK. The frame, title, rules and mark come from ./_brand.tsx (generated from
// tools/mod-brand/brand.tsx): this module draws only its own rows.

import { update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Standing, StandingPackage, StandingView } from '../types/index.d.ts'

import { BrandCommandRow, BrandDivider, BrandFrame, brandLine } from './_brand.tsx'

const VIEW = { plugin: 'bespunky-workflow', key: 'standing' } as const
const SHOW_CONCLUDED = { plugin: 'bespunky-workflow', key: 'showConcluded' } as const
const PANE = 'standing'
const COMMAND = 'standing'
const ENGINE = 'skills/project-standing/scripts/standing.mjs'

const PACKAGE_DIR = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+$/
const BATON = /^handoffs\/[A-Za-z0-9._-]{1,120}$/
/** The engine's worktree rule: a relative or absolute path of safe segments, never `.` or `..`. */
const WORKTREE = /^\/?(?!\.\.?(?:\/|$))[A-Za-z0-9._@+-]+(?:\/(?!\.\.?(?:\/|$))[A-Za-z0-9._@+-]+)*$/
/** Digits 1–9 press the first nine Resume buttons. */
const HOTKEYS = '123456789'
const CONCLUDED_HOTKEY = 'c'
/** How many concluded packages the expanded list shows. */
const RECENT_CONCLUDED = 5
/** How the pane comes back once closed: the one thing a closed pane cannot show. */
export const REOPEN_HINT = `/${COMMAND} reopens it`
export const CLOSED_TOAST = `Standing closed — ${REOPEN_HINT}`

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

/** The packages by state: in flight most recently active first, concluded most recently closed first. */
export function groups(standing: Standing): Groups {
  const newest = (a: StandingPackage, b: StandingPackage) => b.lastActivity - a.lastActivity || b.dir.localeCompare(a.dir)
  const closedLast = (a: StandingPackage, b: StandingPackage) =>
    (b.closedAt ?? b.lastActivity) - (a.closedAt ?? a.lastActivity) || newest(a, b)
  const of = (state: StandingPackage['state']) => standing.packages.filter(pkg => pkg.state === state)

  return { live: of('live').sort(newest), dormant: of('dormant').sort(newest), concluded: of('concluded').sort(closedLast) }
}

/** The pane's first line: the answer to "what needs me?". */
export function headline({ live, dormant }: Groups) {
  const inFlight = live.length + dormant.length

  return inFlight === 0 ? 'Nothing in flight' : `${inFlight} in flight`
}

/** The collapsed concluded section: "28 concluded · latest: <slug> (<age>)". */
export function concludedLine(now: number, concluded: StandingPackage[]) {
  const [latest] = concluded
  if (latest === undefined) return undefined

  return `${concluded.length} concluded · latest: ${latest.slug} (${age(now, latest.closedAt ?? latest.lastActivity)})`
}

/** An epoch as its UTC calendar date, `YYYY-MM-DD`. */
export function dateOf(epoch: number) {
  return new Date(epoch * 1000).toISOString().slice(0, 10)
}

/**
 * The prompt Resume queues, built only from validated names; undefined when a name fails,
 * so a package the contract did not vouch for gets no button.
 */
export function resumePrompt(pkg: StandingPackage): string | undefined {
  if (!PACKAGE_DIR.test(pkg.dir)) return undefined
  if (pkg.worktree !== undefined && !WORKTREE.test(pkg.worktree)) return undefined
  const where = `${pkg.worktree === undefined ? '' : `${pkg.worktree}/`}docs/features/${pkg.dir}/`
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
    await $.ui.open({ id: PANE, title: 'standing' })
    const { live, dormant, concluded } = groups(view.standing)

    return { text: `Standing: ${live.length} live, ${dormant.length} dormant, ${concluded.length} concluded.` }
  })

  // The command's answer row reads as the toolkit's, not as the plugin's bare name.
  on('ui.render', { component: 'CommandOutput', props: { command: COMMAND } }, async ($, e, next) => {
    if (e.props.isErrored) return next(e)

    return <BrandCommandRow ui={$.ui.resolve(e)} command={COMMAND} text={e.props.text} plugin={$.plugin.name} />
  })

  // Closed by the person's own hand (the engine's close mark, ctrl+x x), say how it comes back. The
  // pane's Close button says it itself (`close`); an unload is no one's choice and says nothing.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    if (e.origin.kind === 'person') {
      $.ui.toast(brandLine(CLOSED_TOAST))
    }

    return closed
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const { value: view } = await $.state.get(VIEW)
    const controls = (
      <Box key="standing-controls" flexDirection="row" gap={1}>
        <Button key="standing-refresh" label="Refresh" hotkey="r" onPress={() => void refresh($)} />
        <Button key="standing-close" label="Close" role="dismiss" onPress={() => void close($)} />
        <Text dimColor wrap="truncate-end">
          {REOPEN_HINT}
        </Text>
      </Box>
    )

    if (view === undefined || view.phase === 'empty') {
      return (
        <BrandFrame ui={ui} site={e} mod={COMMAND}>
          <Text dimColor>{view === undefined ? 'Nothing derived yet.' : `Nothing to show: ${view.why}.`}</Text>
          {controls}
        </BrandFrame>
      )
    }

    const { standing } = view
    const { value: showConcluded = false } = await $.state.get(SHOW_CONCLUDED)
    const grouped = groups(standing)
    const { live, dormant, concluded } = grouped
    const resumable = [...live, ...dormant]
    const hotkeyOf = (pkg: StandingPackage) => HOTKEYS[resumable.indexOf(pkg)]

    // What the package is about, under its row: the slug alone may mean nothing a month later.
    const aboutLine = (pkg: StandingPackage) =>
      typeof pkg.about === 'string' && pkg.about !== '' ? (
        <Box key={`standing-about-${pkg.dir}`} paddingLeft={2}>
          <Text dimColor wrap="truncate-end">
            {pkg.about}
          </Text>
        </Box>
      ) : null

    const inFlight = (pkg: StandingPackage) => {
      const prompt = resumePrompt(pkg)
      const hotkey = hotkeyOf(pkg)
      const where = pkg.baton ?? 'no baton yet'

      return (
        <Box key={`standing-row-${pkg.dir}`} flexDirection="row" gap={1}>
          <Box flexGrow={1} flexShrink={1} flexDirection="column">
            <Text wrap="truncate-end">
              <Text bold>{pkg.slug}</Text>
              <Text dimColor>
                {' '}
                {age(standing.now, pkg.lastActivity)}
                {pkg.hasWorktree ? ' · worktree' : ''} · {where}
              </Text>
            </Text>
            {aboutLine(pkg)}
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

    // Items space out, each item's own lines stay together: a thin rule BETWEEN packages, never
    // inside one (a slug and its about line are one item) and never after the last.
    const separated = (rows: StandingPackage[], draw: (pkg: StandingPackage) => JSX.Element) =>
      rows.flatMap((pkg, index) =>
        index === 0 ? [draw(pkg)] : [<BrandDivider key={`standing-divider-${pkg.dir}`} ui={ui} site={e} />, draw(pkg)],
      )

    // A section only when it has rows: an empty heading answers nothing.
    const section = (title: string, rows: StandingPackage[]) =>
      rows.length === 0 ? null : (
        <Box key={`standing-${title.toLowerCase()}`} flexDirection="column">
          <Text bold>
            {title} ({rows.length})
          </Text>
          {separated(rows, inFlight)}
        </Box>
      )

    const closed = (pkg: StandingPackage) => (
      <Box key={`standing-row-${pkg.dir}`} flexDirection="column">
        <Text dimColor wrap="truncate-end">
          {pkg.slug} {dateOf(pkg.closedAt ?? pkg.lastActivity)}
          {pkg.status === 'concluded' ? '' : ` (${pkg.status})`}
        </Text>
        {aboutLine(pkg)}
      </Box>
    )

    const summary = concludedLine(standing.now, concluded)
    const history =
      summary === undefined ? null : (
        <Box key="standing-concluded" flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Box flexGrow={1} flexShrink={1}>
              <Text dimColor wrap="truncate-end">
                {summary}
              </Text>
            </Box>
            <Button
              key="standing-concluded-toggle"
              label={showConcluded ? 'Hide concluded' : 'Show concluded'}
              hotkey={CONCLUDED_HOTKEY}
              onPress={() => void toggleConcluded($)}
            />
          </Box>
          {showConcluded && separated(concluded.slice(0, RECENT_CONCLUDED), closed)}
        </Box>
      )

    return (
      <BrandFrame ui={ui} site={e} mod={COMMAND}>
        <Text bold>{headline(grouped)}</Text>
        {section('Live', live)}
        {section('Dormant', dormant)}
        {history}
        {controls}
      </BrandFrame>
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

/** The Close button: closes the pane and says how it comes back. */
async function close($: EngineInterface) {
  await $.ui.close({ id: PANE })
  $.ui.toast(brandLine(CLOSED_TOAST))
}

/** Expands or collapses the concluded section. */
async function toggleConcluded($: EngineInterface) {
  await update($, SHOW_CONCLUDED, shown => !(shown ?? false))
}

/** Queues the resume prompt for Claude; the pane itself does nothing else. */
async function resume($: EngineInterface, pkg: StandingPackage, prompt: string) {
  $.ui.toast(brandLine(`Asked Claude to resume ${pkg.slug}`))
  await $.prompt.submit({ text: prompt, asUser: true })
}
