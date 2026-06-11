---
name: envision-the-experience
description: Imagine the world an interface lives in — its feeling, its place, its metaphor — before any layout, component, or pixel, and design every element as a native inhabitant of that world rather than a generic control dropped on a page. Use whenever you design or reimagine any screen, feature, flow, or interface — especially the moment you're tempted to reach for a standard shape (a dashboard, a card grid, a sidebar, a settings list, a hamburger menu, a modal) by reflex; when a feature carries human or emotional context (an app for couples, for grief, for children, for a first concert, for a wedding, for recovery); when someone asks for creative direction, art direction, a visual vision, a mood, or an experiential spec before implementation; or whenever a design risks coming out as generic boxes-and-text. The core move — the screen is a place, not a page: start from the feeling and the context, never from the form. For every element the requirements name (a menu, a list, a form, a status, a button), first ask what it truly *is* in THIS app and THIS moment — how it's used, what for, what it represents — then design its truest form, which may look nothing like the convention (a menu might become a sunflower whose petals you pick; navigation a path through a garden; a loading wait a kettle coming to the boil). Speaks in sensory, spatial, emotional language — a world, a canvas, a drawing, a feeling — and deliberately names NO implementation (no markup, styling, framework, or tool), so the vision stays free and the builder finds the best means. Dreams free, then **lands the world on the app**: after the imagination has done its work, every inhabitant of the world is anchored to the app's real anatomy (its surfaces, flows, gestures, and states) and every transformed element is validated against what the convention it replaced was buying (findability, scannability, reachability, learnability) and against general app truths (one thumb, interruptions, long lists, failure states) — so the Vision is app-true and *directable*, never an untethered mood. Immersive is not busy — restraint is part of the craft: sometimes the truest form is calm and quiet, and the standard shape is right only when the context genuinely earns it. Explores several rival worlds before committing to a single coherent Vision (breadth first, then commitment — the one place visioning fans out, while the imagining of any one world stays whole in a single mind). Grounds the world in the real situation (the human, the moment, the context — plus any existing material the project happens to have, adopted when present but never required), not invented from a model's associations. Produces a **Vision** — a written, sensory description with five beats (the world & the feeling; the user & the context; what lives on the screen & how it behaves; the emotional arc; the anchor — how the world lands on the app). The Vision is the *feeling*, NOT the art and NOT a visual brief: it is handed first to `stage-the-vision` — the visual architect that invents the bold, web-native artistic moments carrying the feeling and produces the Staging — and only then to `realize-the-vision` to build — feeling → Staging → build — so the builder never fills the visual vacuum with the model's default taste. The upstream member of the experience-design trio (envision → stage-the-vision → realize), the experience-layer twin of `keep-users-oriented`, and an expression of `architect-mentality` — design for the consumer, model the missing concept, refuse false tradeoffs, go the extra mile.
---

# Envision the Experience

A great painter sees the picture before the brush touches the canvas. Not the strokes, not the pigments, not the weave of the linen — the *image*: the light, the mood, the thing it will make you feel. The technique comes after, in service of the vision. It is never the other way around.

**This skill is that act of seeing — for interfaces.** Before any layout, any component, any pixel, you imagine the *world* the interface lives in: its feeling, its place, the truth it's trying to express. Then you describe that world so vividly that someone could build it. You are not arranging boxes on a page. **You are imagining a place, and the screen is the window into it.**

The screen is a place, not a page. Hold onto that. A *page* is a default — a rectangle you fill with the usual furniture: a bar across the top, a column down the side, a grid of cards, a list of rows, a button in the corner. A *place* is something a person *enters* — it has a mood the moment you arrive, things that live in it, a way of moving through it, a feeling it leaves you with. The whole craft of this skill is refusing the page and imagining the place.

---

## The one move: imagine the world before the widgets

Everything here reduces to a single discipline. **Start from the feeling and the context. Never from the form.**

The lazy path — the one every generic interface takes — runs the other way: it starts from the form ("this is a settings screen, so: a list of toggles"; "this is navigation, so: a hamburger menu"; "this is data, so: a dashboard of cards") and never asks whether that form belongs here at all. The form is chosen by reflex, by convention, by what was easy to reach for — and the result *works*, and feels like nothing, and could belong to any app on earth.

You run it the other way:

