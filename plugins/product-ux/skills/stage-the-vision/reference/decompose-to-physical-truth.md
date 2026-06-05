# Decompose to physical truth

The move that separates an artist from a model reaching for the nearest token. An artist does not *symbolize* a thing with a primitive — they **decompose it into its real constituents and reconstruct each from how it physically behaves.** "Warm light" is not a gradient; it is a *phenomenon* with a source, a direction, a colour temperature, shadows that fall a certain way and carry a certain colour, bounce, a glint on glossy things, a glow in the air. Rebuild *that* and it reads as light. Reach for the gradient and it never will, because nothing physical is behind it.

This cluster is the painter's physics — the dimensions you decompose a moment into, and how each truly works — held at the **art level** (a painter's brief, what is *physically true and how it looks*), never at the engineering level (gradients, CSS, shaders — that is `realize`'s job to *reproduce* what you decomposed).

*(The examples below — light, glass, a building — are illustrations of the move, not the subject. Apply the decomposition to whatever a moment actually contains.)*

## The gate: refuse the primitive

The failure to catch, every time: **a real phenomenon collapsed to a single token.**

| The phenomenon | The lazy primitive (refuse it) | What it actually is (decompose) |
| --- | --- | --- |
| Warm light | a warm gradient | a directional warm source + cool falling shadows + bounce + a specular glint + air-glow |
| Depth | a `box-shadow` | overlap + cast/contact shadow + atmospheric falloff + scale + focus |
| A material (glass, metal, skin) | a flat fill | how *that* surface returns light — specular, reflection, Fresnel, subsurface |
| A 3D object | an outline or an emoji | a form read through light wrapping it; or a sourced/rendered real thing |
| Texture | nothing (perfectly flat) | micro-variation, grain, wear, unevenness |
| Atmosphere / distance | lower opacity | contrast loss + cooling + detail loss |

**If you wrote "warm gradient" for warm light (or any row above), stop and decompose.** A primitive may *appear* inside a faithful reconstruction (a gradient can be *one layer* of a real light build) — but never as the lone stand-in for the phenomenon.

## The dimensions you decompose into

**Light.** Where is the source — direction, height, distance, *size* (big source = soft shadows, small = hard), colour temperature (warm/cool), intensity? One key, maybe a fill and a rim. Brightness falls off fast near the source (and a bright source blooms/glows). Light is the master variable — almost everything else follows from it.

**Shadow.** Falls *opposite* the light; its length and angle come from the source's height. Its softness comes from the source's size and distance. **Shadows are not black** — they carry the ambient/sky colour, and under a warm light they go *cooler* (the complementary). The most-missed truth in amateur work is shadow *colour*. And the **contact shadow** (darkest, tightest where two surfaces meet) is what *grounds* an object — without it, things float.

**Material.** Every surface is read through *how it returns light*. Matte/diffuse: soft, even. Glossy: a sharp specular highlight (a little reflection of the source). Metal: coloured reflections, no separate white highlight. Glass/transparent: reflection *and* refraction, more mirror-like at grazing angles (Fresnel), clearer head-on. Skin: subsurface scattering — light glows warm through thin edges. Water: reflection, refraction, caustics. Name the material, then describe how it catches the light you defined.

**Colour under light.** Lit planes take the light's colour; shadows take the ambient/complementary — so **warm light makes cool shadows**, and that warm/cool interplay is much of what makes light *read*. Coloured surfaces throw **bounce** onto their neighbours (a red wall reddens a nearby cheek). Saturation peaks in the midtones; highlights wash toward the light's colour, deep shadows desaturate — never a uniform saturation everywhere.

**Depth, perspective & atmosphere.** Perspective (eye level, vanishing points, foreshortening; things shrink with distance). **Atmospheric perspective** — distant things lose contrast, lighten, cool/blue, lose detail — is the strongest depth cue after overlap. Add overlap/occlusion, relative scale, and focus falloff (depth of field). Think in foreground / mid / background planes.

**Form.** A form is read through *value gradation across it* — highlight, light, the terminator, core shadow, reflected light — not an outline. Volume is how the light wraps the shape. A flat fill reads flat; the modelling is the form.

**Texture & imperfection.** Real surfaces have micro-variation, grain, wear, slight unevenness. **Perfectly clean, flat, uniform reads as synthetic and cheap** — it's a big reason a bare gradient feels fake. A little noise, edge wear, and tonal variation bring life.

**Coherence — one light model.** The single most important fidelity check: **does everything in the scene agree on where the light is?** One consistent set of sources; all shadows consistent in direction, softness, and colour; all materials responding to the same light. Inconsistency is exactly what makes an image read as a fake collage.

## How to decompose a moment

1. **Name the real phenomena** in the moment — the light, the material of the hero object, the depth of the space, the texture of the ground.
2. For each, ask **"what is this, physically?"** — where's the light, how does this material respond, what does real depth do here.
3. **Decompose into the dimensions above** and describe each with fidelity — a painter's brief, in words a painter would use.
4. **Check coherence** — one light model across the whole moment.
5. **Hand the decomposition to `realize`** as part of the Staging, so it can reproduce each part faithfully (layered build with a coherent light model, a shader, or a *sourced real asset* — `realize`'s build-vs-source: a photograph of real light beats any gradient) — never a lone primitive.

## Stay at the art level

You describe what is *true and how it looks* — "a low warm sun from the left; long shadows the colour of the cool sky; a hot specular line where it grazes the glass; warm bounce lifting the right-side shadows; haze softening the far wall." You do **not** specify gradients, CSS, or shaders — that is `realize` reproducing your decomposition. The painter reasons about the light; the builder mixes the paint.

## Pitfalls

- **Symbolic substitution** — the lone primitive for a real phenomenon (the gate above).
- **Black, colourless shadows**, and no warm/cool interplay — the deadest tell.
- **Floating objects** — no contact shadow grounding them.
- **Flat fills for real materials** — no specular, Fresnel, subsurface, or reflection.
- **Uniform saturation** — colour not shifting across light, shadow, and bounce.
- **No atmospheric depth** — distant things at full contrast and detail.
- **Outline-thinking** — a form drawn as a shape, not modelled through light.
- **Surgically clean surfaces** — no texture or imperfection, so it reads synthetic.
- **An incoherent light model** — elements lit from different, contradictory sources.
- **Decomposition drifting into engineering** — specifying CSS/shaders here instead of the physical truth; leave the *how* to `realize`.
