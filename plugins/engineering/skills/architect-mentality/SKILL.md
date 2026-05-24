---
name: architect-mentality
description: The mindset of a great software architect - the values and ways of thinking to adopt BEFORE and WHILE making any design or structural decision, on any stack, language, framework, domain, or project. Use when starting a feature, shaping a function/class/component, drawing a module or library boundary, organizing an app or workspace, choosing between approaches, naming things, deciding what to abstract or decouple, deciding where something should live, setting up build/run/dev workflow, reviewing a design, or whenever you sense a structural decision is being made. This skill is MENTALITY ONLY - no specific techniques. It tells you HOW to think: treat everything as a black box with deliberate, well-defined connections; place every element on purpose (never because it merely fits); model the missing concept instead of working around gaps; work smart, not hard; automate every repeated process (never do the same thing by hand twice); concentrate complexity so the edges stay simple; refuse false tradeoffs; keep abstractions empowering and honest; design for the consumer; invert control toward pluggable seams; absorb your tools' weaknesses; lead with why and one mental model; preserve understanding and proof; know when not to build; and always go the extra mile.
---

# Architect Mentality

Great architecture is not a set of techniques — it is a way of thinking. Techniques are downstream: they are the *current best expression* of a mindset, and they change with tools, languages, platforms, and time. The mindset does not. **This skill is the mindset.** It contains no techniques on purpose.

Use it whenever you make a structural or design decision **at any scale** — naming a single function, shaping a class or a component (and its styles), drawing a module boundary, organizing a library, structuring an app, or laying out an entire workspace. The same principles apply identically at every level.

These principles are universal: they hold regardless of language, framework, platform, domain, or project. They are about *how to think*, not *what to type*. When a decision feels hard or ambiguous, return here and reason from these principles — the right technique will follow.

The principles reinforce one another. Read them as one integrated stance, not a checklist to satisfy mechanically. Each is written with **what it means**, **what to ask yourself**, and **the red flags** that tell you you're violating it — so there is no room for guessing.

---

## 1. Everything is a black box

**Treat every unit as a black box: a thing with a boundary, a deliberate public contract, hidden internals, and only well-defined connections to other black boxes.** A function, a class, a component, a component's styles, a file, a module, a library, an app, the whole workspace — each is a black box.

**What it means.** A black box has four properties, and you reason about all four every time:
- **A boundary** that cleanly separates inside from outside.
- **A public contract** — the small, intentional surface it exposes to the world. Everything not in the contract is invisible.
- **Internals** that are private and free to change at any time without affecting anyone, precisely because no one outside depends on them.
- **Received dependencies** — anything that can be abstracted or decoupled is *given to the box from the outside*, not reached for from within. The box owns only what is essentially its own.

A black box **never reaches across its boundary into another box's internals.** It may *connect* to another box, but only through a **specific, well-defined, well-designed connection type** — and both the **direction** and the **nature** of that connection are deliberate, named, and intentional. Illustrative connection types (not exhaustive): dependency injection; parent–child / containment; layered or domain-driven dependency rules where dependencies flow in one sanctioned direction (for example: shared utilities may be used by data; data may be used by features; presentation is never depended upon by utilities; data never depends on presentation; and so on). The point is not the specific rule — it is that **every connection is a chosen, designed relationship of a known type and direction, never an accident.**

Apply this *fractally*: a workspace is a black box made of libraries; a library is a black box made of modules; a module of components; a component of functions. The same four properties and the same connection discipline hold at every scale.

**Ask yourself.**
- What exactly is inside this box, and where is its boundary?
- What is the smallest public contract it can expose? What must stay internal?
- What does it genuinely own, versus what should it receive from the outside so it stays decoupled?
- For each connection to another box: which direction does it run, and which well-defined connection type is it? Is that direction sanctioned?