1. **What is this place, and what should it feel like to be here?** Before naming a single element, find the one emotional truth of this app, this module, this moment. An app for couples is a place of *shared intimacy* — two people, one private world. A grief journal is a place of *quiet and weight*. A kids' learning game is a place of *play and wonder*. A tax tool is a place of *calm control over something scary*. That feeling is the north star; every later choice serves it.

2. **Who is here, why, and what is this *to them*?** The same feature means different things to different people in different moments. A "list of memories" in a couples app is not a data table — it's a *shelf of keepsakes*, a *mantel*, a *shared drawer of photographs*. Design for the human in the moment, not the noun in the spec.

3. **For every element the requirements name — interrogate it before you draw it.** The spec says "menu." Don't draw a menu. Ask: *what does this menu represent in this app? In this module? How is it used, and what for?* A menu is just "the ways you can go from here" — and in a garden app, the ways you can go might be *paths winding off a clearing*; in a couples app, the choices might be *petals on a single shared sunflower* you lean in to pick; in a meditation app, they might *surface one at a time from still water*. The word "menu" was a pointer to a need, not an instruction to render a menu. (This is `architect-mentality`'s *build for the goal, not the brief*, applied to pixels.)

4. **Decide how the world behaves — from the context, not by default.** Is this place *still*, like a printed page held in the hand? Or *alive* — does it breathe, drift, respond? Does it move when you scroll, tilt with perspective, unfold cinematically, settle like sediment, ripple at a touch? Stillness and motion are both choices that must be *earned by the feeling*. A memorial should probably be still and slow. A child's reward screen should probably burst. Neither is a default; each is decided.

The questions are fixed; the answers are wide open and deserve real imagination every single time. This is the same spirit as the sibling skill `keep-users-oriented` — *the need is fixed, the form is a design problem* — extended from a single waiting-moment to the whole felt experience of the interface.

---

## Land the world on the app — the second movement

Dreaming free is the first movement; it is not the whole dance. A world that never lands is just a mood — gorgeous to read, impossible to build toward, impossible to *steer*. The thing being envisioned is an **app**: a product with surfaces a person operates, tasks they came to finish, states it passes through, and a body — usually a phone in one hand — it is met with. **The abstraction is a launchpad, not a destination: after you imagine the world, you land it on the app.**

Landing is a pass over the whole world, run *after* the imagination has done its free work — never during, or the constraint kills the conceiving; never skipped, or you ship a dream. It is two disciplines:

**1. Anchor every part of the world to the app's real anatomy.** An app is made of moments and surfaces — an arrival, ways to move, places where tasks happen, things that grow and empty and fail. Walk both directions of the map: for every requirement, screen, flow, and state the app actually needs, name its *home* in the world; for every inhabitant of the world, name the app element it *is* and what a person actually does with it — tap, type, scroll, choose, wait, return. A requirement with no home means the world is incomplete; an inhabitant serving no requirement is decoration. The map must close in both directions.

**2. Validate every transformation against what the convention was buying.** Conventions are not the enemy of imagination — they are *prepaid UX*. A menu buys findability and learnability; a list buys scannability; a back button buys safety; a tab bar buys thumb reach and always-there orientation. When the world transforms an element, the new form inherits the debt: if the menu became a sunflower, the petals must still scan as choices, sit within a thumb's reach, and announce themselves as the way onward — or the sunflower is a regression wearing poetry. And run the whole world against general app truths: people arrive mid-task, one-handed, distracted, in glare, on bad signal; lists grow long; networks fail; every screen has an empty, loading, and error life; navigation must work backward as gracefully as forward. This is where `astonishing-to-use` enters **by contract** — the ping-pong between world and use is a required movement of this skill, not a courtesy check afterward.

**3. Organize the inhabitants into a navigable whole — a place, but a *legible* one.** Anchoring each element 1:1 is not enough: the inhabitants must add up to an **organized, navigable app**, not a *scatter* of evocative things in space. Navigation especially must read as navigation — a *purposeful, legible structure* a person can take in at a glance ("these are the places I can go, here's the main one, here's where I am"), with deliberate placement and clear hierarchy, not mood-dots drifting at arbitrary positions. The danger this catches is the world that's atmospheric but **disorganized** — beautiful inhabitants with no order, no focal subject, no findable structure, so it stops feeling like an app and starts feeling like "they tried to be creative." A place is still *organized*: a real room has a clear centre, a way in, an obvious where-things-are. Ask of the whole: where does the eye go first; how would a stranger know what the main thing is and how to get anywhere; is the arrangement *purposeful* or merely pretty? (This is also where `astonishing-to-use`'s clarity and findability lead — organization is a use requirement, not a decoration.)

