# Bug 2 — the theme's default mode has no home outside a generator-owned block

Reported by the `our-journey` project (handoff, 2026-10-05): `design-system-styles` re-asserts
`@include ds.theme();` inside its owned marker block on every upgrade, overwriting a hand-edited
`ds.theme('dark')`, "and nothing can override it".

## Confirmed
- The owned block hardcodes `@include ds.theme();` (`design-system-styles/generator.ts`).
- No schema option anywhere carries a mode. The project's choice can only live inside the owned block.

## Finding the handoff did not make
Under the stock `_theme.scss` (unchanged since `ed399a8`), `$default-mode` is only the `:root` FALLBACK.
For a visitor who has not pinned a mode, `@media (prefers-color-scheme: light|dark) :root:not([data-…-mode])`
outranks `:root` (higher specificity) and every real browser reports light or dark. So `theme('dark')`
vs `theme()` should be visually identical for an unpinned visitor — the mixin's own doc says
"call `theme('dark')` and OS-light users still correctly get light".

So the reported "flips dark → light" cannot come from that argument alone under the stock mixin; the
reporter's seeded `_theme.scss` (or tokens) likely differs, or what they actually want is
"dark unless the user chooses", which the current model cannot express at all (it always follows the OS).
The runtime `DsTheme.resolved()` likewise assumes 'system' = the OS.

## Direction (pending the user's call)
The default mode is a DESIGN decision → its home is the design system's seeded `_tokens.scss`, beside `$modes`,
read by `theme()`; the owned block stays argument-free. Open question: what the setting MEANS —
the fallback it is today, or "what an unpinned visitor sees" (`'system'` | a fixed mode), which also
reaches the runtime service.