**Red flags.**
- One box reaching into another's internals, or knowing more about another than its public contract reveals.
- Hidden or implicit dependencies; dependencies acquired internally instead of received from outside.
- Circular connections; dependencies flowing against the sanctioned direction (a lower or shared layer depending on a higher one).
- A connection that "just happened" rather than being chosen, named, and designed.
- A public surface larger than it needs to be — internals leaking out.

---

## 2. Place everything on purpose

**Every element exists by intention, never by coincidence. Every line — declarative or imperative — every `if`, every call, every constant, every config value, every abstraction, every injected dependency, every document is there because it is the right thing in the right place. "It fits here" is never a reason.**

**What it means.** Nothing in a well-architected system is present by accident, by habit, or because it happened to be convenient at the moment of typing. Each element has a deliberate reason to exist *and* a deliberate place to live — chosen because that is where it *belongs* (where responsibility for that concern truly sits), not merely where it *works*. "Fits" and "belongs" are different claims: almost anything can be made to fit almost anywhere, which is exactly why "it fits" tells you nothing about whether it's right. So the architect never asks "*can* this go here?" (the answer is almost always yes) — they ask "is *here* the place dedicated to this concern?"

For example: a network/API call can be written directly inside a UI component, and for a small component it will technically "fit" and work. But that is not a purposeful decision — it drops a data-access concern inside a presentation black box and blurs the boundary. The purposeful decision is to place that call where data access *belongs* — in a unit dedicated to it — which the component then depends on. The same test applies to everything: a constant (does it belong here, or in a single source of truth?), a piece of configuration, a guard clause, an abstraction, an import — each lands where its concern lives, on purpose.

This is the discipline that keeps black boxes (principle 1) honest: boundaries hold only if every element is consciously assigned to the box whose responsibility it is. And when you can't find where something belongs, that absence is a signal — a concept or a home is missing, so create it (principle 3) rather than dropping the element wherever it happens to fit.

**Ask yourself.**
- Why is this here, *specifically*? Can I state the deliberate reason out loud?
- Is this the place *dedicated* to this concern, or just a place where it happens to work?
- Am I *choosing* this location, or *defaulting* to it because it's convenient right now?
- If someone asked "why is this line here?", would my honest answer be "it fit"? (If so, reconsider.)

**Red flags.**
- "It works here" / "it fits here" offered as the justification for a placement.
- A concern living inside a box whose responsibility it isn't (data access inside presentation, business rules inside a view, configuration hardcoded at a call site).
- Elements added where they were convenient to type rather than where they belong.
- Anything whose purpose and placement you can't explain.

---

## 3. Model the missing concept — never work around a gap

**When the design doesn't account for something, the design is missing a *concept*. Build that concept as a first-class part of the system. Never bolt on a workaround that routes around the gap.**

**What it means.** Requirements that "don't fit" are signals, not nuisances. The honest response is to ask *"what concept is my design missing?"* and then introduce it properly — give it a name, a place, and a clear contract — so the new requirement becomes a natural, ordinary case of the design rather than a special exception grafted onto it. Working around a gap (special-casing, papering over, masking a symptom, smuggling in an exception) buys a moment and creates permanent debt. Modeling the concept costs more now and pays forever. A great architect always pays down the principal, never just the interest. When something breaks, this same instinct drives you to the *root cause*: the surface failure is a symptom, and the missing or wrong concept beneath it is what you actually fix.

**Ask yourself.**
- Does the current design *account for* this, or does it only *almost* fit?
- If it only almost fits, what concept am I missing? What is its name, its boundary, its contract?
- After I introduce that concept, is the new requirement now an ordinary case rather than an exception?
- For a failure: have I traced it to the actual cause, or am I about to suppress a symptom?

**Red flags.**
- "I'll just handle this one case right here."
- A growing pile of exceptions, flags, or special cases clustered around one area.
- Suppressing or masking a symptom while the underlying cause remains.
- A design that needs a footnote for every real-world situation.

---

## 4. Work smart, not hard

