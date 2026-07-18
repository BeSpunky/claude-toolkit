---
name: design-system-first
description: Design-system-first discipline - before you build any feature UI you go to the design system, and every visual value in the codebase comes from it. Use BEFORE writing or changing any component template or SCSS - and the moment you reach for a raw hex/rgb/hsl, a magic px/rem/em, an ad-hoc font stack or weight, a box-shadow, a border-radius, a hand-typed `transition: 200ms ease`, a copy-pasted card/button/panel/field, a `::ng-deep` reaching into another component, an `!important`, a one-off `@Input() variant` boolean, or a "just style it here for now". The core move - the design system is the SINGLE SOURCE OF VISUAL TRUTH, and a feature component is a COMPOSITION of design-system components and tokens, never a place where new visual values are invented: every colour, space, radius, type step, elevation, border, duration and easing is a TOKEN (a CSS custom property, consumed through the DS's SASS API), a component reads SEMANTIC tokens only (never a raw primitive), and every UI pattern that appears a SECOND time is PROMOTED into the design system as a reusable component (`nx g @bespunky/nx-tools:ds-component <name>` - one secondary entry point each) rather than copy-pasted, with BOTH sites migrated onto it and the copies deleted. When the design system LACKS the concept you need, you MODEL it (add the token, add the semantic alias, extend the scale, add the component) - you never work around the gap with a local override, an !important, a ::ng-deep reach-in, a duplicated token, or a variant boolean; a gap in the DS is a design gap, and patching it locally is the styling flavour of the patch that `bespunky-engineering:architecture-first` forbids, exactly as a magic literal is in logic - and it is worse, because CSS has no compiler to catch the drift, so it compounds silently until "change the brand colour" is a four-hundred-file diff. This is what makes a re-theme, a rebrand, or a redesign a change of TOKENS instead of a change to a thousand component files (the styling twin of `bespunky-product-ux:redesign-means-rethink` - re-token, don't re-hardcode). Triggers - "style this", "add a button/card/modal/table/form", "match the design", "make it look like X", "add dark mode", "change the brand colour", "this component needs its own styles", "make it consistent", any new feature UI, any new or edited component SCSS file. It is NOT the technique layer: for token taxonomy and naming, CSS custom properties, the SASS API, theming and modes, encapsulation, and the design system library's structure and entry points, route through `bespunky-design-system:design-tokens-and-theming`. It also does NOT invent the look - the visual system (palette, type, composition, motion language) comes from `bespunky-product-ux:stage-the-vision`; this skill enforces that the look lives in ONE place and is consumed, never re-typed.
---

# Design-system-first — the DS is the single source of visual truth

A design system is not a folder of components. It is a **claim**: that every visual value in this codebase
lives in exactly one place, and everything else *reads* it. That claim is either true or it isn't, and it is
destroyed one `#3b82f6` at a time — never by a decision, always by a hurry.

So the rule is absolute, and it has no size exemption. There is no colour small enough to hardcode, no
screen one-off enough to style locally, no deadline that makes a copy-pasted card cheaper. The moment you
allow the exception, the system stops being a source of truth and becomes a *suggestion* — and a suggestion
cannot be re-themed, cannot be rebranded, and cannot be redesigned without touching every file that ignored
it.

**The rule.** Every colour, space, radius, type step, elevation, border, duration and easing comes from the
design system, as a **token**. A feature component **composes** design-system components and tokens; it does
not **invent** appearance. Its own SCSS should be little more than layout.

## What a styling patch is (refuse these)

Each of these is a way of routing *around* the system instead of *evolving* it. They are the same smells
`bespunky-engineering:architecture-first` already forbids, wearing CSS.

- **A raw colour** — a hex, `rgb()`, `hsl()`, or a named colour in a component's SCSS or template. Exactly
  one file in the workspace is allowed to contain a literal colour: the token file. A raw colour **is** a
  magic value.
- **A magic dimension** — a bare `px`/`rem` for spacing, radius, border width, font size, line height. If
  the value isn't a step on a scale, then either the scale is missing a step or your design is off-system.
  Those are different findings, and both are worth knowing. Neither is fixed by typing `14px`.
- **A magic time** — `200ms`, a hand-typed `cubic-bezier(…)`. Duration and easing are tokens: the motion
  language is a **system**, not a per-component mood.
