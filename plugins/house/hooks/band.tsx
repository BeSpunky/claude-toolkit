// bespunky-house — the HOUSE BAND: a row above the prompt, shown only
// while this project's house tooling has something to say (the toolkit moved
// on, a layer was never applied, the container's post-create failed), with one
// button that asks Claude to deal with it and one that hides the band.
//
// WHY IT ASKS THE SCRIPT. Every rule about when a project is behind — order the
// stamp against the install, a project AHEAD of this machine is not staleness,
// silence when the plugin root lives inside the project, the snoozes — lives in
// check-house-version.sh, the SessionStart hook. The band runs that same script
// with `--json` and draws what it records, so the two surfaces cannot disagree
// and no rule is written twice.
//
// DETECT, DON'T EXECUTE. The band never runs an upgrade, an update or a chown. Its
// button submits a prompt — the person's own request, made by pressing it — and
// Claude then runs the consented path (the /bespunky-house:upgrade command's own
// gates included).
//
// THE PLUGIN WORKS WITHOUT IT. The SessionStart hook still relays the notice to
// the model; with mods disabled nothing here is missed but the view.

import type { EngineInterface, Register } from 'claude-code'

import type { HouseAction, HouseBand, HouseNotice } from '../types/index.d.ts'

import { BrandFrame, brandLine } from './_brand.tsx'

/** The one value the band draws from. */
const BAND = { plugin: 'bespunky-house', key: 'band' } as const

const CHECK_TIMEOUT_MS = 10_000
/** A dismissed band cannot say how it comes back, so the dismissal does. */
export const DISMISSED_TOAST = 'House notice hidden for this session; the next session checks again'
const ACTIONS: readonly HouseAction[] = ['upgrade', 'update-toolkit', 'fix-mounts']

/** Each action's button and the prompt it submits. */
const BUTTONS: Record<HouseAction, { label: string; hotkey: string; prompt: (summary: string) => string }> = {
  upgrade: {
    label: 'Upgrade',
    hotkey: 'u',
    prompt: summary =>
      `Run /bespunky-house:upgrade to bring this project up to the current house standard. The house band says: ${summary}`,
  },
  'update-toolkit': {
    label: 'Update toolkit',
    hotkey: 't',
    prompt: summary =>
      `Help me update the claude-toolkit plugins on this machine. The house band says: ${summary} Do not run an upgrade as part of this.`,
  },
  'fix-mounts': {
    label: 'Fix',
    hotkey: 'f',
    prompt: summary =>
      `This container's post-create looks like it failed. The house band says: ${summary} Show me the fix and ask before running anything.`,
  },
}

/**
 * The notices in the script's `--json` output; anything else (no output, a
 * failed run, an unknown action) is no notice. Pure: the whole parsing policy.
 */
export function parseNotices(stdout: string): HouseNotice[] {
  try {
    const parsed: unknown = JSON.parse(stdout)
    const notices = (parsed as { notices?: unknown }).notices

    return Array.isArray(notices) ? notices.filter(isNotice) : []
  } catch {
    return []
  }
}

function isNotice(value: unknown): value is HouseNotice {
  const n = value as Partial<HouseNotice> | null

  return (
    typeof n?.kind === 'string' &&
    typeof n.summary === 'string' &&
    n.summary !== '' &&
    ACTIONS.includes(n.action as HouseAction)
  )
}

/** The prompt one notice's button submits. */
export function promptFor(notice: HouseNotice): string {
  return BUTTONS[notice.action].prompt(notice.summary)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (e.isInteractive) {
      const notices = await check($, e.cwd)
      await $.state.set(BAND, { projectDir: e.cwd, notices, dismissed: false })
    }

    return next(e)
  })

  // While the band is up, re-ask after each main-thread turn: an upgrade (or a fix)
  // that ran in it takes the band down. Nothing shown, nothing re-run.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const { value: band, version } = await $.state.get(BAND)

    if (e.agentId === undefined && band !== undefined && !band.dismissed && band.notices.length > 0) {
      const notices = await check($, band.projectDir)
      if (JSON.stringify(notices) !== JSON.stringify(band.notices)) {
        await $.state.set(BAND, { ...band, notices }, { ifVersion: version })
      }
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { value: band } = await $.state.get(BAND)

    if (e.props.hasSurvey || band === undefined || band.dismissed || band.notices.length === 0) {
      return next(e)
    }

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui

    return (
      <BrandFrame ui={ui} site={e}>
        {band.notices.map((notice, index) => {
          const button = BUTTONS[notice.action]

          return (
            <Box key={`house-row-${notice.kind}`} flexDirection="row" gap={1}>
              <Box flexGrow={1} flexShrink={1}>
                <Text wrap="truncate-end">{notice.summary}</Text>
              </Box>
              <Button
                key={`house-${notice.kind}`}
                label={button.label}
                hotkey={button.hotkey}
                variant="primary"
                onPress={() => void $.prompt.submit({ text: promptFor(notice), asUser: true })}
              />
              {index === 0 && (
                <Button key="house-dismiss" label="Dismiss" hotkey="d" role="dismiss" onPress={() => void dismiss($)} />
              )}
            </Box>
          )
        })}
      </BrandFrame>
    )
  })
}

/** Runs the SessionStart hook's own detection in `--json` mode; silent on any failure. */
async function check($: EngineInterface, projectDir: string): Promise<HouseNotice[]> {
  const root = $.plugin.root
  try {
    const ran = await $.process.run(['bash', `${root}/hooks/check-house-version.sh`, '--json'], {
      cwd: projectDir,
      env: { CLAUDE_PLUGIN_ROOT: root, CLAUDE_PROJECT_DIR: projectDir },
      timeoutMs: CHECK_TIMEOUT_MS,
    })

    return ran.exitCode === 0 ? parseNotices(ran.stdout) : []
  } catch (error) {
    $.ui.log(`bespunky-house: house check failed: ${error instanceof Error ? error.message : String(error)}`, {
      to: 'debug',
    })

    return []
  }
}

/** Hides the band for the rest of the session. */
async function dismiss($: EngineInterface) {
  const { value: band, version } = await $.state.get(BAND)
  if (band !== undefined) {
    await $.state.set(BAND, { ...band, dismissed: true } satisfies HouseBand, { ifVersion: version })
    $.ui.toast(brandLine(DISMISSED_TOAST))
  }
}