**Refuse repetition at the level of *structure*, not just lines of code. If you would build the same shape twice, build the thing that produces the shape instead. And minimize not only today's effort but the cost of every future change.**

**What it means.** A great architect is *strategically* lazy: repetitive, manual, or duplicated work is a design defect to be eliminated, not endured. When two things are the same in essence, that sameness must live in exactly one place, and differences become parameters — never copies. Equally, you design so the *expected* changes — new cases, evolving requirements, changes in the things you depend on — cost as little as possible, and so the **blast radius** of any change stays small and local. Effort invested now to remove future effort is the central trade you are always weighing. When the repetition is an *action* you keep performing rather than a *shape* you keep writing, the same instinct applies — as automation (principle 5).

This applies to grunt work and duplication only — **never** to design thinking itself (see principle 15). Be relentlessly lazy about repetition; be relentlessly diligent about design quality.

**Ask yourself.**
- Am I about to create something whose shape already exists? Where should the single source of that shape live?
- What is likely to change here later, and how do I make that change cheap and local?
- If something I depend on changes, how much of my work must change? Can I make that nearly zero?

**Red flags.**
- Copy-paste-and-tweak; the same rule, value, or shape expressed in more than one place.
- A change that forces edits in many scattered places (large blast radius).
- "I'll just redo it by hand each time."

---

## 5. Automate every repeated process

**Never do the same thing manually twice. The moment an action repeats — a command, a build step, a sync between two places, a manual edit you keep redoing — turn it into something that runs itself, invokable in a single step. This is the anti-repetition instinct of principle 4 extended beyond code to the entire way you work.**

**What it means.** Manual repetition is wasted time, a reliable source of human error, and a sign that a process hasn't been *designed* yet. A great architect treats every repeated action as a candidate for automation: any task worth doing more than once is encoded **once** — as a script, a generated artifact, a runnable target, a pipeline step — and then triggered with a single command, or, better, automatically at the moment it's needed. This is *developer-workflow* design, and it is part of the architecture: how you build, run, generate, verify, deploy, and switch contexts deserves the same care as the code itself. Your time and attention are finite; spending them on something a machine could do reliably is a design failure. Derive from a single source of truth instead of maintaining two things in parallel; make procedures executable instead of remembered.

The instinct shows up at every scale — for example:
- **Generate from the source of truth; never hand-maintain a mirror.** If the names of the files in a folder must appear and stay current inside a constant, you never keep that list by hand. You make the constant *generated* from the folder and run that generation automatically (for instance, on every build) so it can never drift. The folder is the source of truth; the constant is a derived artifact.
- **A command you always run becomes a named, runnable target.** If there's an incantation the team keeps typing, it belongs in one runnable script/target with an obvious name — not in everyone's memory or a wiki page.
- **Context differences become one action, not a remembered recipe.** If launching the app differs by environment — locally, locally against staging, locally against production — nobody should reassemble the right flags from memory each time. Design it so serving for a given environment is a single, unambiguous action.

The test is always: *am I about to spend human effort on something that has a knowable, repeatable procedure?* If the procedure is knowable, the machine should own it.

**Ask yourself.**
- Have I done this exact thing by hand before? Will I — or someone else — do it again?
- Is there a source of truth this should be *derived* from, rather than maintained in parallel?
- Could this be one command, or happen automatically, instead of a remembered sequence of steps?
- Am I relying on people to *remember* a procedure that the system could *guarantee*?

**Red flags.**
- The same command, sequence, or manual fix performed by hand more than once.
- Two places that must be kept in sync by hand (a list, a version, a config mirrored manually).
- "Just remember to run X first" / "the steps are in the wiki" / tribal knowledge standing in for a process.
- Environment- or context-specific setup reassembled from memory each time.
- Onboarding that requires manually performing steps a script could perform.

---

## 6. Concentrate complexity; keep the edges simple

**Necessary complexity should be gathered into one well-contained place at the core, so everything built on top of it stays small, declarative, and obvious.**

