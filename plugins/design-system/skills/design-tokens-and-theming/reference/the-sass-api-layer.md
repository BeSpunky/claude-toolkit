# The SASS API layer — and how it's summoned

The author-time half of the system. Its job is to make **reading a token easier than typing a value** — because
that is the only thing that actually holds the discipline. A design system whose API is awkward loses to a hex
code every single time, and no amount of policy fixes that.

## The zero-output rule

**`@use`-ing the design system must emit ZERO CSS.**

This is not a stylistic preference; it is what makes the API summonable *per file*. Twenty components each
`@use` the design system, and twenty times nothing is emitted — until one of them calls a mixin, which emits
only into that component's stylesheet. Break this rule and every `@use` becomes a side effect, duplicated once
per importing file, and the bundle grows with the team.

So the SASS layer contains only: **functions** (return a value, emit nothing), **mixins** (emit only when
called), **placeholders** (emit only when extended), and **variables/maps** (emit nothing). The single
deliberate exception is the theme-emission mixin — and it is a *mixin*, so it emits only where you call it,
which is exactly once, in the app's global stylesheet.

## The module system: `@use` / `@forward`, never `@import`

`@import` is deprecated and dumps everything into one global namespace, so two libraries with a `$primary`
silently clobber each other. `@use` gives each module a namespace and loads it **once** no matter how many
files ask for it.

```scss
@use 'design-system/styles' as ds;   // namespaced, loaded once, emits nothing
```

`@forward` is how a barrel re-exports what it wraps — and, crucially, how it **chooses** what to re-export.

## Public vs private — the contract, enforced twice

A design system without a boundary between its API and its implementation is just a pile of files everyone
reaches into, and then nothing can ever be renamed. So the separation is structural **and** at the export
level:

**1. At the export level** — one file enumerates the public API, with explicit `show` lists:

```scss
// styles/_index.scss — THE CONTRACT
@forward '_core/tokens'    show $prefix;    // the maps stay private; only the namespace is public
@forward '_core/functions' show token, color, space, radius, duration, easing, z;
@forward '_core/theme'     show theme, mode, declare;
@forward '_utils/mixins'   show $breakpoints, media, focus-ring, transition;
```

**Adding a member does not publish it.** Publishing is a deliberate act, performed here — and *what you export,
you must support*. A member you never exported is one you can rename, reshape, or delete tomorrow.

**2. At the folder level** — the implementation lives in folders whose name starts with **`_`**. A
`@use '<ds>/styles/_core/tokens'` from outside the library is now *visibly* a violation, not a
plausible-looking import someone made by accident.

But **do not call the folder `internal`.** The `_` already carries the access level; the *name* is your one
chance to say **what the thing is** — so spend it: `_core` (the token engine), `_utils` (the authoring
toolkit), `_parts`, `_material`. "Internal" tells a reader only what they already knew from the underscore,
and it invites the classic junk-drawer: one bucket that accretes everything private until it has no meaning
at all. A private grouping is still a *concept*, and concepts get named.

**3. And file-private members.** A SASS member whose name starts with `-` or `_` (`-clamp-step()`) is private
to its **file** and cannot be `@use`d at all, even by a sibling partial. Reach for it for a genuinely local
helper — it is a finer instrument than a folder.

Note what is *not* public in the house system: the token **maps** themselves. If a consumer could read
`$modes`, they could bake a hex into their stylesheet at compile time — which would compile fine, look right,
and silently not re-theme. The accessors return `var()` references precisely so that cannot happen, and hiding
the maps is what makes the accessor the only road.

## Accessors that fail on a typo