The test of a landed world: **the Vision is directable.** Anyone reading it can point at any part — "the shelf," "the petals," "the still water" — and know which surface or feature of the app it is, and steer it ("the shelf should show the newest memory first") without the world dissolving. If feedback has no handle to grab, the world never landed.

Landing never bans abstraction — it *cashes* it. The sunflower stays a sunflower; landing just makes sure it is also, verifiably, the navigation.

---

## The Vision — what this skill produces

The deliverable is a **Vision**: a written, sensory, non-technical description of the experience — vivid enough to paint the picture in someone's mind, free enough to let the builder find the best means. It is the *contract* of the experience; the implementation is internals, free to change as long as it honors the Vision. (Black boxes, cleanly separated — `architect-mentality` principle 1.)

A Vision hits **five beats**. They are fixed; *how* you write each one is open — prose, a walk-through, a short film described in words, a letter to the builder, whatever conveys it best. This is guidance, not a form to fill in. Never let the five beats flatten into five boxed headings with a sentence each; that would be the very box-and-text reflex this skill exists to refuse.

1. **The world & the feeling.** Where are we? What is this place, and what is the single emotional truth of being in it? Paint it — the light, the air, the mood, the metaphor that holds it all together. If a stranger read only this beat, they should *feel* the app before knowing a thing it does.

2. **The user & the context.** Who enters this place, in what moment of their life, reaching for what? What is this app *to them*? What must the design honor or protect (their grief, their excitement, their kids' short attention, their need to trust you with money)? **Include *where and how* they experience it** — phone in hand in bed, desktop at work, a big shared screen, one-handed, outdoors in glare — because the device is part of the moment, and the feeling must hold on whatever screen they actually use (most often a phone). This beat keeps the world honest — it's why the feeling is *this* feeling and not a pretty mood pasted on.

3. **What lives on the screen, and how it behaves.** The inhabitants of the world — *not* "components." What do you see first; what draws the eye; what can you touch, and what happens when you do; what is large and what is quiet; how is it arranged in space. And the life of it: still or moving, how it enters, how it responds to you, to scrolling, to time. Conventional words are allowed here ("a button," "a list") — but only after you've decided they're the *truest* form, and you describe what they actually look and feel like in *this* world, never as bare nouns.

4. **The emotional arc.** An interface is moved-through, not just looked-at. How does the feeling change from the first breath to the last? The arrival, the unfolding, the small rewards, the transitions between moments, the way it lets you leave. Describe the journey, not just the snapshot — a place is its passage as much as its picture.

5. **The anchor — how the world lands on the app.** The map between the world and the product: the app's real surfaces and moments, which requirement each inhabitant of the world serves, what a person actually does there with their hands, where the world deliberately stays close to convention and why, and how each transformed element pays for what the convention it replaced was buying. Still no implementation — naming screens, gestures, flows, and states is experience language, not engineering. This beat is what makes a Vision *directable* rather than a mood: it gives every piece of the world a handle the reader can point at and steer.

A Vision speaks in **sensory, spatial, emotional language and names no implementation** — no markup, no styling, no framework, no tool, no measurements-as-mechanics. This is deliberate, and it's two gifts at once (`architect-mentality`'s *refuse false tradeoffs* — you get both): it keeps the vision *free* of how-to-build-it so the imagination isn't shackled to what's easy in some framework, and it keeps the builder *free* to find the best technical means to honor the feeling. You describe *what it is to be there*; `stage-the-vision` turns it into bold, web-native art and `realize-the-vision` makes it real.

---

## Ground the world in reality — and hand it to the Staging

Two cautions keep this skill honest:

**Ground the world in something real; don't invent it from thin air.** The world you imagine should grow from the *real* situation — who the interface is for, the actual human moment and purpose, the concrete context — not from what "an app like this" conjures. A world spun purely from a model's associations drifts toward the generic even when it sounds evocative. And *if* the project happens to have real material — a brand, prior work, imagery — that is an input to honor, never to override; when it has none (the common case), ground in the real human and context instead. Existing brand or identity is a bonus to adopt when present, never a prerequisite.

