# Performance & budgets

Immersion that stutters betrays the feeling. A 60fps fade beats a 30fps spectacle every time. Performance is not polish applied at the end — it is part of *choosing the means*. This cluster is the craftsman's instinct for keeping the world smooth.

## The frame budget

- **60fps = ~16.7ms per frame** for everything: JS, style, layout, paint, composite. Below 60fps reads as jank. (120Hz displays want ~8ms — headroom matters.)
- The browser pipeline: **JS → Style → Layout → Paint → Composite.** The further down you can stay, the cheaper the frame.
- **Compositor-only properties — `transform` and `opacity` — skip layout and paint.** Animate these and the work runs on the GPU/compositor thread, smooth even if the main thread is busy. This single fact decides most animation choices.

## The rules that keep frames cheap

- **Animate `transform`/`opacity`, never layout-triggering properties** in hot paths. `width/height/top/left/margin/padding/font-size` force reflow every frame; `box-shadow`/`filter`/`background-position` force repaint. Express the *same look* via transforms (scale/translate) and opacity.
- **Avoid layout thrash** — don't interleave DOM reads (`offsetWidth`, `getBoundingClientRect`) and writes in a loop; it forces synchronous reflows. Batch reads, then writes.
- **Use `will-change` surgically** — hint the compositor just before an animation, remove it after. Leaving it on everything wastes GPU memory and backfires.
- **Keep the main thread free** — long tasks block animation. Move heavy work to Web Workers (and OffscreenCanvas for canvas work); chunk/defer non-urgent work.
- **Prefer native scroll-driven animations** over JS scroll handlers — they run off the main thread by design.
- **Cap and adapt** — particle counts, 3D detail, and effect density should scale down on weak hardware; detect and degrade.

## Bundle & load budgets

- **Every library is weight.** Motion (~tens of KB), GSAP (~78KB), three.js (large), Lottie JSON (often big). Justify each against the feeling; **lazy-load** experience-heavy code and assets so the first paint isn't taxed (own Nx boundary — `engineering:nx-monorepo-and-dx`).
- **Don't ship a sledgehammer for a tack** — a CSS transition or tiny SVG often replaces a whole library. Reach for the lightest means that honors the feeling.
- **Assets are part of the budget** — compress textures/models/video; provide modern formats; stream or progressively load big media (with an in-world loading moment — `keep-users-oriented`).

## Never hang the UI; keep the layout stable

Two UX non-negotiables that live at the build layer (the *why* is in `astonishing-to-use`):

- **Never block the main thread.** Long or heavy work runs **async or in a Web Worker / background task** so taps, scrolls, and typing never freeze. Reflect the user's action **optimistically** and reconcile after; pair with `keep-users-oriented` for progress/notify. A frozen UI is a defect, not a wait.
- **Zero layout shift (CLS ≈ 0).** Reserve the correct **position and size** for anything loading (a sized skeleton, fixed image/media dimensions, font fallbacks that don't reflow) so nothing jumps when it lands. Lazy modules show a sized placeholder, never a blank that later shoves the page.

## Measure — don't guess

- Profile with the browser's **Performance panel** and the **FPS/rendering** tools; watch for long tasks, forced reflows, dropped frames.
- **Test on a real mid-range Android phone**, not your dev laptop — it is the device that exposes jank. Throttle CPU (4–6×) and network in DevTools as a proxy.
- Verify in the **running app** (the `browser-automation` plugin / preview tools), with the animation actually playing, on real conditions — not just in isolation.

## On the house stack (Angular / Nx)

- **Run animation loops `outside` Angular** (`NgZone.runOutsideAngular`, or zoneless change detection) so each frame doesn't trigger change detection — a top cause of animation jank in Angular.
- Keep experience-heavy features in **lazy-loaded routes/boundaries**; use `@defer` for below-the-fold immersive blocks.
- Wrap imperative engines with proper teardown so dead scenes don't keep burning frames (`engineering:angular-native-wrappers`).

## When a budget genuinely can't hold the Vision

Refuse the false tradeoff first — the right technique usually buys both richness and 60fps. If it truly can't, **don't ship jank and don't silently gut the feeling**: render the feeling in a lighter form (fewer particles, compositor transforms instead of a shader, a video instead of live 3D) and **surface the tension** with options. The feeling is the contract; its fidelity-of-form bends to the device, on purpose.
