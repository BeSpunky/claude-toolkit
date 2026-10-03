// ✦ bespunky — THE TOOLKIT'S MOD BRAND: one mark, one accent, one frame, so every toolkit mod (a pane, a band
// above the prompt, a status entry, a toast) reads as one family — and never as Claude's own UI or another
// plugin's.
//
// THE SINGLE SOURCE. Plugins cannot import each other's files, so this file is PROJECTED, verbatim under a
// generated header, into `hooks/_brand.tsx` of every plugin whose hooks.json names a module
// (`node tools/mod-brand/project.mjs --write`); CI fails on any drift. Change the brand HERE, never in a
// projection, and never re-type the glyph or the colour in a mod.
//
// THE RULES IT ENCODES.
//   - Plain-text surfaces (status line, toast) carry the GLYPH alone: they are one line, and a toast already
//     sits under the plugin's name. `brandLine(text)`.
//   - Drawn surfaces carry the WORDMARK in the accent: a band leads with `✦ bespunky` in a gutter of its own,
//     a pane opens with `✦ bespunky · <mod>` over a dim rule (the engine draws no pane title while only one
//     pane is open, so this header IS the title). `<BrandFrame>`.
//   - A mod's slash command answers in the transcript under the PLUGIN's name (`bespunky-workflow: …`), which
//     reads as any plugin's. Its output row is redrawn as the toolkit's: `✦ bespunky · <command>` then the
//     text. `<BrandCommandRow>`, from a `ui.render` hook on `{ component: 'CommandOutput', props: { command } }`.
//   - Anything drawn BELOW the transcript (every band; a pane seated inline) starts one blank row down, so it
//     never reads as the tail of Claude's reply.
//   - The accent is a raw colour, not a theme key: theme keys are Claude's palette, and the point is to look
//     like something that is not Claude. A mid-tone violet keeps its contrast on light and dark themes; with no
//     colour at all the glyph and the bold wordmark still carry the mark.
//
// Pure: no `$`, no state, no I/O — the mods pass in their surface's element table and render argument.

import type { BoxProps, ElementConstructor, RenderChildren, RenderSurface, TextProps } from 'claude-code'

export const BRAND = {
  glyph: '✦',
  name: 'bespunky',
  /** Violet-500: distinct from Claude's clay, readable on light and dark. */
  accent: '#8b5cf6',
} as const

/** The wordmark: `✦ bespunky`. */
export const WORDMARK = `${BRAND.glyph} ${BRAND.name}`

/** A plain-text status entry or toast, marked as the toolkit's: `✦ <text>`. */
export function brandLine(text: string) {
  return `${BRAND.glyph} ${text}`
}

/** A drawn site's title: `✦ bespunky · <mod>`, or the wordmark alone. */
export function brandTitle(mod?: string) {
  return mod === undefined ? WORDMARK : `${WORDMARK} · ${mod}`
}

/** Cells a band's brand gutter takes from its row: the wordmark and the gap after it. */
export const BAND_GUTTER_CELLS = WORDMARK.length + 1

/** The two elements every surface's table carries, which is all the frame draws with. */
export type BrandUi = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }

/** The parts of a `ui.render` argument the frame reads: where it draws, and how wide. */
export type BrandSite =
  | { surface: RenderSurface; component: 'AbovePrompt'; props: { bodyColumns: number } }
  | { surface: RenderSurface; component: 'Pane'; props: { bodyColumns: number; placement: 'dock' | 'inline' } }

export type BrandFrameProps = {
  /** `$.ui.resolve(e)`, the surface's own elements. */
  ui: BrandUi
  /** The render argument `e` itself. */
  site: BrandSite
  /** The mod's short name for a pane's title (`standing`); a band shows the wordmark alone. */
  mod?: string
  children?: RenderChildren
}

/**
 * The toolkit's frame for a drawn site. A band: one blank row down from the transcript, the wordmark in a
 * gutter, the mod's rows beside it. A pane: the branded title over a dim rule (the rule on the terminal only —
 * the other surfaces frame their panes natively, and a rule of box-drawing glyphs is a terminal idiom), then
 * the body; one blank row down when seated inline under the transcript.
 */
export function BrandFrame({ ui, site, mod, children }: BrandFrameProps) {
  const { Box, Text } = ui
  const columns = site.props.bodyColumns

  if (site.component === 'AbovePrompt') {
    return (
      <Box flexDirection="row" gap={1} marginTop={1}>
        <Text color={BRAND.accent} bold>
          {WORDMARK}
        </Text>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {children}
        </Box>
      </Box>
    )
  }

  const title = brandTitle(mod)
  const rule = site.surface === 'terminal' ? Math.max(0, columns - title.length - 1) : 0

  return (
    <Box flexDirection="column" gap={1} marginTop={site.props.placement === 'inline' ? 1 : 0}>
      <Box key="brand-title" flexDirection="row" gap={1}>
        <Text color={BRAND.accent} bold>
          {title}
        </Text>
        {rule > 0 && <Text dimColor>{'─'.repeat(rule)}</Text>}
      </Box>
      {children}
    </Box>
  )
}

/**
 * A thin dim rule between items of a list, sized to the site (`columns` cells). On the terminal a line of
 * `─`; elsewhere a one-row gap does the same job without a glyph the surface's font may not tile.
 */
export function BrandDivider({ ui, site, columns }: { ui: BrandUi; site: BrandSite; columns?: number }) {
  const { Box, Text } = ui
  const width = Math.max(0, columns ?? site.props.bodyColumns)

  return site.surface === 'terminal' ? (
    <Text dimColor wrap="truncate-end">
      {'─'.repeat(width)}
    </Text>
  ) : (
    <Box height={1} />
  )
}

/**
 * A toolkit command's output row in the transcript: `✦ bespunky · <command>` in the accent, then the text the
 * command answered. `text` is the row's own (`e.props.text`); `plugin` is the answering plugin's manifest name
 * (`$.plugin.name`), whose `name: ` lead — the engine's attribution of a hook-answered row — the brand replaces.
 */
export function BrandCommandRow({ ui, command, text, plugin }: { ui: BrandUi; command: string; text: string; plugin: string }) {
  const { Box, Text } = ui
  const lead = `${plugin}: `
  const body = text.startsWith(lead) ? text.slice(lead.length) : text

  return (
    <Box flexDirection="row" gap={1}>
      <Text color={BRAND.accent} bold>
        {brandTitle(command)}
      </Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor>{body}</Text>
      </Box>
    </Box>
  )
}
