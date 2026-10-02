# Depth, 3D & spatial

When the Vision asks for a *space* — real depth, an object you turn, a scene you move through, light that falls. The most immersive family of means, and the most expensive. Reach for it only when flat layering can't carry the feeling, and own its lifecycle ruthlessly.

## The means

| Means | What it's for | Strengths | Cost / caveats |
| --- | --- | --- | --- |
| **CSS 3D transforms** (`perspective`, `rotateX/Y`, `translateZ`) | Faux-depth: tilting cards, parallax layers, a gentle 3D lean | Free, compositor-friendly, no WebGL; carries a *surprising* amount of depth-feeling cheaply | Not a real scene — no shared lighting/occlusion; breaks down past simple layering |
| **three.js** | Real 3D scenes, models, shaders, particle worlds | The de-facto WebGL engine; vast ecosystem; WebGPU renderer available | Large bundle; imperative; you own the render loop, memory, and teardown; steep |
| **React Three Fiber (R3F)** | three.js declaratively in React | Components map to scene graph; `drei` helpers; reconciler manages the tree | React-only; still three.js underneath (same perf/teardown realities) |
| **angular-three (NGT)** | three.js declaratively in Angular | The Angular analog to R3F — signals-based, idiomatic; the path to 3D when the project wears Angular | Smaller ecosystem than R3F; still three.js underneath |
| **Babylon.js** | Game-grade 3D, built-in physics/XR | Batteries-included engine; strong tooling | Heavier; more than most UI needs |
| **Spline / Rive (3D-ish)** | Designer-authored 3D/interactive scenes embedded | Designers build it; you embed; fast path to richness | Runtime weight; less control; vendor format |
| **Raw WebGL / WebGPU + shaders (GLSL/WGSL/TSL)** | Bespoke visual effects, generative GPU art, custom materials | Total control; GPU-parallel; the most singular looks | Hardest; you write the pipeline; fallbacks/perf are on you |

## How to choose

- **A tilt, a lean, parallax depth** → CSS 3D transforms. Don't load WebGL for a hover tilt.
- **A real object/scene in React** → R3F. **…in Angular** → angular-three (NGT). **…in Vue / Svelte** → TresJS / Threlte.
- **A heavy interactive/game-like world** → three.js directly or Babylon.
- **A designer already built the scene** → Spline/Rive embed.
- **A singular GPU effect no engine gives you** → custom shaders (WebGL/WebGPU). Budget time.

## Caveats & footguns

- **3D is a budget decision.** It ships a big bundle, taxes the GPU, drains battery, and punishes mid-range phones. Justify it by the feeling; verify on real low-end devices. See `performance-and-budgets.md`.
- **Own the lifecycle.** A WebGL context, geometries, textures, and the `requestAnimationFrame` loop must be explicitly disposed on teardown or you leak GPU memory and burn CPU on dead scenes. This is the #1 3D bug.
- **Pause when unseen.** Stop the render loop when the canvas is offscreen/tab hidden (IntersectionObserver / `visibilitychange`).
- **Accessibility is yours to provide.** A WebGL canvas is opaque to screen readers and keyboards. Provide a real semantic alternative (text, controls) and meaningful focus — the canvas is decoration over a usable core. See `accessibility-reduced-motion-and-fallbacks.md`.
- **Reduced motion still applies.** Auto-rotating/drifting 3D can sicken; offer a still or user-driven mode.
- **WebGPU is rising but not universal** — feature-detect and fall back to WebGL.
- **Loading has weight** — models/textures need a graceful, in-world loading moment (tie to `keep-users-oriented`), not a frozen blank canvas.

## On your stack

- **Wrap the engine behind a seam.** A three.js scene is an imperative engine: it lives in one owned unit (a component, hook, directive, or service — whatever your framework's seam is) that **creates** it, **disposes** every geometry/material/texture/renderer on teardown, and exposes a small declarative surface to the rest of the app. Where a declarative binding exists for your framework (React-Three-Fiber, angular-three, TresJS for Vue, Threlte for Svelte), prefer it for scenes that fit the framework's reactivity.
- **Run the render loop outside the framework's change detection / render cycle**, so sixty frames a second never trigger sixty re-renders.
- **SSR guard:** WebGL exists only in the browser — create the scene only once you are client-side.
- Keep heavy 3D assets and code in their own **lazy-loaded boundary** (in an Nx workspace, its own library) so the rest of the app isn't taxed (`bespunky-engineering:nx-monorepo-and-dx`).

**Angular adapter** — when the project wears Angular (its `HOUSE.md` stamp lists `angular` in `layers=`):

- Prefer **angular-three (NGT)** for declarative scenes that fit Angular's signals/change detection.
- If using **three.js directly**, wrap it per `bespunky-angular:angular-native-wrappers`: the scene/loop lives in a directive/service, runs `runOutsideAngular`, and disposes everything in `ngOnDestroy`/`DestroyRef`.

## When NOT to

- When **CSS 3D or layered 2D** carries the depth-feeling at a fraction of the cost — usually true.
- When the audience is **mobile-heavy or low-end** and the budget can't hold it — find a lighter expression of the same feeling.
- When 3D would be **spectacle for its own sake** — depth must serve the one feeling, not impress.
