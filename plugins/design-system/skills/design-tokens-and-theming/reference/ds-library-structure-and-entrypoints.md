# The design-system library — structure & entry points

The general rule (`bespunky-engineering:nx-monorepo-and-dx` → library boundaries and entry points) is *one
folder = one entry point*, and **the entry-point config is the only thing that declares the boundary**. This
file is that rule applied to a design system, where it has three consequences people routinely miss.

## The shape

```
packages/design-system/
├── styles/                      the SASS surface
│   ├── _index.scss              ★ PUBLIC — @forward … show; the only file anyone outside @use's
│   ├── _core/                   the TOKEN ENGINE (private)
│   │   ├── _tokens.scss         the token maps — the ONLY file with a literal value in it
│   │   ├── _functions.scss      the accessors
│   │   └── _theme.scss          the one emission
│   └── _utils/                  the AUTHORING TOOLKIT (private)
│       ├── _mixins.scss
│       └── _placeholders.scss
├── src/
│   ├── index.ts                 ★ PUBLIC — the primary entry point (@scope/design-system)
│   └── lib/                     the implementation. NO COMPONENTS.
└── button/                      one promoted component = one SECONDARY ENTRY POINT
    ├── ng-package.json          ← THIS FILE IS THE BOUNDARY
    └── src/
        ├── index.ts             ★ PUBLIC — the entry's contract
        ├── button.component.ts
        └── _parts/              helpers, sub-components, types a consumer must not depend on
```

Note the private folders: **`_`-prefixed, and named for *what they are*** — `_core`, `_utils`, `_parts` — never
a bucket called `internal`. The underscore already says *private*; the name is your one chance to say *what
it is*, and a folder named for its access level inevitably becomes the junk drawer everything private gets
tipped into.

Three kinds of surface, and each publishes differently:

1. **The SASS entry point** — the only one with a side effect (the theme emission), and even that only when
   *called*. Resolved in-repo via a **sass load path** and published via the package `exports` map. (See *The
   SASS API layer* — SASS cannot read tsconfig paths, so the load path is not a workaround, it's the only
   channel.)
2. **The primary TS entry point** — deliberately tiny. In a design system, TypeScript is *not* the main
   surface: the theming service is about all that belongs here, because it's the one part of the mechanism CSS
   can't express.
3. **One secondary entry point per component** — `@scope/design-system/button`.

## Public vs private, enforced twice

Every surface has an API and an implementation, separated **structurally** (`_`-prefixed folders) *and* **at the export
level** (the `@forward … show` list; `index.ts`). Adding a file does not publish it — publishing is a
deliberate act, performed in the barrel.

**What you export, you must support.** A member you never exported is one you can rename, reshape, or delete
tomorrow without a major version. That freedom is the entire return on keeping the barrels small.

And the library **consumes its own public API**: the design system's own components `@use` the same `styles`
barrel an app does, rather than reaching into `_core/`. If the barrel doesn't expose something the library
itself needs, that is a **missing public concept** — not a licence to reach past it. Dogfooding the contract is
how you find out it's wrong before a consumer does.

## One component = one entry point (not one shared barrel)

The alternative — a single `@scope/design-system/components` barrel re-exporting everything — looks tidier and
costs you three things:

- **Tree-shaking.** Import one component, and the barrel's module graph drags the rest in. Bundlers are better
  at this than they used to be; they are not perfect, and Angular components with providers and side-effectful
  decorators are exactly the case where they aren't.
- **Boundaries.** Each component is its own black box, with its own dependency surface. A shared barrel makes
  them one box with a very wide contract.
- **Peace.** A single ever-growing barrel is a merge-conflict hotspot on every branch that adds a component.

## Zero components at scaffold time — on purpose

The house design system is born with **no components**. This is not incompleteness; it is the point.

A pre-baked `Button` in a fresh design system is the first thing someone copies, and it teaches exactly the
wrong lesson: that components arrive by *fiat*, from the framework, rather than by **promotion** from a real
second use-site. It also arrives with a look nobody designed — a look that will quietly become the app's,
because nothing is more permanent than a placeholder that shipped.

So the library ships **structure, conventions, and the mechanism**. Components arrive when the discipline says
they've earned it: on the **second occurrence** of a pattern
(`bespunky-design-system:design-system-first` → the promotion loop).

## Adding a component is a generator call

```bash
nx g @bespunky/nx-tools:ds-component button
```

**Never hand-create the folder.** This is the consequence people miss: the `ng-package.json` **is** the entry
point. Without it, the component still *resolves in your editor* (the tsconfig path alias sees the file), it
still compiles, and it still works in dev — and then it **vanishes from the published package**, because
ng-packagr never knew the entry existed. The failure surfaces at a consumer's `npm install`, weeks later.

The generator also wires the entry's own sass load path and seeds a SCSS in which every value is already a
token — which is not cosmetic. That file is where a developer's first styling instinct lands, and an empty one
invites a hex.

## Keeping it publishable

- **The design system never imports from an app.** Not a type, not a constant, not "just this one enum". It is
  publishable; a reach-back makes that a lie, and it will be discovered by the build, at the worst moment.
- **Its dependencies are its own.** A component that quietly needs the app's `AuthService` is not a
  design-system component — it's a feature component in the wrong folder.
- **Version it as a unit.** All entry points ship together at one version; that's what makes the deep imports
  safe.

## When NOT to split

Don't give a part its own entry point because it *feels* separate. An entry point is a **boundary**, and
boundaries cost coordination. A component earns one when it has a genuinely distinct consumer — which, for a
design-system component, is essentially always (someone imports the button without wanting the table). But the
same is *not* true of, say, three private helper functions: those belong under a `_`-prefixed folder, not behind their
own subpath.

## Pitfalls

- **A hand-made component folder** — resolves in dev, missing from the package. The single most expensive
  mistake in this file.
- **Reaching into a `_`-prefixed folder** from an app — works, until the library reorganizes.
- **A private folder called `internal`** — the `_` already told the reader it's private; the name was your one chance to say *what it is*, and a bucket named for its access level becomes a junk drawer.
- **A barrel that re-exports everything** — tree-shaking loss, merge conflicts, one giant contract.
- **Shipping the SASS source but forgetting the `exports` entry** (or vice versa) — resolves in-repo, fails on
  `npm install`. Verify by building the package and reading the emitted `dist/**/package.json`, not by trusting
  the source.
- **Forgetting to declare the app→DS dependency** (via `implicitDependencies`) — if nothing else couples them, the app replays a cached bundle with stale tokens. (See
  *The SASS API layer*.)
- **A design system with an app-shaped dependency** — it was never publishable; you just hadn't tried yet.

**Mentality anchors:** *Everything is a black box* (the entry-point config is what makes the boundary real —
without it there is no box) · *Automate every repeated process* (a component enters through a generator, never
by hand) · *Place everything on purpose* (public or private is a decision, made in the barrel, not an accident
of where a file landed — and a private folder still earns a name that says what it holds).
