---
effort: mock-harness-space
summary: The mock-to-choose harness gives the mock the screen (collapsible chrome, fit modes, presentation mode) and becomes properly accessible.
---

# Decisions (recorded as made, 2026-10-06)

## Layout
- **One viewport, three rows.** The app is a `100dvh` grid (slim top row · stage · slim bar) with ONE column clamped to `minmax(0, 1fr)`. Found by observation: an `auto` column let the top row's min-content widen the app past the window, and focusing the mock then shifted the page sideways. The stage owns grid row 2 explicitly so presentation mode (which hides the rows around it) gives it the whole window.
- **The drawer overlays, the rail docks.** The comment drawer is absolutely positioned over the viewer's right edge, so opening it never re-fits (shrinks) the mock; the rail is a real grid column because it is narrow (88px) and its thumbnails are navigation you want beside the mock. Both collapse; drawer defaults closed, rail defaults open (at 1280×800 Desktop is height-limited, so the rail costs nothing).
- **Top-row overflow** — the row wraps only when its *controls* no longer fit (the question has a 0 basis and truncates; its full text is repeated atop the "Faked" popover). "What's faked" became **"Faked (n)"** to keep one row at 1280px. Below 900px the question hides.
- **Bottom bar** keeps Comment, the decision group, the live dot and the tally; **Submit review (N)** appears only while drafts exist; auto-send / copy / clear moved into a `role="menu"` (⋯) with arrow-key navigation.

## Fit
- **Fit = width AND height, never upscaled** (`min(1, aw/w, ah/h)`). Road not taken: letting Fit enlarge a mock past its own pixels (a Phone at 1920×1080 could reach ~1.14). Rejected because the reviewer judges proportions and density, and an enlarged mock lies about both — **flag for the human** (it means Desktop at 1920×1080 sits at 1.0 using ~49% of the window, not more).
- **Width** = `min(1, aw/w)` scrolling the height; **1:1** = scale 1 scrolling both. The viewer (not the page) scrolls, so there is never a double scroll.
- Scale is recomputed by a `ResizeObserver` on the stage and viewer (window resize, rail toggle, presentation), not by `resize` alone; shown as e.g. "86%", with the design size in its title; exposed in `mockState().scale`.

## State homes
- URL hash unchanged (where the user is). **Fit, rail, drawer, auto-send** are per-viewer preferences behind one guarded `pref` helper (localStorage in try/catch, defaults when absent). **Pins hidden and presentation are session-only** — a forgotten "pins hidden" across reloads would read as "my comments vanished". Nothing new went into the hash: none of these is a place someone shares.

## Keys
- ONE `KEYS` table drives the handler AND the `?` sheet (plus a FRAME_KEYS list for keys the mock frame owns), so the sheet cannot drift from behaviour.
- Escape closes the top-most thing, one press at a time: open popover/menu → comment mode → presentation → drawer. Modal dialogs own their own Escape.
- Keys never fire while typing (input/textarea/select/contenteditable), while a modal is open, or while the composer/inline edit is open. Arrows inside a control that owns them (segmented groups, menu, rail tablist, drawer) stay theirs.
- Keys pressed inside the mock iframe are forwarded by review.js as `mk:key` (keydown never reaches the parent) — except when the frame owns them (crosshair, comment mode, a pinned popover's Escape).

## Frame side (review.js / review.css)
- review.css owns the whole harness palette as `--mk-*` tokens (dark + light, every text pair ≥ 4.5:1, computed); the gallery consumes them and defines only layout tokens. `--faint` fixed (was ~3.9:1). Comment pins now use dark text on orange (white was ~2.4:1).
- **Removal is owned by the gallery**: the frame posts `mk:remove {n}`; the gallery deletes and offers Undo — one undoable path for drawer, pin button and `Delete` key. Standalone (no host) the frame deletes itself.
- **Keyboard comment placement**: a crosshair appears (and takes focus) only when comment mode is entered by keyboard (`c`, or the Comment button activated by keyboard — `click.detail === 0`); arrows 8px, Shift 48px, scrolls at the edge, the target element is outlined and announced (debounced), Enter opens the composer through the SAME `commentAt(x, y)` the click path uses.
- Known risk, accepted: chrome type inside a mock frame is rem-based, so a mock that sets `html { font-size: 62.5% }` shrinks the composer text with it. Rem was the brief's rule; a frame-local px root would contradict it.

# Review round (2026-10-06, after the adversarial review)

All 13 findings were fixed; none declined.
- **Focus survives every rebuild by design, not by patch.** Every control the harness rebuilds carries a stable, page-unique `data-ctl` (`reveal-3`, `hist-v1`, `rail-current`, `nav-prev`, `vp-desktop`, …). `render()` and the drawer refresh share one `captureFocus` / `restoreFocus`, which keeps focus on the same control or falls back to the region's own fallback (row → neighbouring row → drawer close; rail → current item). The drawer also skips its rebuild when what it shows didn't change (a signature on the drawer body), so a poll tick never touches the DOM.
- **The URL: pushState, not a guard.** Writes go through `history.pushState`, which fires no event, so `popstate` hears only real navigations. The old "last-written hash" guard is what swallowed Back → Forward; with no self-events it isn't needed.
- **The host declares its keys** (`mk:host-keys`), so the frame forwards a key, and suppresses its default, only when the gallery will act on it. Before this, the frame guessed with a hard-coded list.
- **Crosshair focus return**: the frame gives focus back to what had it in the frame. Failing that, it reports `returnFocus` and the gallery restores the control that sent focus in (the Comment button). Focus never lands on a hidden node.
- **The question is the protagonist of the top row** (orchestrator's call, adopted): it owns the flexible space, is clamped to two lines, and has a real *more* button (not a hover tooltip). Below 900px it gets a line of its own. To make room, fit / rail / pins / presentation / shortcuts moved into ONE **View** menu whose trigger shows the live scale ("View 85% ▾"). Cost: the top row grew from 41 to 51px, so Desktop Fit at 1280×800 is 0.848 (was 0.86). Accepted, because the question being legible outranks 1.2% of scale. Road not taken: icon-only toggles, which save width but leave meaning to tooltips.
- **Decision** is status text (`role=status`) plus a separate *View it* button, never a disabled half-opacity button. **Compare cards**: a stretched real button opens the card; *Choose* is its sibling. **Toast**: `visibility:hidden` when hidden, it pauses while hovered or focused, and it returns focus. **Exit presentation**: solid and fully opaque.
- **Tokens**: `--mk-line-strong` is ≥ 3:1 on every surface (dark #716b8f, light #857da3). In the light theme `--mk-comment` is #b84f0c with white `--mk-on-comment` (5.05:1). `.mk-sr` and `.mk-kbd` in review.css are the single owners of visually-hidden and key-cap styling.