**The Vision is the feeling, not the art — and not the visual brief.** Naming no implementation is deliberate and right, but the feeling alone (say, "calm, unhurried, a place to finally exhale") does *not* yet pin down a striking, concrete visual. If the build jumps straight from feeling to high-fidelity pixels, it fills that vacuum with the model's default taste — a card grid; then, "escaping" it, blobs and gradients; then, "making it pop," garish saturation. So the Vision is **not** handed straight to the build. It goes first to **`stage-the-vision`**, the visual architect, which invents the bold, web-native *artistic moments* that carry the feeling — staying at the art level, grounded and confirmed — and produces **the Staging**; *only then* does `realize-the-vision` build. **Feeling → Staging → build.** The Vision stays pure feeling; the Staging is where it becomes art.

---

## Immersive is not busy — restraint is the other half of the craft

The danger of a skill like this is that it becomes a spectacle machine — turning every menu into a sunflower whether or not the app wants one, piling on animation, perspective, and cinematic flourish until the experience is exhausting and the user can't find the button. **That is the box-and-text failure wearing a costume.** Decoration reached for by reflex is no better than a card grid reached for by reflex; both skip the question of what the *place* actually needs.

So hold two truths together:

- **Never settle for the generic form when the context calls for something truer** — go the extra mile, invent, imagine the place (`architect-mentality` principle 15).
- **Never reach for spectacle when the context calls for quiet** — know when *not* to (`architect-mentality` principle 14). The most immersive thing a tax app can do is feel calm and clear. A memorial's truest form may be a single still photograph and a lot of space. Sometimes — genuinely — the right answer *is* close to a clean, conventional layout, because that's what the feeling and the human in the moment actually need. The note on naming says it exactly: produce boxes-and-text only *if that's strictly necessary* — and when it is, it's a designed choice, not a default you fell into.

The test is never "is this fancy?" It's **"does every choice serve the one feeling, and would a person in this exact moment be served by it?"** Purpose decides. Whimsy that serves the feeling is craft; whimsy that serves itself is noise. Immersion is *coherence and fitness*, not quantity of effects.

---

## How to turn requirements into a Vision

You're usually handed system requirements, user stories, feature requests — flat, functional, formless. The method is to read *through* them to the experience:

1. **Read for the feeling first.** Before any feature, ask what this whole thing *is* for the human who uses it, and what one emotional truth should run through every screen. Name it in a sentence. (Couples app → "our private world, just the two of us." Concert app → "the lights are about to come up." Recovery app → "one gentle step, and you're not alone.")

2. **Find the world that expresses that feeling.** Reach for a place, a metaphor, a material, a time of day, a piece of nature — something concrete enough to design within. The world is the unifying mental model (`architect-mentality` principle 12); once you have it, most element decisions answer themselves, because each one simply asks "what is *this* in *that* world?"

