# Drawing: SVG, canvas & generative

When the Vision asks for *drawn* things — a shape that isn't a rectangle, a hand-painted feel, a living illustration, particles, a generative texture, a bespoke chart. This is how you escape boxes-and-text at the level of *form itself*. The sunflower-menu lives here.

## The means

| Means | What it's for | Strengths | Cost / caveats |
| --- | --- | --- | --- |
| **SVG** | Crisp vector shapes, icons, illustrations, custom forms, morphing paths, line-drawing | Resolution-independent; in the DOM so it's stylable, animatable, **accessible** (title/desc, focusable), and inspectable; pairs with CSS/GSAP/SMIL | Many nodes = DOM cost; very high element counts get slow (use canvas) |
| **CSS-only shapes** (`clip-path`, `border-radius`, gradients, `mask`) | Non-rectangular elements without assets | Free, compositor-friendly, no markup overhead | Limited to what clip/mask express; complex art → SVG |
| **Canvas 2D** | Many moving elements, particles, freeform drawing, pixel effects | Fast for thousands of sprites; immediate-mode; lightweight vs WebGL | A pixel bitmap — **no DOM, no accessibility, no built-in hit-testing**; you redraw every frame |
| **WebGL / WebGPU** | Tens of thousands of elements, GPU shaders, generative GPU art | Massive parallelism; singular looks | Hardest; see `3d-spatial-and-webgl.md` |
| **Lottie** | Designer-authored vector animations (After Effects → JSON) | Designers own the motion; you drop it in; scalable | Runtime weight; large JSON; can be heavy if abused; control is limited |
| **Rive** | Interactive, state-driven vector animations with a real-time runtime | Interactive state machines (respond to input/state), smaller/faster than Lottie for interaction | Vendor format/runtime; designers need Rive |
| **p5.js / generative toolkits** | Sketch-like generative/creative coding, particle systems, procedural art | Fast to prototype expressive, living visuals; seeded randomness for reproducibility | Bundle + main-thread; production-harden and respect motion/perf |

## How to choose

- **A custom shape or two** → CSS `clip-path`/`mask`/gradients.
- **Crisp, stylable, accessible illustration / morphing form / line-draw** → SVG. *(The non-rectangular "menu" — petals, paths, orbits — is usually SVG.)*
- **Hundreds–thousands of moving particles / freeform paint** → Canvas 2D.
- **Tens of thousands / GPU shader art** → WebGL/WebGPU.
- **A designer handed you an animation** → Lottie (playback) or Rive (interactive).
- **Generative/procedural living texture** → p5 or custom canvas/shader, with a fixed seed for reproducibility (see `anthropic-skills:algorithmic-art`).

## Caveats & footguns

- **SVG is accessible; canvas/WebGL are not.** In SVG, add `<title>`/`<desc>`, roles, and focusability for meaningful graphics. For canvas/WebGL, provide a **parallel accessible layer** (real DOM controls, text) — the drawing is the skin over a usable core. See `accessibility-reduced-motion-and-fallbacks.md`.
- **Pick SVG vs canvas by element count and interactivity.** Few, interactive, stylable, accessible → SVG. Many, fast, throwaway pixels → canvas. Crossing ~hundreds of animated nodes, SVG's DOM cost shows.
- **Generative ≠ random-each-load.** Seed the PRNG so a look is reproducible, tunable, and reviewable.
- **Respect reduced motion and performance.** Particle systems and looping generative art must throttle/pause off-screen, cap particle counts on weak devices, and offer a still fallback.
- **Lottie/Rive weight.** Audit JSON/asset size; lazy-load; don't ship a 2MB animation for a checkmark — a tiny SVG/CSS tick is truer and lighter.
- **Crispness:** size SVGs by the box, mind `viewBox`; for canvas, scale the backing store by `devicePixelRatio` or it blurs on retina.

## On the house stack (Angular / Nx)

- **Inline SVG** binds naturally to templates/signals — animate via CSS or a wrapped GSAP timeline.
- Wrap **canvas/p5/Lottie/Rive** runtimes behind a directive/service (`bespunky-engineering:angular-native-wrappers`): own the draw loop, `runOutsideAngular`, dispose on destroy.
- For data-driven drawing, keep generation pure and **derive** the visual from a single source of truth (`bespunky-engineering:software-design`).

## When NOT to

- When a **real photo/video or a simple CSS shape** says it better — don't hand-draw what a medium already gives you.
- When **canvas** would throw away accessibility you actually need — prefer SVG/DOM.
- When a **heavy Lottie** is replacing what a few bytes of SVG/CSS would do.