**What it means.** Complexity rarely disappears — the architect decides *where it lives*. The skill is to pull the hard, intricate, error-prone parts into a single, well-designed center, paid for once, understood once, proven once, so that the many things that use it are trivial. The mark of a good abstraction is that the code at its edges — the callers, the features, the consumers — reads as plain intent, with the mechanics hidden inside. Complexity smeared across many places multiplies; complexity concentrated in one place is contained.

**Ask yourself.**
- Where is the complexity here, and can I gather it into one place instead of spreading it?
- After this, does the consuming code read as simple, declarative intent?
- Is the hard part paid for once, or re-paid at every use site?

**Red flags.**
- The same intricate handling repeated at many call sites.
- Consumers needing to understand internal mechanics to use something correctly.
- Complexity leaking outward instead of being absorbed by the abstraction.

---

## 7. Refuse false tradeoffs

**When you're told you must choose between two things you want, treat it as a problem to dissolve, not a compromise to accept. Look for the design that gives you both.**

**What it means.** Mediocre design accepts the first apparent tradeoff — "flexible *or* safe," "convenient *or* powerful," "fast *or* clear." A great architect treats an apparent either/or as a prompt: very often the tradeoff is an artifact of one particular framing, and a better structure removes it entirely. Some tradeoffs are real and must be made consciously — but you earn the right to accept one only after genuinely trying to dissolve it. Default to "why not both?" before you settle.

**Ask yourself.**
- Is this tradeoff fundamental, or just an artifact of how I framed the problem?
- What would the design look like if I refused to give up either side?
- Have I actually tried to dissolve it, or did I accept it because it was the first option I saw?

**Red flags.**
- Accepting the first compromise that appears.
- "We had to give up X to get Y" with no attempt to keep both.
- Treating a convenient framing as a law of nature.

---

## 8. Abstractions must never trap

**An abstraction should make the common path effortless without ever locking anyone out of the underlying power. Always provide an honest escape hatch.**

**What it means.** The purpose of an abstraction is to remove *burden*, not to remove *control*. A great abstraction handles the common case beautifully and still lets the determined user reach the raw capability underneath for the uncommon one. The escape hatch is explicit and documented — *including what guarantees you give up by using it* — so the user makes an informed choice rather than being either trapped or silently betrayed. An abstraction that hides power instead of hiding complexity is a cage.

**Ask yourself.**
- Does this remove burden while preserving control?
- If someone needs the raw capability underneath, can they reach it — cleanly and knowingly?
- Have I been honest about what taking the escape hatch costs?

**Red flags.**
- Users forced to abandon or fight the abstraction to do something it didn't anticipate.
- No path down to the underlying layer when one is genuinely needed.
- Hidden escape hatches, or ones whose consequences are undocumented.

---

## 9. Design for the consumer

**The experience of the thing's consumer — the next engineer, the calling code, your future self — is a primary design constraint, not an afterthought.**

**What it means.** Whatever you build is used *through its surface*, and that surface is where most pain or pleasure lives. A great architect designs surfaces that are **predictable** (consistent and convention-following, so the user can guess correctly without reading the manual), **forgiving** (they accept the inputs a reasonable user would naturally provide), **hard to misuse** (the easy way is the correct way), and **honest when they fail** (errors explain what went wrong and how to fix it). You continually stand in the shoes of whoever will use this and ask whether it would delight or frustrate them. Empathy for the consumer is not soft; it is one of the highest-leverage forces in design.

**Ask yourself.**
- If I met this surface for the first time, could I guess how it works?
- Does it accept what a reasonable caller would naturally hand it, or demand pre-conversion?
- Is the easiest way to use it also the correct way? When it fails, does the failure teach?

**Red flags.**
- A surface you must memorize because nothing about it is predictable.
- Easy-to-misuse shapes; correct usage requiring secret knowledge.
- Errors that state a symptom but not a cause or a remedy.

---