3. **Interrogate every element the spec names.** Walk the feature list and, for each noun — menu, list, profile, settings, upload, notification, empty state — ask the four questions (what is it *here*, how is it used, what for, what's its truest form in this world). Let some stay close to convention if that's truest; let others transform completely. Decide each on purpose.

4. **Place the elements in the world and give them life.** Arrange by attention and meaning, not by template. Decide what moves and what is still, what responds and how, what the arrival and the transitions feel like. Earn every bit of motion from the feeling.

5. **Land the world on the app.** Close the map in both directions — every requirement, screen, flow, and state has a home in the world; every inhabitant is a nameable app element a person operates. Validate each transformed element against what the convention it replaced was buying, and the whole world against general app truths (one thumb, interruptions, long lists, empty/loading/error lives, backward navigation). Ping-pong with `astonishing-to-use` until the world is both astonishing to feel and astonishing to use — reconceiving where the use demands it.

6. **Walk the arc.** Trace one real person from arrival to departure and make sure the feeling holds and *builds* — fix any moment where the world breaks character or drops back into a generic page.

7. **Write the Vision** in the five beats, in sensory language, naming no implementation. Then hand it to `stage-the-vision` to become the Staging, and only then to `realize-the-vision` to build.

---

## Explore wide, then commit to one

The first world you imagine is rarely the truest. Before committing, imagine *several* — different metaphors, different places, different emotional readings of the same brief — then choose or synthesize the strongest into one. **Breadth first, then commitment** (`architect-mentality` #15 — go the extra mile; #7 — refuse the first framing as if it were the only one).

This is the one place visioning parallelizes: explore rival worlds independently — even in parallel across subagents — judge them against the feeling and the human in the moment, then commit to a **single** coherent Vision, grafting the best from the runners-up. What you must *not* do is fan out the imagining of *one* world, or split a single Vision across separate imaginations — coherence comes from one mind holding the whole (`architect-mentality` #12 — one mental model). **Many worlds explored; one world delivered.**

The building half, `realize-the-vision`, parallelizes far more — research, sourcing, regions, verification — precisely because the single Vision you commit to *here* becomes the shared contract that keeps all that fan-out coherent. The discipline you spend on committing to one world is what earns the parallelism downstream.

---

## Illustrations — not a catalogue

These show the *move*, not a menu of motifs to copy. The whole point is that the right world comes from *this* context; lifting "sunflower" or "garden" into an unrelated app would be the catalogue thinking this skill rejects (and exactly what the off-the-shelf design tools do — pick "immersive theme #4" from a list). Let these prompt the *method*, never the output.

- **A menu in a couples app.** The spec says "navigation menu." The feeling is *one shared private world*. So the choices aren't a stack of links in a drawer — they're **petals of a single sunflower the two of you tend together**, each petal a part of your shared life (our days, our places, our promises), leaning open as you reach for one. The menu became a thing you grow together, because that's what the app *is*. And then it *lands*: the sunflower is the home screen's navigation — a handful of petals, sitting where a thumb rests, each plainly readable as a destination — paying everything the menu it replaced would have bought.

- **An empty state in a grief journal.** The spec says "empty list — no entries yet." The reflex is a gray illustration and "No entries. Add one!" The feeling is *quiet and permission*. So the first arrival is **a still, near-blank page with soft light and a single line that simply makes room** — not a prompt nagging for input, but a held silence that says *whenever you're ready*.

- **A loading wait in a kids' game.** The spec says "loading spinner." The feeling is *play and anticipation*. So the wait is **a creature stretching awake, or a balloon slowly filling** — the wait itself becomes a tiny delight, and (tying to `keep-users-oriented`) it still honestly answers "something's coming, almost there."

- **A settings screen in a meditation app.** The spec says "settings list." The feeling is *stillness*. Here the truest form might stay *almost* conventional — **a calm, spacious single column that surfaces one quiet choice at a time** — because spectacle would betray the feeling. Restraint *is* the creative choice. The skill earned the quiet; it didn't default into it.

Same method every time: feeling → world → what is this element *in* that world → how does it behave → does it serve the human here.

---

## Ask yourself

- Have I named the **one feeling** this place should leave a person with — before naming a single element?
- Am I designing a **place someone enters**, or just filling a page with the usual furniture?
- Did I start from the **form** ("it's a dashboard, so cards") or from the **feeling and context**? If I can name the widget but not the world, I started at the wrong end.
- For every element the spec names: have I asked **what it truly is in this app and this moment**, or did I render the noun? Was "menu" a need, or did I treat it as an instruction?
- Does every choice — including every effect, every motion, every flourish — **serve the one feeling and the real human in the moment**? Or is some of it spectacle serving itself?
- Have I considered that the **truest form might be quiet and nearly conventional**, and chosen it *on purpose* rather than defaulting into (or away from) it?
- Did I describe the **experience** (sensory, spatial, emotional) and name **no implementation** — keeping the vision free and the builder free?
- Have I walked the **arc** — arrival to departure — so the feeling holds and builds, not just one pretty snapshot?
- Would this interface be unmistakably **this app's**, or could it belong to any product on earth?
- Have I named the real **device-context(s)** the human is in — and does the feeling hold on the screen they actually use (usually a phone), not just a wide desktop?
- Have I **landed the world on the app**? Does the map close in both directions — every requirement, screen, flow, and state has a home in the world, and every inhabitant is a nameable app element a person operates?
- For every convention I transformed: have I named **what the convention was buying** (findability, scannability, thumb reach, safety) and shown how the new form **pays that debt**?
- Is the Vision **directable** — could a reader point at any part of the world, know which app surface or feature it is, and steer it without the world dissolving?
- Have I **ping-ponged the world against the use** (`astonishing-to-use`)? A world can be beautiful to imagine and miserable to operate — it must be both astonishing to *feel* and astonishing to *use*, the mission setting who leads.
- Did I imagine **more than one world** before committing — and choose or synthesize the truest — or settle for the first that came to mind?
- Is the world **grounded in something real** (the real human, moment, and context — plus any existing material the project happens to have), or spun from what "an app like this" conjures? And have I sent it to **`stage-the-vision`** to become the Staging (bold, web-native art) before any high-fidelity build — rather than letting the build leap from feeling to pixels?

## Red flags

- A design described in **components and layout** ("header, sidebar, card grid, modal") instead of in world, feeling, and experience.
- The **form chosen before the feeling** — "it's a settings screen, so a list of toggles" — with no question of whether that form belongs here.
- Reaching for the **standard shape by reflex** (dashboard, hamburger menu, card grid, generic empty state) without interrogating what the element *is* in this specific place.
- **Rendering the noun** the spec used — drawing a "menu" because the requirement said "menu" — instead of designing the need it pointed at.
- **Spectacle for its own sake** — animation, perspective, and cinematic flourish that don't serve the one feeling; turning everything whimsical by reflex (the box-and-text failure in a costume).
- The opposite: **defaulting to the safe, generic layout** and calling it "clean," when the context was crying out for something truer.
- A Vision **clotted with implementation** — markup, styling, framework names, mechanics — shackling the imagination and the builder both.
- A design that **could belong to any app** — no world, no context, no feeling that makes it *this* product's.
- A world imagined **only for a wide desktop screen** while the human is most likely on a phone — the feeling won't survive the device it's actually met on.
- A world that's **beautiful to imagine but hard or annoying to use** — conceived with no ping-pong against `astonishing-to-use`. The feeling is only half of great design; the *use* is the co-equal other half.
- A world with **no app under it** — gorgeous prose in which no one can say what the screens are, what you tap, or where a requirement lives. Untethered moods are not Visions.
- A world that's **atmospheric but disorganized** — inhabitants anchored 1:1 yet scattered with no order, no focal subject, no legible navigation (mood-dots where the menu should be), so it stops feeling like an app and reads as "tried to be creative and failed." Landing means *organized*, not just mapped.
- A transformed element that **lost what the convention bought** — an unfindable menu, an unscannable list, navigation out of a thumb's reach — with nothing in the new form paying the debt.
- A Vision the stakeholder **cannot direct** — feedback like "show the newest first" or "make this denser" has no handle in the world to grab.
- Treating the five beats as **five boxes to fill** with a sentence each, rather than as a vision to paint.
- A world **invented from a model's associations** rather than grounded in the real human and context (and any existing material) — or a Vision **handed straight to the build**, skipping the Staging (`stage-the-vision`) and letting the builder fill the visual vacuum with its default taste.

---

> **Origin.** This skill is the upstream, *visioning* member of the experience-design **trio**: it decides **what the experience should be** (the feeling, the Vision) before anything decides how it should look or how to build it. Then `product-ux:stage-the-vision` — the visual architect — invents the bold, web-native *artistic moments* that carry the feeling and produces **the Staging** (the concept, the staged moments, the visual system), and `product-ux:realize-the-vision` builds it. **Feeling → Staging → build**, on one altitude ladder (sensory feeling → web-native art → engineering) — cleanly separated: the Vision is the contract of *feeling*, the Staging the contract of *art*, the build the internals.

> **Related.** It is the experience-layer twin of `product-ux:keep-users-oriented` — both insist the *need* is fixed while the *form* is an open design problem to reason from, never a stock widget to grab by reflex; `keep-users-oriented` governs every waiting-and-stepping moment, `envision-the-experience` governs the whole felt world the interface lives in. And it is a direct expression of `engineering:architect-mentality`: *build for the goal, not the brief* (the spec's "menu" is a pointer to a need), *design for the consumer* (the human in their real moment is the primary constraint), *model the missing concept* (when no conventional element fits the feeling, invent the one that does), *refuse false tradeoffs* (a vision both free of implementation and precise enough to build), *lead with one mental model* (the world unifies every choice), *know when not to* (restraint over spectacle), and *go the extra mile* (refuse the generic; imagine the place). The landing pass is where `product-ux:astonishing-to-use` enters by contract — the world must be astonishing to *feel* and astonishing to *use*, and the anchor beat is the proof it is both.
