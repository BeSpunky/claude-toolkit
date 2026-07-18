# Scroll & cinematic

When the Vision's *arc* is driven by movement through the page — the story unfolds as you scroll, scenes pin and transform, the view changes like a cut between shots. Scroll is the web's most natural timeline. It's also where motion-sickness and jank concentrate, so handle it with care.

## The means

| Means | What it's for | Strengths | Cost / caveats |
| --- | --- | --- | --- |
| **CSS scroll-driven animations** (`scroll-timeline`, `view-timeline`, `animation-timeline`) | Tying an animation's progress to scroll position or an element entering the viewport | Native, runs off the main thread (smooth by design), no JS, no library | Newer — Chromium/Firefox ahead, **Safari lags**; needs a graceful fallback; complex choreography is limited |
| **IntersectionObserver** | Trigger reveals/states when elements enter/leave view | Native, cheap, perfect for "fade/rise in as it appears" | Discrete (enter/leave), not continuous scrubbing |
| **GSAP ScrollTrigger** | Scrubbing, pinning, scoped timelines, snapping, complex scroll choreography | The industry standard for serious scrollytelling; precise; framework-agnostic; now free | Imperative — wrap & clean up; main-thread; must `ScrollTrigger.refresh()` on layout changes; easy to overdo |
| **Lenis / smooth-scroll libs** | Smoothed/eased scrolling for a cinematic glide | Lush feel; pairs with ScrollTrigger | Hijacks native scroll — accessibility/performance risk; can fight assistive tech; use sparingly and test |
| **View Transitions API** | Cinematic *cuts* between routes/states (shared-element morphs) | Built-in, filmic transitions cheaply; Angular router supports it | Support gaps need fallback; complex sequences still maturing |
| **Sticky positioning** (`position: sticky`) | Pinning a scene while content scrolls past — the backbone of many scroll stories | Native, cheap, robust | Limited to sticky semantics; complex pin/unpin → ScrollTrigger |

## How to choose

- **Reveal on appear** → IntersectionObserver (or `view-timeline`).
- **Continuous scrub tied to scroll, native and smooth** → CSS scroll-driven animations (with a fallback for Safari/older).
- **Serious scrollytelling — pin, scrub, snap, sequence** → GSAP ScrollTrigger.
- **A cinematic cut between routes/states** → View Transitions API.
- **A simple pinned scene** → `position: sticky` before any library.
- **A glide/eased scroll feel** → a smooth-scroll lib — only if the feeling truly needs it, and after accessibility testing.

## Caveats & footguns

- **Motion sickness lives here.** Parallax and scroll-jacking are top vestibular triggers. Keep parallax subtle (≈20–30% differential), never hijack scroll without reason, and **always** provide a `prefers-reduced-motion` path that disables scrubbing/parallax and falls back to simple reveals or static content. See `accessibility-reduced-motion-and-fallbacks.md`.
- **Never break the scrollbar contract.** Users must be able to scroll normally, use keyboard (Space/PageDown/Home/End), and land where they expect. Scroll-jacking that traps or fights the user is a defect.
- **Prefer native scroll-driven animations** when support allows — they run off the main thread and stay smooth where JS scroll handlers jank.
- **Recalculate on layout change.** Scroll triggers depend on positions; refresh them on resize, font load, and dynamic content (`ScrollTrigger.refresh()`), or animations fire at the wrong place.
- **Don't gate essential content behind scroll choreography** — content must remain reachable and readable if the effect fails or is disabled.
- **Test on mobile** — touch scrolling, momentum, and address-bar resize behave differently; many desktop scroll effects feel broken on phones.

## On the house stack (Angular / Nx)

- Use **`withViewTransitions()`** in the router for cinematic route changes for free.
- Wrap **ScrollTrigger** per `bespunky-engineering:angular-native-wrappers` — set up in a directive, `runOutsideAngular`, kill triggers on destroy, refresh on relevant changes.
- Prefer **native scroll-driven CSS / IntersectionObserver** for reveals before adding a library.

## When NOT to

- When the content is **task-focused** (a form, a dashboard, a checkout) — scroll spectacle gets in the way; see `keep-users-oriented`.
- When the audience **can't tolerate the motion** or the support matrix can't carry it gracefully.
- When a **native sticky + a fade** already tells the story — don't reach for a scroll engine.