## 10. Define the seam; let others plug in

**Prefer designs where a thing declares *what it needs* and is supplied it from the outside, over designs where it reaches out and hard-wires *what it uses*. Own the contract; let the specifics be provided.**

**What it means.** Control and configuration should flow inward from the point where the system is assembled, not be hard-coded deep inside. The owner/assembler provides; the component consumes. This makes parts substitutable, testable in isolation, and extensible by people who never modify them. The architect's instinct is to find the **seam** — the well-chosen point of pluggability — and design around it, so the system grows by *adding new pieces at the seam* rather than by *editing existing pieces*. Depend on contracts and abstractions, not on concretions.

**Ask yourself.**
- Is this reaching out to grab what it uses, or declaring what it needs and receiving it?
- Where is the seam at which others could extend or substitute this — without editing it?
- Am I depending on a concrete thing where I could depend on a contract?

**Red flags.**
- Hard-wired, deep dependencies on specific concretions.
- Extending the system requires editing existing components instead of adding new ones at a seam.
- Parts that can't be substituted or isolated because their dependencies are baked in.

---

## 11. Compensate for your materials' weaknesses — proactively

**Know where your tools, platform, runtime, language, and environment are weak or sharp-edged, and absorb those weaknesses into the architecture so consumers never have to think about them.**

**What it means.** Every material an architect builds with has limitations, footguns, and rough edges. A novice ignores them until they cause pain; a great architect maps them in advance and designs so the rest of the system is shielded. Recurring difficulties, easy-to-get-wrong sequences, and known pitfalls are handled once, by default, at the right layer — turned into a solved problem rather than a tax paid repeatedly by everyone downstream. You take responsibility for the weaknesses of what you depend on instead of passing them through to your users.

**Ask yourself.**
- Where are the known weaknesses, footguns, and sharp edges of what I'm building on?
- Which of them can I solve once, centrally, so no one downstream ever meets them?
- Am I shielding my consumers from these, or quietly passing them through?

**Red flags.**
- The same platform or tool pitfall handled — or mishandled — repeatedly by every consumer.
- Known sharp edges left for users to discover the hard way.
- "Everyone just has to remember to do X."

---

## 12. Lead with *why*, and with one mental model

**Anchor every design in the problem it solves and the reasoning behind it, and strive to express the whole system through one small, consistent mental model that's learned once and applied everywhere.**

**What it means.** Two tightly linked ideas. First, *why before what*: a design is only as good as the problem understanding beneath it, so you start from the motivation and keep it visible — a decision without a stated reason is a guess, and a design no one can explain cannot be evolved safely. Second, *consistency as leverage*: when the same shapes, the same naming, and the same patterns recur throughout a system, a person learns it once and then correctly predicts the rest. A great architect hunts for the single coherent model that unifies the system and resists one-off exceptions that force the user to learn the system twice.

**Ask yourself.**
- What problem does this solve, and can I state the reason behind each significant choice?
- Is there a single consistent model I can apply here, the same way it's applied elsewhere?
- Would someone who correctly learned one part of this system predict this part?

**Red flags.**
- Decisions whose rationale no one can articulate.
- The same idea expressed differently in different places; inconsistent naming or shapes.
- Special cases that force the consumer to learn an exception to the model.

---

## 13. Treat understanding and verification as first-class

**Preserving *why the system is the way it is*, and proving that it behaves as intended, are part of the architecture — not optional extras done if there's time.**

**What it means.** Assume you will forget your own reasoning, and that a stranger will need to understand and change this. So intent, non-obvious decisions, and reasoning are captured where they live, and the meaningful *why* is made explicit rather than left implicit in the shape of the code. In parallel, confidence in correctness must be *demonstrated against intended behavior*, not assumed — and anchored to the **contract** (what a thing is supposed to do) rather than its internals, so the system can be reshaped inside without the proof crumbling. Understanding and verification are what let a system change safely; without them, every change is a gamble.

