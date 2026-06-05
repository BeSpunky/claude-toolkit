# The web as an art medium

The architect composes from a palette — not of colours, but of *expressive moves the web can perform*. This is that palette: the web-native ways a feeling becomes a striking moment. Reach for these at the **art level** — name *what artful thing happens and how it feels* — and leave the *how-to-build* to `realize-the-vision`'s technical clusters (noted in the last column).

## The palette of moves

| Move | What it does, as art | Build-level home (`realize`) |
| --- | --- | --- |
| **Parallax & depth** | Layers drift at different rates so a flat screen becomes a *space* with dimension and air. "The room recedes behind her as you scroll." | `scroll-and-cinematic` · `motion-and-timelines` |
| **Cinematic scroll** | Scroll becomes *time* and *camera* — a scene pins and plays: a thing transforms, a story unfolds, the light turns as you descend. | `scroll-and-cinematic` |
| **Hero & character moments** | A face, figure, or object commands the frame and *responds* — "a lion's face fills the hero and turns to meet your eyes as you scroll." The screenshot moment. | `3d-spatial-and-webgl` · `scroll-and-cinematic` · `sourcing-and-generating-assets` |
| **3D & spatial** | A real object you orbit, a space you move through — depth you can feel, not fake. | `3d-spatial-and-webgl` |
| **Generative & living backgrounds** | A field that breathes, particles that drift, flow that never repeats — the world feels alive. *(Trend-risky: mesh/aurora/blobs are clichés — justify it, see the taste-gate cluster.)* | `svg-canvas-and-generative` |
| **Type as image** | Type as the hero, not the caption — vast, composed, kinetic; a headline that *is* the artwork. | `motion-and-timelines` · `svg-canvas-and-generative` |
| **Reveal & transition choreography** | How things *enter* and how scenes *cut* — a cinematic dissolve, a shared element that morphs between views, a line that draws itself. | `motion-and-timelines` (View Transitions, FLIP) |
| **Video & imagery as scene** | Full-bleed footage or photography *is* the world the content lives in — not a thumbnail in a box. | `sourcing-and-generating-assets` · `scroll-and-cinematic` |
| **Light, colour & depth as emotion** | The turning of light (dusk→dawn), warmth blooming, shadow gathering — colour and luminance carrying the emotional beat. | `motion-and-timelines` · `svg-canvas-and-generative` |
| **Ambient motion & micro-interaction** | Subtle, slow life that makes a place feel inhabited; small moments of delight on hover/tap. | `motion-and-timelines` |
| **Pointer & gesture response** | The art reacts to the cursor or touch — a gaze that follows, a surface that tilts, light that trails the pointer. | `motion-and-timelines` · `3d-spatial-and-webgl` |

This list is a prompt, not a menu — combine, subvert, invent. The point is to *think in these expressive terms*, then compose striking moments from them.

## Stay at the art level

The whole value of speaking this palette is that it's **buildable yet still art**. So describe the *moment*, not the mechanism:

- **Art level (here):** "As you scroll into her story, the photograph behind the text slowly sharpens from blur to clarity — like a memory coming into focus."
- **Engineering (`realize`):** "Scrub a CSS `blur()` from 20px→0 on scroll progress with an IntersectionObserver, GPU-composited, reduced-motion shows it sharp."

Name the felt, artful event. The moment you're choosing libraries or writing CSS, you've left this skill.

## Pitfalls

- **Reaching for a move because it's impressive, not because it serves the feeling** — a 3D scene on a grief page, parallax on a tax form. Every move must carry *this* feeling.
- **The generative-background cliché** — mesh/aurora gradients, blobs, breathing pools are a recognizable trend, not originality; only reach for them when the feeling genuinely calls and the references support it (taste-gate cluster).
- **Effect pile-up** — three moves competing in one screen. Usually one strong move, staged well, beats five. *Bold ≠ loud.*
- **Dropping to engineering** — specifying the library/CSS here. Stay at the felt moment; hand the how to `realize`.
- **A move with no fallback thought** — every motion/scroll/3D moment must still read as art (or gracefully reduce) for reduced-motion and weak devices; flag the still-image version of the moment so `realize` honors it.
