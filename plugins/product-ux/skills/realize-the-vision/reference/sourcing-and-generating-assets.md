# Build vs. source: sourcing & generating assets

Code is one material; acquired assets are another. The craftsman knows the boundary of what code (and an LLM) builds *well* and sources the rest from where it's made well. This cluster is the field knowledge for that second path — when to acquire, from where, and how to do it without a legal, quality, or tonal disaster.

## The decision: build or source

| Build in code when… | Source / acquire when… |
| --- | --- |
| Systematic, parametric, data-driven, generative pattern | Figurative or photoreal (a person, a couple kissing, an animal, a face) |
| Interactive, stateful, responsive, themeable | Richly illustrative or painterly; a specific art style |
| Geometry, abstract form, charts, UI controls, motion | A real photograph, film footage, or cinematic moment |
| Simple iconography you can express cleanly | Production-grade craft code can't match (photography, motion design) |
| Must scale, recolor, or stay in sync with logic | Hand-coding it would be ugly path-soup or unmaintainable |

The tell: if hand-coding it would be a *heroic effort with an ugly result* — the classic LLM-draws-a-person failure — stop and source it. `architect-mentality` principle 11 (compensate for your materials' weaknesses) and 14 (know when not to).

## The acquisition channels

| Channel | What it's for | Strengths | Caveats |
| --- | --- | --- | --- |
| **AI image generation** | Bespoke, on-style, novel stills (the kiss in *your* style, a unique hero) | Infinite specificity; fast; matched to the Vision and Look | Artifacts (hands, faces, text, anatomy); hard to keep a *set* consistent; **IP/ownership murky & jurisdiction-dependent**; bias; cost; **must review every output** |
| **AI video generation** | Short ambient loops, hero clips, motion impossible to film or code | Striking motion without a shoot | Heavy files; limited length/control; cost; licensing/ownership unclear; review |
| **AI 3D generation** (text/image-to-3D) | Quick props/assets for a 3D scene | Fast rough models | Topology/quality varies; usually needs cleanup; pairs with `3d-spatial-and-webgl.md` |
| **Free stock photo/video** (Unsplash, Pexels, Pixabay) | Real photography/footage at no cost | High quality; generous licenses | Generic/overused looks; licenses still have *terms*; representation & consent of subjects |
| **Paid stock** (Getty, Shutterstock, Adobe Stock, Artgrid) | Premium, specific, rights-cleared media | Quality + clear commercial license + model releases | Cost; license tiers (editorial vs commercial) |
| **Open icon sets** (Lucide, Heroicons, Tabler, Phosphor, Material Symbols) | Consistent UI iconography | Free, coherent, code-friendly SVG | Pick **one** family for coherence; check license (mostly MIT) |
| **SVG / illustration libraries** (SVGRepo, unDraw, Humaaans, openmoji, open illo sets) | Ready vector art & illustration, recolorable to brand | Free, editable, themeable | Per-asset license/attribution varies; watch style coherence |
| **Lottie / Rive marketplaces** (LottieFiles) | Ready vector animation a designer made | Drop-in motion | Weight; per-asset license; must fit the brand/feeling |
| **3D model libraries** (Poly Pizza, Quaternius, Sketchfab) | Ready 3D assets | Saves modeling time | License varies widely (CC0 → attribution → paid); poly/texture budget |
| **Fonts** (Google Fonts, open foundries, variable fonts) | The typographic voice | Free, broad, expressive | Web-embedding license; performance — subset & preload |
| **Audio libraries** (Freesound, free-music archives, paid SFX/music) | Sound beds & cues | Ready audio | License (CC/attribution/commercial); see `sound-and-haptics.md` |
| **Commission a human** (designer/illustrator/photographer/motion designer) | Brand-critical, signature, or sensitive craft | Highest quality; full, clean rights | Time + money — but the honest call when quality, brand, or ethics demand it |

## Caveats & footguns

- **Licensing is not optional, and *free* ≠ *unlicensed*.** Before shipping any asset, verify: commercial use allowed? attribution required? modification/derivatives allowed? redistribution terms? For people: is there a **model/property release**? Track the license and attribution with the asset. Shipping an unlicensed or mis-licensed asset is a legal and trust landmine.
- **AI-generated content has murky IP status.** Ownership and copyrightability of AI output vary by jurisdiction and by the tool's terms of service — and outputs can echo training data. Don't assume you own it or may use it commercially; check the generator's terms; for anything brand-critical or legally exposed, prefer licensed or commissioned work.
- **Review every generated asset — never ship blind.** Check for artifacts (hands, faces, text, anatomy, warped geometry), factual/brand errors, and **bias**. In **sensitive contexts** (a couples app, a grief app, anything about people, bodies, identity, or loss) tone and representation are part of correctness — a wrong or stereotyped image is a real harm, not a cosmetic miss.
- **Art-direct to the Vision's world.** A sourced asset must cohere with the established palette, style, mood, and lighting. An off-brand stock photo betrays the feeling as much as ugly code. Direct your generation prompts and your selection to the world the Vision describes; recolor/grade/crop to fit.
- **Weight is part of the choice.** Raster and video assets are heavy. Compress; use modern formats (AVIF/WebP for images, modern codecs for video); export responsive sizes; lazy-load; give big media an in-world loading moment (`keep-users-oriented`). See `performance-and-budgets.md`.
- **Accessibility travels with the asset.** Meaningful images need honest `alt` text; decorative ones are marked decorative. Don't encode essential meaning in an image alone. See `accessibility-reduced-motion-and-fallbacks.md`.
- **Pin the asset; don't regenerate at runtime.** Generation isn't reproducible — choose once, store the chosen asset as a fixed artifact in the repo/pipeline, and ship *that*. Never call a generator live in the render path.
- **Represent people ethically.** Diversity and dignity in chosen/generated imagery; avoid real-person likeness, deepfakes, and consent problems.

## Compose, don't just drop

The richest results are **sourced + coded**. The couple kissing might be a generated illustration that code then *brings to life*: color-graded to the palette, revealed on scroll, drifting with parallax, masked into the scene, framed by motion the code owns. Source the thing code can't make; code the behavior an asset can't have. (`architect-mentality` — concentrate complexity: the asset is the hard-made part, the motion around it stays simple.)

## On the house stack (Angular / Nx)

- Place assets under the app's assets path; keep large/experience-heavy media in a **lazy-loaded boundary** so first load isn't taxed (`bespunky-engineering:nx-monorepo-and-dx`).
- Optimize in the build pipeline (compression, modern formats, responsive variants) rather than committing giant originals.
- Feed assets to components **through inputs / a clean seam**, so build-vs-source stays an internal decision the component is agnostic to (`bespunky-engineering:software-design`, `bespunky-engineering:angular-native-wrappers`).
- Record each asset's **source and license** alongside it (a manifest or adjacent note) so provenance is recoverable (`architect-mentality` — preserve understanding).

## When NOT to (and when to hand it to a human)

- **Don't generate/source what code makes better** — a parametric, interactive, or themeable thing belongs in code; a one-off generated image of a UI control is the inverse mistake.
- **Don't auto-generate brand-critical or legally/ethically exposed art** — logos, signature illustration, anything about real people or sensitive themes. Flag that a **human designer/illustrator/photographer** should make it; that recommendation *is* the craftsmanly answer, not a failure to deliver.
- **Don't ship anything whose license you haven't verified** — when in doubt, leave it out and say why.

## The rule

**Know the edge of what code builds well, and cross it deliberately.** Hand-coding a kiss into path-soup and auto-generating a logo are the same error from opposite sides. Source what should be sourced, build what should be built, compose the two, verify the license and the tone — and when only a human can reach the quality the feeling needs, say so.
