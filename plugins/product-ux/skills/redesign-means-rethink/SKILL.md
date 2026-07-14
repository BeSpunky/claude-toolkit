---
name: redesign-means-rethink
description: When you are asked to REDESIGN a UI — a layout, screen, page, component, flow, or whole interface — it means a complete creative *reconception from scratch*, not modifying, restyling, or skinning what already exists. The existing implementation has **zero design authority**: you do not read it to inform the new design, and you should not even look at it before conceiving the new one. Use the moment a request carries redesign intent — "redesign this", "rethink this layout", "reimagine this screen", "redo this page", "start over on this", "this looks dated/old, redesign it", "this isn't what I imagined", "this isn't what I asked for", "make it completely different", "from scratch" — or any ask for a fresh design of something that is already built. The bug this prevents is **anchoring**: reading the old code or layout "to understand it" and then preserving its structure and reskinning it, tweaking incrementally, and calling that a redesign — which is exactly what a redesign is NOT. The one move: treat the request as a blank canvas. What still has authority is the *intent and the requirements* — what the thing is FOR, its data and its functionality — which you take from the user and the spec, never reverse-engineered from the old layout. Reconceive the FORM; honor the PURPOSE. Enter the experience-design trio from scratch (`envision-the-experience` for the feeling/intent → `stage-the-vision` for the bold new art → `realize-the-vision` to build it). The ONLY time you read the existing code is *after* the new design exists, to plan what to clean up, overwrite, or migrate — and to confirm what functionality must survive — never to seed the design. (Counterpart caution: a *targeted tweak* — "move this button", "change this colour", "fix this spacing" — is NOT a redesign; don't blow up a small change into a full reconception. This skill is for redesign intent, not every edit.) The entry gate to the trio; an expression of `architect-mentality` (go the extra mile, build for the goal not the brief) and paired with `architecture-first` for building the new design cleanly and removing the old.
---

# Redesign Means Rethink

When someone asks you to **redesign** something, they are not asking you to *change* what exists — they are asking you to **conceive it anew.** A redesign is a blank canvas. The thing on the screen today — old, wrong, or simply not what they imagined — is the very thing being thrown out. Treating it as a starting point is the one mistake that guarantees the redesign fails.

This skill exists because the reflex runs the other way: asked to redesign, a model **reads the existing code "to understand it," and is immediately anchored** — it preserves the old structure, restyles the same boxes, makes incremental tweaks, and presents that as a redesign. It is not. It is the old design, wearing new paint. The toolkit already refuses *rearchitect-don't-reskin* (structure) and *re-stage-don't-shrink* (responsive); this is **rethink-don't-reskin** (the whole design).

---

## The one move: blank canvas — reconceive the form, honor the purpose

**Treat a redesign request as a from-scratch creative act.** The existing implementation has **zero design authority**. Do not read it to inform the new design. Do not even look at it before you have conceived the new one. Its layout, its components, its visual choices — none of it constrains you, because *all of it is what you are replacing.*

Two things keep this honest:

- **What has authority: the intent and the requirements.** A redesign still has to serve the real purpose — what the thing is *for*, the data it shows, the functionality it provides, the human who uses it. You get that from the **user and the spec** (and the *feeling* the redesign is reaching for), **not** by reverse-engineering the old layout. Reconceive the **form**; honor the **purpose**. "Ignore the existing code" never means "ignore what the thing needs to do."
- **The existing code is a teardown target, not a seed.** There is exactly one reason to read it, and it comes *after* the new design exists: to plan what to **clean up, overwrite, or migrate**, and to confirm what functionality must survive the change. Reading it *first*, "to understand the current design," is the anchoring trap — skip it.

So the order is: **conceive the new design from intent → then look at the old code to decide what to delete and replace.** Never the reverse.

---

## How a redesign runs

A redesign is a fresh run of the experience-design trio, entered from the top:

1. **`envision-the-experience`** — start from the feeling and the intent, from scratch. What should this *be*, for this human, in this moment? Not "what is it now, improved" — what is it, reimagined. (The existing screen does not appear in this step.)
2. **`stage-the-vision`** — invent the bold, web-native art for the new vision. A genuinely new set of moments, not the old ones restyled.
3. **`realize-the-vision`** — build the new design. *Now* the existing code matters: build the new cleanly and **remove or replace the old** — no orphaned layers, no dead components, no half-migrated mess (`architecture-first`). The redesign isn't done until the old design is gone, not buried under the new.

---

## Know when it's *not* a redesign

The counterweight (`architect-mentality` — *know when not to*). A **targeted change** is not a redesign, and must not be inflated into one:

- "Move this button," "change this colour," "fix this spacing," "make the text bigger," "tweak this state" → a precise modification. Do exactly that; do **not** reconceive the screen.
- "Redesign this," "rethink this," "reimagine this," "this isn't what I imagined," "start over," "make it completely different" → a redesign. Blank canvas.

When the intent is ambiguous, ask one question — "a fresh reconception, or a targeted change?" — rather than guessing wrong in either direction (nuking a screen that needed a tweak is as much a failure as skinning one that needed a rethink).

---

## Ask yourself

- Did I read the existing code/layout **before** conceiving the new design — letting it anchor me — instead of starting from a blank canvas?
- Am I **reconceiving from intent** (what this is *for*, the feeling, the requirements), or **modifying what exists** (preserving its structure, restyling its boxes)?
- Could I describe the new design **without referring to the old one at all**? If not, I'm probably still anchored.
- Have I confused "ignore the existing **code**" (correct) with "ignore what the thing **does**" (wrong)? The purpose and functionality still have full authority.
- Am I reading the old code only to plan **cleanup/overwrite/migration** *after* the new design exists — or did I read it to *seed* the design?
- When I build it, am I **removing the old design**, or leaving it half-replaced under the new?
- Is this actually a redesign, or a **targeted tweak** I'm about to over-blow into a full reconception?

## Red flags

- **Reading the existing implementation first** on a redesign request "to understand it" — the anchoring trap.
- **Reskinning** — same layout, same component structure, new colours/spacing/fonts — presented as a redesign.
- **Incremental tweaks** to the existing screen dressed up as a fresh design.
- A new design you **can't describe without reference to the old one** — a sure sign it's a modification, not a reconception.
- **"Ignore the code" taken too far** — breaking functionality or dropping data the thing must still provide.
- **The old design left behind** — dead components, orphaned styles, two layouts coexisting after the redesign ships.
- **Over-applying** — nuking and reconceiving a screen when the user asked for a small, targeted change.

---

> **Related.** This is the **entry gate** to the experience-design trio: a redesign runs `bespunky-product-ux:envision-the-experience` → `bespunky-product-ux:stage-the-vision` → `bespunky-product-ux:realize-the-vision` from scratch. It expresses `bespunky-engineering:architect-mentality` — *build for the goal, not the brief* (a "redesign" points at a reconceived outcome, not a modified artifact) and *go the extra mile* (the fresh design over the easy reskin) — and pairs with `bespunky-engineering:architecture-first` for the build half: realize the new design cleanly and remove the old, so the redesign leaves one coherent design, not a patched-over one. It shares its DNA with the toolkit's other anti-anchoring moves — *rearchitect-don't-reskin* (structure) and *re-stage-don't-shrink* (responsive): **rethink-don't-reskin** (the whole design) — and with its styling twin, ***re-token, don't re-hardcode*** (`bespunky-design-system:design-system-first`): the new *look* must land as a change to **design tokens**, not to a thousand component files. If it can't — if the redesign forces you to touch every component — then the design system is the thing that needs redesigning first, and you are looking at the itemized bill for every value that was ever hardcoded.