```scss
@function token($key, $fallback: null) {
  @if not list.index($all-keys, $key) {
    @error 'Unknown design token `#{$key}`. Declare it in the design system first.';
  }
  @return var(#{var-name($key)});
}
```

Without the guard, `ds.token('color-primry')` compiles happily and emits `color: var(--ds-color-primry)` — an
undeclared property that resolves to nothing, so the browser drops the declaration and you get inherited black
on black, with **no error anywhere**. With the guard it is a **build failure**, at the typo, by name.

This is the single highest-leverage twelve lines in the whole layer: it converts CSS's silent-failure model
into a compiler.

Then layer typed facades over it — `ds.color('surface')`, `ds.space(3)` — so the *category* is enforced too and
the call site reads like a sentence.

## How the API resolves (the part that actually bites)

Three consumers, three channels — and they are genuinely different mechanisms, which is where people get stuck:

| Consumer | Channel |
| --- | --- |
| **The app**, in-repo | A **sass load path** on the build target (`stylePreprocessorOptions.includePaths`) |
| **The library's own components**, under ng-packagr | `ng-package.json` → `lib.styleIncludePaths` (ng-packagr does *not* read the app's builder options) |
| **A published consumer** | The package's `exports` map (`"./styles": { "sass": "…" }`), with the raw `.scss` shipped to `dist` as an asset |

**Why a load path in-repo, and not a package import?** Because an Nx workspace that links via
`tsconfig.base.json` path aliases has **no `node_modules/@scope/design-system`** to resolve against — and
**SASS does not read tsconfig paths**. Every `pkg:`-flavoured mechanism goes through node module resolution,
so in-repo there is nothing for it to find. A load path is not a workaround; it is the only channel that
exists.

Point the load path at the library's **parent** directory, so the in-repo specifier is the published one minus
the npm scope:

```scss
@use 'design-system/styles' as ds;            // in-repo
@use '@acme/design-system/styles' as ds;      // published
```

One mental model, and the library **dogfoods its own public entry point** — the same barrel a consumer gets.
That is how you find out the contract is wrong before a consumer does.

> **⚠️ The Nx cache trap.** The app reaches the design system's *sass* through a **load path**, which on its
> own creates **no edge in the Nx project graph** — so if the app didn't also import the DS in TypeScript,
> editing a token would not invalidate `nx build <app>` and Nx would replay a cached bundle with the *old*
> tokens. In practice the house wiring also imports `provideDesignSystem` from the DS (a tsconfig-path
> alias, which Nx *does* resolve into an edge), so the edge usually exists — but relying on that coupling is
> fragile. Declare the dependency **explicitly** instead: the idiomatic Nx tool is
> `implicitDependencies: ['<ds-project>']` on the app (a real graph edge — `nx affected` stays correct too),
> **not** a hand-rolled `inputs` array, which silently *overrides* the target's inferred inputs and hard-fails
> `nx build` on any workspace whose `nx.json` doesn't define the named input you referenced. The house
> `design-system-styles` generator adds the implicit dependency for you.

## Mixins vs placeholders vs functions — choosing

| | Emits | Use for |
| --- | --- | --- |
| **Function** | Nothing (returns a value) | Token access, computation. `ds.space(3)` |
| **Mixin** | Only when called, per call site | Anything **parameterized**: `media('md')`, `focus-ring()`, `transition(color)` |
| **Placeholder + `@extend`** | Once, merged into a shared selector | A **fixed, argument-less** rule body used many times in *one* stylesheet: `%visually-hidden` |

`@extend` merges selectors within the stylesheet it runs in, so it **cannot cross a component-stylesheet
boundary** (each Angular component compiles alone), and it can produce surprising selector explosions when
extended from many places. Reach for a mixin unless the rule body is fixed and argument-less.

## Pitfalls

- **A `@use` that emits CSS** — the zero-output rule broken; now every importing file pays.
- **`@import`** anywhere — global namespace, silent collisions, deprecated.
- **Forwarding everything** (`@forward '_core/tokens';` with no `show`) — you have just published the
  implementation, including the maps, and you now support it.
- **Reaching into `_core/` or `_utils/`** from an app — it will work, right up until the library reorganizes.
- **Exposing the token maps** — a consumer bakes a hex at compile time, it looks right, and it never re-themes.
- **Skipping the unknown-token `@error`** — you have traded a build failure for an invisible runtime one.
- **Forgetting the Nx `inputs` entry** — stale cached bundles, and the worst debugging afternoon of the quarter.

**Mentality anchors:** *Concentrate complexity so the edges stay simple* (one `@use`, and the consumer never
learns the plumbing) · *Design for the consumer* (if reading a token is harder than typing a hex, the hex wins) ·
*Abstractions must stay honest* (the barrel is the contract; what it doesn't name, it doesn't owe you).
