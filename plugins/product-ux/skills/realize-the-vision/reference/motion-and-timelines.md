# Motion & timelines

How things move, enter, leave, and transition over time. Motion is the most common way a static page becomes a *living place* — and the easiest place to introduce jank and vestibular harm. Choose the lightest means that honors the feeling.

## The means

| Means | What it's for | Strengths | Cost / caveats |
| --- | --- | --- | --- |
| **CSS transitions** | State changes (hover, open/close, enter/leave) | Free, declarative, runs on the compositor when you animate `transform`/`opacity`; cheapest possible | Can't sequence or orchestrate; no mid-flight control; hard to coordinate many elements |
| **CSS keyframe animations** | Looping/ambient motion (a slow drift, a pulse, a shimmer) | Free, GPU-friendly, no JS; perfect for "the world breathes" | Fixed timeline; awkward for interactive/interruptible motion |
| **Web Animations API (WAAPI)** | Programmatic CSS-grade animation from JS | Native, no dependency, compositor-eligible, playback control (pause/reverse/seek), `Animation` objects you can compose | Lower-level ergonomics; orchestration is manual; older-browser polish varies |
| **Motion** (fka Framer Motion) | Declarative UI motion in React; state-driven enter/exit, layout animations, gestures | Best DX for component motion, `AnimatePresence` for exit, automatic FLIP layout animations, springs; hybrid engine uses native/compositor where possible | React-centric (a vanilla `motion` core exists); bundle (~tens of KB); easy to over-animate |
| **GSAP** | Precisely-timed sequences, timelines, complex/brand/narrative motion, SVG and canvas, anything framework-agnostic | The professional standard; rock-solid `timeline()` orchestration; now **free including all formerly-paid plugins** (ScrollTrigger, MorphSVG, etc.); framework-agnostic | Imperative — must be wrapped behind a seam and cleaned up; runs on the main thread (manage carefully); overkill for one fade |
| **View Transitions API** | Animating *between states/pages/routes* — the whole UI morphs as one | Built-in, gorgeous shared-element transitions with little code; same-document widely supported, cross-document (MPA) in Chromium | Newer; needs fallbacks where unsupported; choreography of complex transitions still maturing |
| **FLIP technique** | Animating layout changes (reorder, resize, move) smoothly | Turns expensive layout changes into cheap transforms; the trick behind buttery list reordering | Manual unless your lib does it (Motion's `layout`, GSAP's Flip plugin do) |

## How to choose

- **One or two state changes** → CSS transitions. Don't reach for a library to fade a modal.
- **Ambient, looping life** ("it drifts, it breathes") → CSS keyframes (+ reduced-motion guard).
- **Interruptible, interactive, gesture-driven UI motion in React** → Motion.
- **A choreographed sequence, a timeline, brand/narrative motion, or framework-agnostic control** → GSAP timelines.
- **The whole view morphing between two states/routes** → View Transitions API (with a fallback).
- **Smooth layout/reorder** → FLIP (via Motion `layout` or GSAP Flip).

## Caveats & footguns

- **Animate compositor-only properties** — `transform` and `opacity` stay off the main thread. Animating `width/height/top/left/margin/box-shadow` triggers layout/paint every frame and janks. See `performance-and-budgets.md`.
- **Always honor `prefers-reduced-motion`** — gate large motion, offer a fade/instant alternative. Non-negotiable. See `accessibility-reduced-motion-and-fallbacks.md`.
- **JS animation runs on the main thread** — a blocked thread = dropped frames. Keep work off the hot path; prefer compositor properties even from JS.
- **Easing carries the feeling** — linear feels mechanical; the right cubic-bezier/spring *is* the personality. Match easing to the Vision (a playful overshoot vs. a calm ease-out are different worlds).
- **Don't over-animate** — motion everywhere is the box-and-text failure in a costume. Every movement must earn its place by serving the one feeling.

## The platform as a motion engine — before reaching for JS

Much of what people reach for a library or a scroll listener to do is now **native CSS**, running off the main thread. Prefer these real engines over a JS approximation:

- **Typed, animatable custom properties** — `@property --x { syntax: '<number>'; inherits: false; initial-value: 0 }` makes a custom property *interpolatable*, so you can animate gradients, angles, and derived values that plain variables can't.
- **Scroll- and state-driven CSS** — `scroll()`/`view()` timelines, `animation-timeline`, and `timeline-scope` tie motion to scroll position or element visibility with **no JS scroll listener** (see `scroll-and-cinematic.md`).
- **Hand-authored springs and math** — author a spring as a `linear()` easing (sampled keyframes) instead of pulling in a physics lib; use `sin()`/`cos()`/`pow()` in `calc()` for organic, looping, or staggered motion.
- **Pointer-reactive properties** — feed pointer position into custom properties and let CSS react (a spotlight, a tilt, a parallax that follows the cursor) without a render loop.
- **`mask-composite`** — isolate a single border ring or compose masks for reveal/gradient-border effects in pure CSS.
- **View Transitions API** — continuity between states/routes as one morph (above).

The rule: research the **native** engine for the motion the Staging calls for before adding a dependency or a scroll handler — the platform is usually both lighter and smoother.

## On the house stack (Angular / Nx)

- Modern Angular leans on **native CSS + Web Animations API**; `@angular/animations` is comparatively heavy and de-emphasized — reach for it only when its trigger/state ergonomics genuinely fit.
- **Router-level View Transitions are built in:** `provideRouter(routes, withViewTransitions())` animates route changes with the native API.
- **Wrap GSAP/imperative engines behind a seam** (`engineering:angular-native-wrappers`): create/kill in a directive or service, run animation outside Angular (`NgZone.runOutsideAngular`) to avoid change-detection thrash, and clean up on destroy (`gsap.context()` + `DestroyRef`/`ngOnDestroy`). Never let the library leak across the component boundary.

## When NOT to

- When a **single CSS transition** would do — don't add a dependency.
- When the feeling is **stillness** — a memorial, a calm utility. The truest motion is sometimes none.
- When motion would **fight orientation** — see `keep-users-oriented`; motion must clarify, never disorient.