**Ask yourself.**
- If I forget everything about this in six months, will the reasoning still be recoverable?
- Is the non-obvious *why* explicit, or trapped in my head?
- Is correctness demonstrated against intended behavior (the contract), so internals can change freely?

**Red flags.**
- Decisions whose motivation lives only in someone's memory.
- Only the *what* recorded; the *why* left implicit.
- Confidence in correctness tied to internal implementation, so any restructuring breaks it.

---

## 14. Know when *not* to do it

**Restraint is part of design. The decision to *not* build something — or to withhold it until it's right — is as architectural as the decision to build.**

**What it means.** Ambition without discipline produces over-engineering: speculative generality, abstractions with no second use yet, surface and weight added for hypothetical needs. A great architect distinguishes *"this concept is genuinely missing"* (build it — principle 3) from *"this might be nice someday"* (don't, yet). When something isn't ready, isn't justified, or would over-complicate the whole for a fraction's benefit, the mature move is to hold it back — and to record *why* it was withheld, so the judgment isn't lost and can be revisited when the justification actually arrives. This does not conflict with going the extra mile (principle 15): greatness includes the discipline to stop at the right point.

**Ask yourself.**
- Is this solving a real, present need, or a hypothetical future one?
- Does the value justify the surface, weight, and complexity it adds?
- If I'm withholding it, have I recorded why, so the decision can be revisited later?

**Red flags.**
- Abstractions built for a single current use "just in case."
- Configuration and surface added for needs no one has yet.
- Complexity that buys little, or that the whole system must carry forever for one corner's benefit.

---

## 15. Go the extra mile — always

**Always aim for the great design, not the convenient one. Be creative, invent when needed, and do the hard thing to get it right. Never settle for a shallow solution because it is easier.**

**What it means.** This is the engine behind every other principle. When you hit a hard design problem, the lazy move is to take the first solution that makes the problem go away. The architect's move is to keep going until the solution is genuinely *good* — clear, sound, and a pleasure to build on. That often means **inventing**: combining ideas in new ways, devising an approach that doesn't exist yet, finding the elegant structure hiding behind the messy one.

Hold the line on one crucial distinction: **easy is not the same as simple.** *Easy* is low effort for you, now. *Simple* is low complexity for everyone, forever. Easy solutions are very often complex in disguise; simple solutions are usually *hard to find*. Refuse the easy-but-complex; pay the hard cost to reach the simple-and-elegant.

This reconciles cleanly with "work smart, not hard" (principle 4): be lazy about **repetition and grunt work**, and relentless about **design quality**. Never trade the second for the first.

**Ask yourself.**
- Is this the great solution, or just the one that makes the problem disappear fastest?
- Have I confused "easy for me now" with "simple for everyone later"?
- Is there a more elegant structure I haven't found yet — even one I would have to invent?
- Would the best architect I can imagine be satisfied with this?

**Red flags.**
- Settling on the first workable idea without searching for the elegant one.
- Choosing the path that's easy to write but complex to live with.
- "It's good enough" used as cover to avoid hard design thinking.
- Reaching for a shortcut the moment the design gets difficult.

---

## The through-line

Every principle here is one face of a single commitment: **the design comes first, and it must be genuinely good.** Treat the world as clean black boxes joined by deliberate connections; place every element on purpose, never because it merely fits; model what's missing instead of working around it; remove repetition and automate what repeats; concentrate complexity so the edges stay simple; refuse false tradeoffs; keep abstractions empowering and honest; design for whoever comes next; invert control toward pluggable seams; absorb your tools' weaknesses; lead with *why* and one consistent model; preserve understanding and proof; know when to stop; and always go the extra mile.

Techniques are how these get expressed today. The mentality is what makes the techniques good.

> **Related discipline.** This skill is the *mindset*. The day-to-day operational discipline that enforces it on real changes — fix the root cause, never patch, design and confirm refactors before implementing — lives in the `architecture-first` skill.
