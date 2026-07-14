# Cheap Stand-Ins — the fidelity dial in practice

A mock has exactly one job: **make the concept judgeable by eye.** Everything you add past that point is the build, started early, without permission.

But the concepts worth judging are exactly the expensive ones — the cinematic scroll, the 3D room, the living background, the hero lit by real warm light. You can neither *render* them (hours, and it is `realize`'s job) nor *drop* them (strip the atmosphere and the user rejects a concept they never actually saw).

The move is the third option: **suggest it.** Find the cheapest artifact that makes the atmosphere unmistakable, and stop there.

---

## The governing question

For every element in the Staging, ask:

> **Does the verdict depend on this?**

- **Yes** → it must be visible, at the cheapest fidelity that still reads. (The concept's one screenshot-worthy thing is *always* a yes.)
- **No** → stub it, flatten it, or cut it.

And then the second question, for everything that survived:

> **What is the cheapest thing that reads as this?**

Not "what is a faithful version of this" — *what reads as this, from five feet away, in five seconds.*

---

## The catalogue

### Scroll-driven cinematics

The concept: *"the room deepens as you scroll; the light turns from dusk to dawn; a figure resolves from silhouette to clarity."*

- **Default:** render **the single most striking frame**, still. The peak of the sequence — the shot you would have used in the pitch deck. One screen, no scroll logic.
- **If the *change* is the concept** (the transformation itself is what you are asking about): render **two frames side by side** — the "before" and the "after" — under a caption like *"scrolls from this → to this"*. The user reads a transition from two stills instantly. They do not need the interpolation.
- **Only if the motion itself is on trial:** one crude CSS transition or `@keyframes`. No easing craft, no scroll library, no pinning. It exists to say *"it moves, roughly like this"*.

**Never:** a scroll library, a pinned timeline, a scroll-driven image sequence, a real easing curve. That is `realize`'s cluster and it will eat your afternoon.

### 3D and spatial scenes

The concept: *"a room you look into; foreground, mid-ground, background; you can feel the depth."*

- **Default:** fake the depth flat — **layered planes** (a few absolutely-positioned layers), **scale** (near things large, far things small), **blur and desaturation** on the far layer (atmospheric falloff), a slight vertical offset for perspective. Depth is 90% composition; you get most of it for free.
- **A step up, still cheap:** a single generated or sourced **still of the scene** — a render, a photo, an AI image with the right vantage — dropped in as the background. One asset, no engine.
- **If parallax is the point:** a crude `transform: translateY()` on two layers driven by scroll. Ten lines. Done.

**Never:** a WebGL engine, a scene graph, a model, a camera rig, a shader. Not one line of three.js in a mock.

### Generative / living backgrounds

The concept: *"the background is alive — embers drift, the field breathes, the noise shifts."*

- **Default:** **one static snapshot** of what it would look like at a good moment. A layered gradient mesh, a noise texture, a scattering of dots placed by hand. The user is judging the *look of the field*, and a still shows it.
- **If the aliveness is the concept:** the cheapest possible motion — a slow CSS `@keyframes` drift on a handful of elements, or a single animated gradient. It says "alive"; that is all it needs to say.

**Never:** a particle system, a canvas render loop, a real noise implementation, a shader.

### Physical light, material, depth

The Staging (rightly) refuses the lone primitive: *warm light is never just a gradient.* That gate governs **the build**. It does not govern the mock.

- **In a mock, the shortcut is allowed** — a layered gradient, a big soft `box-shadow`, a tinted overlay, a blurred radial glow. It only has to *read* as that light from five feet away.
- **Better and equally cheap:** a **sourced photograph** with the real light in it. A real photo of warm evening light beats any approximation you could hand-build, and costs one download.
- Keep the *decomposition* in the Staging document, where `realize` will read it. The mock is not where that fidelity is proven — the mock is where the user decides whether they want that light at all.

This is the one place the mock is *deliberately* less honest than the build, and it is worth naming out loud when you present it: *"the light is faked here; the real thing is built properly."*

### Motion and micro-interaction

- **Default: cut it.** Stills. A mock is a photograph of a design, not a film of it.
- Keep motion **only** when the motion *is* the question ("should the cards fan out or stack?"). Then: one crude CSS animation, un-tuned.
- Never build hover states, focus rings, transition choreography, or easing systems. Nobody approves a concept because of its easing curve.

### Real illustration, photography, characters

The concept calls for a hero illustration, a photoreal couple, a character that turns to camera. `realize` will source or generate it properly, with licensing and art direction.

- **In the mock: a stand-in that holds the right place, weight, and mood.** A sourced placeholder photo with the right feeling, a silhouette, a soft-edged block of the right colour and size, a free stock image that is roughly right.
- What matters is that the composition is honest: *the art goes here, it is this big, it dominates this much, it is this colour temperature.* That is what the user is judging.
- **Label it.** "Placeholder — the real hero is commissioned/generated." An unlabelled cheap stand-in makes the user reject the *concept* for the *placeholder's* sins.

**Never:** hand-coding figurative art into SVG path-soup. It is bad in the build (`realize` says so) and it is worse here, because it is slow *and* bad.

---

## Dummy content that reads like life

This is the one place you should spend a *little* care, because it is what makes a mock read as a screen instead of a wireframe — and it is nearly free.

- **Plausible, specific, real-textured.** Not "User Name" and "Item 1" — *Maya Okonkwo*, *Dinner at Fiorella's*, *₪248.00*, *3 days ago*, *"can't wait to see you"*. Specific fake data makes a design look real; generic fake data makes everything look dead.
- **Real-world messiness.** One long name that nearly wraps. One empty avatar. One item with no description. A number with four digits next to one with two. Designs die on the edge cases, and a mock full of perfectly-sized content lies to the user about how the design behaves.
- **Enough of it.** A list with three rows and a list with twenty rows are different designs. Fill it to a realistic density.
- **Identical across every variant.** *This is the rule that makes comparison honest.* Same cast, same records, same photos, same numbers, in every mock — so the only variable the eye sees is the design. Write the content once; paste it into each variant.
- **Never lorem ipsum, never grey boxes.** A design nobody can read is a design nobody can judge, and it flattens three distinct concepts into three identical wireframes.

---

## What to cut first (in order)

When a mock is running long, cut in this order — and stop as soon as it is judgeable:

1. **Anything interactive.** Buttons, forms, hovers, states. Dead is fine.
2. **All secondary motion.** Transitions, reveals, micro-interactions.
3. **Every screen but the one being judged.** A flow is not a mock; the charged moment is.
4. **Every state but the loaded one.** No empty/loading/error states — those are `astonishing-to-use` and `realize`'s concern.
5. **Fidelity of the heavy moment** — drop from real render → to a still → to an approximation. Keep the *presence*, drop the *quality*.

## What may never be cut

- **The concept's one screenshot-worthy thing.** Whatever `stage-the-vision` said you'd stop and screenshot — the hero, the metaphor made visual, the striking composition — must be *visible*, at whatever crude fidelity survives. Cut it and the user is voting on an empty box.
- **The atmosphere.** Palette, type, light, density, mood. It is what distinguishes concept A from concept B, and it is what the user is actually choosing between.
- **The phone view.** The Staging is mobile-first; a concept judged only on desktop is a concept judged on the screen most users will never see it on.
- **Readable content.** See above.

---

## The two failure ends — how to catch yourself

| Over-rendered | Under-rendered |
| --- | --- |
| You are tuning easing curves | All three concepts look the same |
| You installed a package | The screen is grey boxes and lorem ipsum |
| You are sourcing the *final* asset | You cannot tell what the concept even was |
| A variant has taken over ~20 minutes | The atmosphere is gone; only layout remains |
| You are fixing breakpoints | You cut the hero because it was hard |
| **→ You are building. Stop and ship it.** | **→ You are asking for a verdict on nothing. Put the concept back in, cheaply.** |
