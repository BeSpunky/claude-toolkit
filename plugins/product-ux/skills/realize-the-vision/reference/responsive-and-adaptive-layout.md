# Responsive & adaptive layout

Engineering the Staging so each moment holds across every viewport, orientation, and input. This is the *build-rung* half of responsiveness — `stage-the-vision` decides how a moment **re-stages** for a phone (the art); this cluster makes it real (the means). The discipline: **fluid and intrinsic by default; breakpoints only for true layout shifts; re-compose, never just shrink.**

## The means

| Means | What it's for | Strengths | Cost / caveats |
| --- | --- | --- | --- |
| **Fluid layout** (flexbox, grid, `fr`, `minmax`, `auto-fit`/`auto-fill`, `min()`/`max()`/`clamp()`) | Intrinsic responsiveness with *no* breakpoints — the layout flexes to space | Robust, cheap, fewer breakpoints to maintain | Won't express a true re-composition on its own |
| **Container queries** (`@container`, `container-type`) | A component responds to *its container*, not the viewport — the modern default for reusable pieces | Components stay correct anywhere they're placed | Needs a container context; newer than media queries |
| **Fluid type & space** (`clamp()`, viewport units, fluid scales) | Type and spacing that scale smoothly between a min and max | Kills dozens of breakpoints; continuous, not stepped | Set sane min/max or text gets too small/large; respect user zoom |
| **Media queries** (`@media` width / orientation) | Page-level layout *shifts* — the points where the composition genuinely changes | The right tool for real structural change | Breakpoint-itis: avoid many arbitrary widths; shift where the *design* breaks, not at device sizes |
| **Responsive images & art-direction** (`srcset`/`sizes`, `<picture>`) | Right *resolution* per device, and **art-direction** — a different crop/image per viewport | `<picture>` is how a moment's phone framing becomes real; saves bytes | Get `sizes` right or you ship the wrong file; art-direction = more assets to produce |
| **Input & interaction media** (`pointer`, `hover`, `any-pointer`) | Adapt to touch vs. mouse — no essential action hidden behind hover; comfortable touch targets (~44px) | Honest cross-input behavior | Hover-only affordances vanish on touch; test both |
| **Mobile viewport & safe areas** (`dvh`/`svh`/`lvh`, `env(safe-area-inset-*)`) | Correct height with shrinking browser chrome; clear of notches/home indicators | Fixes the classic `100vh` mobile overflow bug | `vh` ≠ visible height on mobile — reach for `dvh` |
| **Per-device performance & data** (`prefers-reduced-data`, conditional loading) | Don't ship a heavy 3D/video moment to a weak phone — load the lighter re-staging | Keeps mobile fast; pairs with the moment's fallback | Decide the lighter version *with* the Staging, not silently |

## How to choose

- **Component should adapt to where it sits** → container queries (default for reusable pieces).
- **Type/space should scale** → fluid `clamp()` scales — minimize breakpoints.
- **The composition genuinely changes** (a real re-stage) → a media-query breakpoint *at the point the design breaks*, not at a device width.
- **A moment needs a different crop/image on mobile** → `<picture>` art-direction (this is `stage-the-vision`'s per-form-factor moment, engineered).
- **Touch vs. pointer matters** → `pointer`/`hover`/`any-pointer` media + adequate touch targets.

## Caveats & footguns

- **Re-compose, don't shrink.** The cardinal sin: a desktop layout crammed into a phone. If the Staging called for a phone re-staging, *build that* — a different structure, not a squeeze. Genericness and brokenness both live in the shrink.
- **Mobile-first.** Author base styles for the small screen and add complexity upward (`min-width`) — most audiences are mobile, and it forces the hard canvas first.
- **The `100vh` bug** — mobile browser chrome makes `100vh` overflow; use `dvh`/`svh`.
- **The on-screen keyboard** — focusing an input pops the keyboard and resizes the viewport, shifting the layout. Keep the focused field **visible** (scroll it into view above the keyboard), keep it **editable**, don't let the rest of the layout scramble, and restore on dismiss (the `visualViewport` API helps). A keyboard hiding the field being typed in is a classic failure — `astonishing-to-use`'s continuity cluster.
- **Hover is not universal** — never hide essential actions or info behind `:hover`; provide a touch-reachable path.
- **Touch targets & spacing** — finger-sized hit areas; don't port mouse-precise targets to touch.
- **Breakpoint-itis** — many arbitrary device-width breakpoints are a smell; prefer fluid + container queries and break only where the design demands.
- **Test on real devices and both orientations** — emulators miss touch, momentum scroll, address-bar resize, and notch behavior. Verify in the running app (`browser-automation`).
- **WCAG reflow & zoom** — content must work at 320px-equivalent and under 200–400% zoom without loss (WCAG 1.4.10) — see `accessibility-reduced-motion-and-fallbacks.md`.
- **Heavy moments on weak phones** — a desktop 3D/video spectacle can jank or drain a mobile; load the Staging's lighter re-staging there — see `performance-and-budgets.md`.

## On the house stack (Angular / Nx)

- **CSS-first.** Prefer container queries and fluid CSS over JS breakpoints. Reach for the **CDK `BreakpointObserver`** only when responsive logic must live in TypeScript (e.g. swapping a component, not just styles).
- **`NgOptimizedImage`** gives responsive `srcset`/`sizes`, priority hints, and lazy-loading out of the box; use `<picture>` for true art-direction.
- **`@defer`** can gate heavy below-the-fold or desktop-only moments; combine with the per-device decision so phones never load the spectacle they won't show.

## When NOT to

- When **fluid layout already handles it** — don't add a breakpoint for what `flex`/`grid`/`clamp` does intrinsically.
- When building for **devices the real audience doesn't use** — responsiveness serves the actual context (`envision`'s device-context), not every hypothetical screen.
- When a **moment is genuinely desktop-only or mobile-only** by design — then build the one, and an honest alternative for the other, rather than forcing one layout to do both badly.