- **A copy-pasted pattern** — the second card, the second toolbar, the second empty state. This is not a
  shortcut; it is a **promotion signal** (see below), and ignoring it is how a design system dies with a
  full component library.
- **`::ng-deep`** (or a global selector reaching into another component's internals). This is
  *"reach into another module's internals"*, in CSS. It is banned outright — not discouraged, banned. A
  component you cannot style from outside is missing a **token** or a **part**; *that* is the finding, and
  a piercing selector buries it.
- **`!important`** — an admission that specificity is being *fought* rather than designed.
- **A one-off `variant` boolean** — `@Input() isCompact`, `@Input() isDanger`, `@Input() isBig`. Three
  booleans are eight states, of which you designed three. Variants are **data**: a union type rendered as a
  host attribute the SCSS selects on.
- **A duplicated token** — re-declaring `--brand-500` locally "so it's handy here". Now there are two
  truths, and one of them will drift.
- **A local override of a DS component's internals** — wrapping it in a div and re-styling its guts. If the
  component doesn't bend the way you need, its **API** is the thing to change.

## The loop — run it before any UI change

1. **State the surface** in one sentence. What is this, in this app, at this moment?
2. **Go to the design system.** Read what's there: which components, which tokens, which mixins. Not
   *"check if"* — **go**. You cannot compose from a system you haven't read, and the single most common
   cause of a hardcoded value is not knowing the token existed.
3. **Ask the question:** does the DS *account for* this, or only *almost* fit?
   - **Fits** → compose it. Done.
   - **Almost fits** → you are standing on a **design-system boundary**. Do not force it. Go to 4.
4. **Model the missing concept — in the design system.** (See below.) Design it, confirm it if it's a
   structural change (that's an `architecture-first` refactor gate), then **generate** it.
5. **Compose** the feature UI from DS components and semantic tokens.
6. **Check the ledger.** Did the number of hardcoded values, duplicated patterns, and piercing selectors go
   **down**, stay flat, or **grow**? It must not grow. That is the whole discipline, measured.

## The promotion loop — the second occurrence is the signal

You are allowed to write a UI pattern **once**.

- **First occurrence** — build it in the feature that needs it, *from tokens*. It is allowed to live there.
  You do not yet know its contract, and abstracting from one example is guessing.
- **Second occurrence** — **stop. Do not copy.** This is the moment. The pattern has now proven it is a
  **concept** rather than a coincidence, and two real use-sites are *exactly* enough evidence to design its
  API honestly. (One is a guess. Three is debt — by then the copies have diverged and the migration is
  archaeology.)
- **Promote it:**
  ```bash
  nx g @bespunky/nx-tools:ds-component <name>
  ```
  One secondary entry point, importable as `@<scope>/design-system/<name>`, independently tree-shakeable.
  **Never hand-create the folder** — the entry-point config *is* the boundary; a hand-made folder resolves
  in the editor and vanishes on publish.
- **Design its API from the two real consumers** — not from imagination. Inputs are **data**; variants are a
  **union**; structure is **projected content**; the styling surface is **tokens in, parts out**. (See
  `bespunky-engineering:angular-architecture` → component API ergonomics.)
- **Migrate BOTH sites and delete the copies.** A promotion that leaves the original behind is not a
  promotion — it is a third copy, and now the divergence has a blessed version to hide behind.

**What does *not* get promoted:** a layout that is genuinely this-screen-only; a one-off editorial or hero
moment from a `stage-the-vision` Staging. The test is **genericness**, not repetition of pixels. Two screens
that happen to both have a rounded box are not a `Card` — *know when not to build*.

## When the design system lacks the concept — model it, don't work around it

The gap **is the finding**. Name it precisely, because the fix differs:

| The gap | What it looks like | The move |
| --- | --- | --- |
| A **token** | The system never had this value at all | Add it, in every mode |
| A **semantic alias** | The value exists but not the *meaning* — you need `--surface-raised`, and all you can find is `--gray-100` | Add the semantic name. A component that reads a primitive is reading a swatch, and a swatch cannot survive a re-theme |
| A **scale step** | The space scale jumps 16 → 24 and you want 20 | Either the scale is wrong, or your design is off-system. Decide which — don't split the difference with a literal |
| A **component** | The pattern is real and reusable | `ds-component`, then migrate |
| A **styling hook** | A DS component won't bend, and you were about to `::ng-deep` past it | Give it a token or a `::part`. The reach-in is the symptom; the missing hook is the bug |

Then **consume** what you added. It now exists for everyone, forever — which is the entire return on the
thirty seconds it cost.

**The refusal:** never solve a design-system gap inside a feature file. That is precisely the move
`architecture-first` calls a patch, in CSS clothing — and it is *worse than the TypeScript equivalent*,
because there is no compiler, no type error, and no test that fails. It compounds in total silence until
someone asks to change the brand colour and the answer is a four-hundred-file diff.

## Feature components compose; design-system components define

Two roles, and confusing them is how the system rots:

- A **design-system component** *defines* appearance. It owns a look, exposes a contract (tokens in, parts
  out, variants as data), and is the only place that look exists.
- A **feature component** *composes*. Its SCSS should be mostly **layout** — grid, flex, gap, using space
  tokens. The moment a feature component starts defining *appearance* (a shadow, a border treatment, a
  hover state with a colour it chose), that appearance belongs in the design system, and you are watching
  the fork happen in real time.

## A redesign is a token change

This is the payoff, and it is also the test.

If a redesign — new palette, new type, new motion — forces you to touch every component, **the design
system failed**, and what you are looking at is the itemized bill for every value that was hardcoded. A
system built this way ships a rebrand as a diff to *one file*.

So when `bespunky-product-ux:redesign-means-rethink` sends a new visual system your way, it lands in the
**tokens**. **Re-token; don't re-hardcode.** And if you *can't* — if the new design can't be expressed in the
token layer — that is a real finding about the token layer, not a licence to start typing hex.

## Stop signals

> "I'll just use `#3b82f6` here." · "It's only one pixel value." · "Let me copy this card and tweak it." ·
> "I'll add an `isCompact` input." · "I'll `::ng-deep` into it — it's faster." · "`!important` will fix it."
> · "I'll add the token later." · "The DS doesn't have it, so I'll do it locally for now." · "It's just this
> one screen."

Every one of them is the same sentence: *the system is inconvenient right now.* It always is. That's what
makes it a discipline rather than a preference.

## Done criteria

- **Zero** raw colours, magic dimensions, and hand-typed durations outside the token file.
- **Zero** `::ng-deep`. **Zero** `!important`.
- Every pattern that appeared twice was **promoted**, and **both** call sites migrated.
- Every concept the DS was missing was **added to the DS**, at the right tier, via the generator.
- A re-theme would touch **tokens only**. (Ask it out loud. If the honest answer is "and also these six
  components", you are not done.)

## Keeping the rule always-on in a project

A skill only fires when it is judged relevant — not good enough for a rule that must hold on *every* UI
change. So the policy has two halves: this skill (the depth) and an **always-on directive** in the project's
`CLAUDE.md`. Scaffolded projects get it automatically (it lives in the generated `HOUSE.md` →
*Design-system-first*); existing projects paste the canonical directive from the toolkit's `README.md`
("The always-on half").

> **Origin.** The styling half of the house's architecture policy. `bespunky-engineering:architecture-first`
> governs logic; this governs the visual layer — same refusal to patch, same insistence on modelling the
> missing concept, applied to the one layer where the compiler can't help you.

> **Related.** `bespunky-engineering:architecture-first` (the same no-patch logic — a raw hex *is* a magic
> value, a duplicated card *is* copy-paste) · `bespunky-engineering:architect-mentality` (*model the missing
> concept*, *place everything on purpose*, *never do the same thing by hand twice*, *design for the
> consumer*) · `bespunky-design-system:design-tokens-and-theming` (the *how* — tokens, the SASS API,
> theming, encapsulation, the library's entry points) · `bespunky-product-ux:stage-the-vision` (where the
> visual system comes *from* — this skill doesn't invent the look, it makes it live in one place) ·
> `bespunky-product-ux:redesign-means-rethink` (a redesign changes tokens, not a thousand files) ·
> `bespunky-engineering:angular-architecture` (a promoted component's input/output API) ·
> `bespunky-engineering:nx-monorepo-and-dx` (the design system's boundaries and entry points).
