# Composition & cinematic staging

A bold concept still has to be *composed* to read as art — and *staged* to unfold over scroll and time. This is the craft that separates a striking screen from a busy one. It is also where genericness actually hides: in the **structure**, not the skin.

## Skeleton vs. skin — direct the structure

The deepest reason a design feels like "a div, a div with rounded corners, a top bar" is its **composition** — how space is divided and how the eye moves — not its colour or corner radius. **You cannot reskin your way out of a generic skeleton.** Blobs over a card grid is still a card grid. So stage the *structure*:

- The reflexive skeletons to refuse on sight: hero-split-plus-two-buttons, the row of N equal cards, top-bar-plus-centered-bands, and their trend-skinned twin, the blob cluster. Equal boxes in a line is almost never the truest structure — only the easiest.
- Derive structure from the concept and the Vision's spatial language. "Doorways seen from an entry hall" is a composition (paths sensed at different depths from a vantage), not three cards. "Received, not navigated" centers a face and a promise and subordinates the ways-deeper — not a nav bar of equal links.

## Escape generic *vertically*, not *horizontally*

The way out of boxy, generic UI is almost never a *bizarre new structure*. Invented weird layouts read as **arbitrary** — creativity performed, not earned. The reliable escape is **vertical**: take the **familiar, needed primitive** the moment actually calls for — a card, a toggle, an accordion, a nav, a select, a loader — and **elevate it with one deeply-mastered technique**, plus genuine character and (where apt) a configurable range. *Depth of craft on a known thing beats novelty of layout.* Mastering the ordinary thing reads as **premium**; inventing an odd thing to seem creative reads as **noise**.

So when a screen feels generic, don't reach sideways for a stranger shape — reach **down** into the one primitive it needs and make *that* extraordinary: the toggle with real physical motion and weight, the accordion whose reveal is choreographed, the select that opens like a considered object. (This is not licence to keep the *generic skeleton* — a flat field of equal cards is still wrong; it's licence to take the *right* primitive and master it rather than swap it for an arbitrary one.)

## Composition craft — what makes a single frame art

- **One dominant focal point.** The eye must land somewhere first, on purpose. Competing equal elements read as generic; a clear focus reads as designed.
- **Dramatic scale contrast.** Big vs. small, not all-medium. Timidity of scale is a top cause of "fine but flat." Let the hero be *huge*; let quiet things be truly quiet.
- **Negative space as a material.** Emptiness is composition, not waste — it creates calm, focus, and luxury. Most over-designed screens are starved of it.
- **Tension & balance.** Asymmetry, off-centre weight, a thing that leans — alive, not a centered stack. Balance the frame deliberately.
- **Rhythm.** The cadence of size, spacing, and density down the page — vary it; monotone rhythm is monotone feeling.
- **Type as image.** Headlines as composition, not labels — scale, weight, placement, a word lifted into the accent. Type is often the strongest art on the screen.
- **The moment of surprise.** One unexpected beat — a break in the grid, a sudden scale jump, a reveal. Art has a *moment*; furniture doesn't.

## Cinematic staging — composing across scroll and time

A screen is moved-through, so compose it like a director, not just a painter:

- **Framing & camera.** Think in shots: an establishing wide, a tight hero, a close detail. What fills the frame, what's cropped, where the "camera" sits.
- **The reveal.** *How* a thing arrives is half its impact — rises, sharpens, draws on, dissolves in. Stage the entrance, don't just place the element.
- **Pacing.** Scroll is your timeline. Where does it breathe (slow, lots of space) and where does it hit (a sudden full-bleed moment)? Vary the tempo; a flat tempo is forgettable.
- **The turn.** The emotional pivot the Vision named (dark→light, closed→open) should *happen* visibly as you move — staged as a transformation, not stated in a sentence.
- **Continuity.** Moments should feel like one film — a consistent visual language across cuts (`grounding-restraint-and-the-taste-gate.md` keeps it coherent), not a reel of unrelated effects.

## Staging across form factors — re-stage, don't shrink

A moment is not staged for "the screen" — it's staged for the *range* of screens the real audience uses (`envision` named them). The reflex failure is to compose for desktop and let it shrink; the striking hero becomes a cramped, broken phone — the same "squished, generic" outcome this skill fights, now caused by *size* instead of taste. So stage each key moment **across form factors**, at the art level (web-native, never CSS — that is `realize`'s `responsive-and-adaptive-layout`):

- **Mobile-first.** Conceive the moment on the *hardest, smallest* canvas first — where most audiences actually are and where the art must still land — then *expand* it to desktop's larger stage. Designing big-then-shrinking loses the phone, the screen that matters most.
- **The moment may *transform*, not just fit.** A three-panel parallax scene on desktop might become a single vertical descent on a phone; a wide hero where a face turns to camera might become a full-bleed portrait that turns as you scroll. Describe the phone's *own* staging — "on mobile, the lion fills the whole portrait frame and turns as you scroll" — not a cropped desktop.
- **Touch has no cursor.** Any moment built on a pointer (a gaze that follows the mouse, a hover reveal, a cursor tilt) needs a *touch-native* form — driven by scroll, tap, or device tilt — or to be gracefully absent. Name it; don't leave the phone with a dead interaction.
- **Orientation & the fold.** Portrait vs. landscape can change the whole composition; say what each is when it matters.
- **Per-device weight is an art decision too.** When a moment is too heavy for a weak phone (a 3D spectacle, full-bleed video), the *lighter* phone staging is yours to design — a still, a simpler reveal — not a silent omission `realize` has to invent. (`bold ≠ loud`, meeting the device.)

- **Every state re-owes the wide frame.** A moment with states (a panel open, a hero playing, a payoff reached, controls collapsed) doesn't compose for the width *once* at rest and let the rest fall back to a phone column. Each state re-composes for the wide canvas — re-filling its opposite region (a reserved quiet lane for status, the hero owning its full-width budget), never inheriting the phone "below the object" stack into a narrow gap that leaves most of the frame dead. Carry the wide staging *per state*, not just for first paint.

Carry, for each key moment, *what it is on a phone and what it is on a wide screen* — so `realize` engineers a re-composition, never a squeeze.

## Pitfalls

- **Restyling and calling it redesign** — the skeleton survives; the genericness survives.
- **Escaping generic *horizontally*** — inventing a weird, unfamiliar structure to seem creative instead of taking the *needed* primitive and mastering it; the oddness reads as arbitrary, not premium. Go *vertical* (depth of craft on the known thing), not *sideways* (novelty of layout).
- **Designing for desktop and letting it shrink** — no phone staging conceived, so the moment breaks or cramps on the screen most people use.
- **Timid scale** — everything medium-sized and centered; no focal point, no drama.
- **Space starvation** — cramming; no room for the eye, so nothing reads as important.
- **A reel of effects** — staged moments with no compositional through-line or continuity; busy, not artful.
- **Stating the turn instead of staging it** — telling the user the feeling shifts rather than making it shift visibly as they move.
