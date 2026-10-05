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

## Decision (2026-10-05)
Asked: fallback-only vs "what an unpinned visitor sees". User: "Go with your recommendation" — no explicit
recommendation had been made, so the model was chosen: **what an unpinned visitor sees**, because the fallback
reading would fix the overwrite while leaving the setting visually inert (and a dark-first design inexpressible).

- `$default-mode: 'system' | <mode>` in the seeded `_tokens.scss`; `theme()` reads it, emits
  `--<prefix>-default-mode`, and emits the OS media blocks only for `'system'`. `theme-overrides()` and `mode()` follow it.
- Runtime reads the custom property back (Angular `ds-default-mode.ts`, neutral `ds-mode.ts`) — the decision is never
  restated in code. `DsRuntimeTheme.setTokens` places unpinned overrides the same way.
- The owned block stays `ds.theme()`; its comment points at the token.
- 0.45.0 migration `carry-default-mode-into-tokens`: carry the effective argument (stock 'light' → 'system'),
  clear it, replace stock-0.44 mechanism files (fingerprint modulo formatting/prefix), report customised ones.
- Road not taken: a `defaultMode` generator option persisted in a house fact file (the reporter's suggestion 1).
  It would put a DESIGN decision in workspace config, away from the tokens the design phase owns, and give the
  runtime nothing to read.
