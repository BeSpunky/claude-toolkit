---
name: stage-the-vision
description: The visual architect of the experience-design trio — it takes a Vision (the feeling, from `envision-the-experience`) and invents the bold, concrete, web-native *artistic moments* that turn that feeling into something you'd screenshot, then hands them to `realize-the-vision` to build. This is the creative engine that grounding alone can never supply: grounding stops a design going generic or garish, but it contains no move for *making art*. Use whenever you move from a feeling/Vision toward real visual design; when a screen should be striking, cinematic, immersive, or artful rather than competent-and-dead; when you must invent the hero moment, the scroll-driven spectacle, the thing that makes someone stop; or the moment a design risks coming out as generic boxes or a reflexive trend. The one move — **stage the feeling as bold web-native moments, and stay at the ART level**: speak the web's expressive language (parallax, cinematic scroll, a character that turns to camera, a living/generative background, type-as-image, depth and light and reveal choreography) but describe *what artful thing happens and how it feels*, never how to build it (no libraries, no CSS, no performance — that is `realize`'s job). It works the altitude ladder deliberately: `envision` speaks pure feeling with zero web words ("a warm room where the light turns as you walk deeper"); **this skill** speaks web-native art ("the room is a parallax background that deepens on scroll; a lion's face fills the hero and turns to meet your eyes as you descend"); `realize` speaks engineering ("pinned section, scroll-driven image sequence, reduced-motion fallback, perf budget"). Because a model is not a native visual artist, it gets to art not by "being creative" but by **inventing several bold concepts and choosing the most striking-yet-true, stealing from specific great real work (award-winning sites, real art/design) and adapting its moves, composing with real craft (focal point, scale, negative space, the cinematic moment), decomposing each moment to physical truth (light, shadow, material, colour, depth, form, texture as they REALLY behave — refusing the lone primitive that only symbolizes a phenomenon: warm light is never just a gradient), and sourcing genuinely artful assets** — all judged by an **outside eye for beauty** (never self-certified), grounded in reality so it's not generic, and restrained so it's not garish (**bold ≠ loud**). Produces **the Staging** — a bold central concept + concrete described moments (like shots, each staged across form factors, mobile-first — the moment re-staged for a phone, not shrunk) + a visual system (palette, type, composition/structure, motion language) — confirmed at low fidelity before high-fidelity build. Replaces the earlier `direct-the-look`; the middle member of the trio `envision-the-experience` → `stage-the-vision` → `realize-the-vision`; an expression of `architect-mentality` (model the missing concept, compensate for your materials' weaknesses, go the extra mile) and `architecture-first` (confirm the design before building).
---

# Stage the Vision

A Vision says what a screen should *feel* like. A build makes it real. Between them is the act neither performs and grounding never reaches: **turning the feeling into something artful — a striking, web-native image you'd stop and screenshot.** That act is *direction* — the work of a production designer, a director of photography, an art director who stages a scene. This skill is that visual architect.

It earns the word *stage*. It does not decide colours-and-type-and-don't-be-trendy (that discipline is a floor it stands on, not its purpose). It **invents the spectacle**: the hero moment, the scroll-driven reveal, the cinematic beat, the living background — the bold artistic ideas that make an interface *art* instead of competent furniture. Then it hands those moments to `realize-the-vision`, which engineers them.

The Vision is the feeling. The Staging is the *art*. The build is the means.

---

## The one move: stage the feeling as bold web-native moments — and stay at the art level

Everything reduces to a single act performed at a single, deliberate altitude. **Invent the striking, web-expressible moments that carry the feeling — and describe what artful thing happens, never how to build it.**

This altitude is the whole skill. Pitch too high and you've just restated the Vision ("a calm, warm place") — nothing buildable, no art. Drop too low and you're doing the engineer's job ("a `position: sticky` hero with a GSAP timeline") — and the art dies in the mechanics. **Stay exactly in between: web-aware, but art-level.**

### The altitude ladder

| Rung | Who | Language | The same idea, at each rung |
| --- | --- | --- | --- |
| **Feeling** | `envision` | sensory, *zero* web words | "a warm room where the light turns as you walk deeper" |
| **Web-art** | **this skill** | web-native, but *art-level* | "the room is a parallax background that deepens as you scroll; the light shifts from dusk to dawn; a figure resolves from silhouette to clarity as you descend" |
| **Build** | `realize` | engineering | "layered parallax on scroll progress, gradient lerp via CSS custom property, masked reveal, reduced-motion fallback, perf budget" |

`envision` may not say "parallax." `realize` decides "ScrollTrigger vs. scroll-timeline." **Only this skill invents "the lion turns to camera as you scroll"** — the artful, web-aware, screenshot-worthy *moment*. Speak in moments like that: *what you see, what artful thing it does, how it feels* — in the web's vocabulary (scroll, depth, motion, reveal, light), with the *how-to-build* left untouched.

---

## Why this needs more than grounding — the generative engine

Grounding (the floor this skill stands on) prevents the *bad*: it anchors to reality so the look isn't generic, and stops drift into trends and garish saturation. But grounding is **subtractive** — it removes wrongness. Art is **additive** — it requires invention grounding contains no recipe for. A perfectly grounded, perfectly restrained screen can still be dead.

And here is the honest constraint: **a model is not a native visual artist** — that's the very weakness that produced the generic boxes to begin with. So this skill does not get to art by telling the model to "be creative" (that fails). It gets there by leaning on **external excellence**, the same way grounding leans on external reality — four moves:

1. **Invent bold concepts, then choose.** Generate *several daring* visual ideas for the feeling — the central image, the hero moment, the organizing metaphor made visual — deliberately risky, not safe. Then pick the most striking one that is *still true* to the feeling. One safe idea can only be competent; several bold ones give you something to reach for.
2. **Steal from great work.** Study *specific* exemplary pieces — real award-winning sites, real graphic design, real art — and reverse-engineer the moves that make them stop you, then adapt them. The model can't originate at that level; it *can* adapt real excellence. (See `reference/stealing-from-great-work.md`.)
3. **Compose with real craft.** A striking screen has a dominant focal point, dramatic scale contrast, negative space used as a *material*, tension, rhythm, a *moment* of surprise, type wielded as image, cinematic framing and pacing. This is teachable. (See `reference/composition-and-cinematic-staging.md`.)
4. **Use the web as expressive material, and source what you can't compose.** Motion as choreography, depth and light and colour as emotion, scroll as time, interaction as delight — the web's native art palette (`reference/the-web-as-art-medium.md`). And where a moment needs genuine art the code can't make (a hero illustration, a generative piece, a real character), *source or generate it*, directed by the Staging — don't hand-code from weak taste (`realize`'s build-vs-source).

All of it judged by an **outside eye for beauty** — never self-certified (`reference/grounding-restraint-and-the-taste-gate.md`) — and held to one discipline so it never reswings into the garish:

> **Bold ≠ loud.** The striking screen is usually *restrained* — one strong concept, masterful composition, disciplined colour — not maximal effects. Spectacle for its own sake is the same failure as a card grid, in a louder costume. Reach for the *bold and true*, render it with *restraint*.

---

## Decompose to physical truth — render the real thing, not a primitive

Inventing a bold moment is not enough; it has to be rendered with **fidelity**, and that is where most designs quietly die. A model names a phenomenon and reaches for the nearest token — "warm light" → a gradient, "depth" → a box-shadow, "glass" → a flat fill. The token *symbolizes* the thing but never *is* it; a gradient with no physics behind it never looks like real light.

The artist's move is the opposite: **decompose the thing into its real constituents and reconstruct each from how it physically behaves.** What *is* warm light? A low warm source from one side, long shadows the colour of the cool sky, warm bounce on the surfaces facing it, a specular glint on anything glossy, a glow in the air near the source. Describe *that* — a painter's brief — and the Staging becomes buildable into something that reads as real. This holds for every phenomenon a moment contains: light, shadow, material, colour-under-light, depth, form, texture.

The gate is sharp: **if you collapsed a real phenomenon to a single primitive, stop and decompose it.** A primitive may appear *inside* a faithful reconstruction (a gradient as one layer of a real light build), never as the lone stand-in. And stay at the art level — the physical *truth and how it looks*, not the CSS; `realize` reproduces it with coordinated layers under one coherent light model, a shader, or a *sourced real asset* (a photograph of real light beats any gradient). Depth: `reference/decompose-to-physical-truth.md`.

---

## Reconcile with the use — the ping-pong

A staged moment can be breathtaking and *miserable to use* — a scroll-jacked hero that fights the thumb, a transition that delays every tap, an artful nav nobody can find, a spectacle that buries the thing the user came for. Beauty is only half of great design; the **use** is the co-equal other half. So a concept is not done when it's striking — it's done when it's striking **and** astonishing to use.

This is a **ping-pong with `astonishing-to-use`, not a one-way check.** Pressure each moment against the use (does this make the user work, wait, guess, hunt, or fight?), then **re-conceive** to dissolve the friction *without going generic* — the best resolutions make the art *carry* the function (the cinematic reveal *is* the navigation; the beautiful transition *covers* a real load; the bold hero *contains* the primary action). Volley until both are great. The mission sets who leads (utility → use leads; brand/art → concept leads, then pressure-tested) — but it is always a loop, and you **never** sacrifice the use to protect the art (outside a declared pure-art piece). See `astonishing-to-use` (and its *reconciling art & use* cluster).

---

## The Staging — what this skill produces

**The Staging** is the artifact: a creative, web-native, art-level spec the builder can realize and two builders would realize recognizably the same. It carries:

- **The concept** — the one bold organizing visual idea, the world made into an image. The thing the whole screen serves.
- **The moments** — concrete, *described* striking beats, like shots: *what you see, the artful thing it does, how it feels,* in web-native terms. ("Cinematic hero: a lion's face fills the frame; as you scroll it slowly turns to meet your eyes, and the room behind it warms from dusk to dawn.") Each carries its **phone and wide-screen staging** (re-staged across form factors, not shrunk) **and its physical decomposition** — the light model, materials, depth, and texture as a painter's brief, never a lone primitive. These are what `realize` engineers, one by one.
- **The visual system** — palette (grounded, limited, on a contrast budget), type (as voice *and* as image), composition/structure principles, the motion language and its budget, light/depth/colour as emotion, ornament level. (Structure, *not* skin — genericness lives in the skeleton; reskinning boxes as blobs changes nothing.)
- **The references** — the real work it's grounded in and adapting from.
- **Confirmation** — explored at low fidelity, judged by an outside eye for beauty, committed *before* the high-fidelity build (`architecture-first` in the design layer).

It still names no engineering — no libraries, no CSS, no performance budget. It says *what the art is*; `realize` chooses *how to make it*.

---

## How to stage a vision

1. **Read the feeling** and the Vision's five beats; name the one feeling the art must carry. The anchor beat tells you the app's real surfaces and moments — those are the stages you have to dress; never stage a moment the app doesn't have, or skip a surface it does.
2. **Find the bold concept** — the single striking visual idea that *is* this feeling. Generate several daring options; choose the most striking-yet-true. Don't settle for the first safe one.
3. **Invent the moments** — in web-native art language, the concrete beats that deliver the concept across the screen/scroll: the hero, the reveal, the transition, the living detail. Describe each like a shot.
4. **Compose and stage each moment** — focal point, scale, negative space, the surprise, the framing and pacing. Direct the *structure*, not just the skin. And **stage it across form factors, mobile-first**: the phone is the hard canvas most of the audience uses, so the moment must hold — or *transform* — there, not just shrink (a wide hero may become a full-bleed portrait; a pointer interaction needs a touch-native form).
5. **Decompose each moment to physical truth** — break its real phenomena (light, shadow, material, colour, depth, form, texture) into how they *actually behave*, as a painter's brief; refuse any lone primitive ("warm light" is never just a gradient). This is what makes a moment read as *real* rather than symbolic.
6. **Ground it and steal from great work** — anchor in real references (and any existing identity, when present); study and adapt specific great pieces so the moves are excellent, not invented from priors.
7. **Restrain it** — *bold ≠ loud*: one concept, limited palette, disciplined effects. Cut anything that serves spectacle instead of the feeling.
8. **Explore at low fidelity; let an outside eye judge for beauty** — 2–3 distinct directions, cheap, compared; the user (or an honest comparison to great work) chooses. Never self-certify the art.
9. **Confirm and hand off** — commit the Staging, then give it to `realize-the-vision`, which engineers each moment, choosing technical means from its reference clusters.

---

## Reference library

The SKILL above is the method; the references are the craft. Read only the cluster you need.

| Cluster | Reference | Covers | Serves (architect-mentality) |
| --- | --- | --- | --- |
| **The web as an art medium** | `reference/the-web-as-art-medium.md` | the vocabulary of web-native artistic moves — parallax & depth, cinematic scroll sequences, hero & character & 3D moments, generative/living backgrounds, type-as-image, reveal & transition choreography, video/imagery as scene, light/colour/depth as emotion — described at art level, each pointing to `realize`'s technical cluster for the *how* | Compensate for weaknesses · Lead with one mental model |
| **Inventing the concept** | `reference/inventing-the-concept.md` | translating a feeling into a bold central image; the "screenshot moment"; generating several daring options and choosing the striking-yet-true; metaphor made visual | Go the extra mile · Model the missing concept |
| **Decompose to physical truth** | `reference/decompose-to-physical-truth.md` | the painter's physics — how light, shadow, material, colour-under-light, depth/atmosphere, form, and texture *really behave*; decomposing a moment into them and describing it with fidelity; the gate that refuses the lone primitive (warm light → a gradient) | Place everything on purpose · Compensate for weaknesses |
| **Composition & cinematic staging** | `reference/composition-and-cinematic-staging.md` | focal point, scale contrast, negative space as material, tension, rhythm, type-as-image; cinematic framing, the moment, pacing across scroll; rearchitect structure, never reskin; **staging across form factors** (mobile-first re-composition, the moment's phone form, touch vs pointer) | Place everything on purpose · Design for the consumer |
| **Stealing from great work** | `reference/stealing-from-great-work.md` | studying specific exemplary sites/art/design, reverse-engineering what makes them striking, adapting the moves; why adaptation beats origination for a model | Compensate for weaknesses · Build for the goal |
| **Grounding, restraint & the taste gate** | `reference/grounding-restraint-and-the-taste-gate.md` | grounding in reality (and existing identity when present), bold ≠ loud restraint, limited palette/contrast budget, low-fidelity exploration, the outside eye judging for beauty, no self-certification | Design for the consumer · Know when not to do it |

---

## Ask yourself

- Have I invented a **bold concept** and **concrete striking moments** — the "what you'd screenshot" — or only restated the feeling / picked a safe layout?
- Am I at the **right altitude**: web-native but *art-level* ("the lion turns to camera as you scroll"), not pure feeling ("something dramatic") and not engineering ("a pinned ScrollTrigger section")?
- Did I **generate several daring options** and choose the striking-yet-true — or settle for the first safe idea?
- Did I **steal from specific great work** and adapt its moves, or invent from my own (weak) visual priors?
- Did I **compose with craft** (focal point, scale, negative space, the moment) and direct the **structure**, not just the skin?
- Is it **bold but not loud** — one concept, restraint, a limited palette — or spectacle reswinging toward garish?
- Did I **stage each moment across form factors, mobile-first** — so it holds or *transforms* on a phone (with a touch-native form for any pointer interaction) — or only for desktop, to be shrunk?
- Did I **decompose each moment to physical truth** (light, shadow, material, depth, form, texture as they really behave) — or **collapse a real phenomenon to a lone primitive** (warm light → a gradient, depth → a box-shadow, glass → a flat fill)?
- Did I **ping-pong each moment against the use** (`astonishing-to-use`) — re-conceiving where the art taxes the user (scroll-fighting, transition delays, hidden nav, buried action) so it's striking **and** effortless — or just make it beautiful and assume it's usable?
- Did I let an **outside eye judge it for beauty** at low fidelity, or am I about to **self-certify** the art and ship it?
- Is each moment described so `realize` can engineer it — concrete, web-native — while I left the *how* (libraries, CSS, perf) to `realize`?

## Red flags

- **Restating the Vision instead of staging it** — "a warm, calm place" with no concrete artful moment; the altitude pitched too high, nothing buildable, no art.
- **Dropping into engineering** — specifying libraries, CSS, or performance; doing `realize`'s job and losing the art in the mechanics.
- **The safe first idea** — one competent concept, never pushed; no daring options generated, nothing striking chosen.
- **Inventing from priors instead of adapting great work** — "being creative" from the model's head, which is exactly what produced the generic boxes.
- **Reskin mistaken for art** — new paint (blobs, gradients) on the same generic skeleton; structure never directed.
- **Bold becoming loud** — spectacle, maximal effects, garish saturation chasing "striking"; the card-grid failure in a louder costume.
- **Designing only for desktop** — no phone staging conceived, so the moment breaks or cramps when shrunk onto the screen most people actually use.
- **Symbolic substitution** — a real phenomenon (light, depth, material, texture) collapsed to a single primitive (a gradient, a box-shadow, a flat fill) with no physical model behind it; the reason "warm light" never looks like warm light.
- **Beautiful but taxing to use** — a moment that fights the thumb, delays the task, hides the action, or impresses once and annoys forever, shipped with no ping-pong against `astonishing-to-use`. Striking is only half; the use must be astonishing too.
- **Self-certified art** — declaring the moments "stunning/cinematic" with no outside eye and no low-fidelity comparison.
- **Hand-coding the art that should be sourced** — a hero illustration or character forced out of code/weak taste instead of generated, licensed, or commissioned and directed by the Staging.

---

> **Origin.** This skill replaces the earlier `direct-the-look`, which framed the missing middle as *grounding* — anchoring the look in real references and confirming it. Grounding turned out to be necessary but not sufficient: it prevents generic and garish results but contains no move for *making art*. The real gap was an **artistic engine** — the visual architect who invents the bold, web-native moments that turn a feeling into something striking. This skill is that engine; it keeps grounding, restraint, and the taste gate as the *floor* it stands on, but its heart is generative. (`architect-mentality` — *model the missing concept*; *compensate for your materials' weaknesses* — a model's weak visual origination is answered by adapting great work and an outside eye, not by "being creative.")

> **Related.** The middle of the trio: `bespunky-product-ux:envision-the-experience` (the *feeling* — the Vision) → **`bespunky-product-ux:stage-the-vision`** (the *web-native art* — the Staging) → `bespunky-product-ux:realize-the-vision` (the *build*). The three sit on one altitude ladder — feeling → web-art → engineering — each speaking its own rung's language. A direct expression of `bespunky-engineering:architect-mentality` — *model the missing concept*, *compensate for your materials' weaknesses* (lean on great work and the outside eye, not the model's taste), *place everything on purpose* (every moment serves the one feeling), *go the extra mile* (the bold concept over the safe one), *know when not to* (bold ≠ loud) — and governed by `bespunky-engineering:architecture-first` (confirm the Staging before building). `realize-the-vision` engineers each staged moment, choosing technical means from its clusters and sourcing genuine art where the bar is real; verify the built result against the Staging and the feeling with the `browser-automation` plugin — never by the model's self-judgment alone.
