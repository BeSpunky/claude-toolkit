---
name: typed-reactive-navigation
description: Navigation is never a raw router call in a component — it is strongly typed, reactive, and per-domain. Use whenever you add or change navigation, route to a screen/detail/dialog/edit/create, wire a "go to X" interaction, design how a domain's routes are organized, or catch yourself writing `router.navigate([...])` / `routerLink="/literal/path"` with a hand-built path inside a component or a feature service. The architecture, per domain — (1) a single typed ROUTE REGISTRY where every route is defined once (path + param types + query schema + fragment), from which both the Angular `Routes` config AND the typed navigation API are derived, so a path can never drift from the code that builds it; (2) a NAVIGATION SERVICE exposing one strongly-typed COMMAND per route that receives MODELS/ENTITIES/VALUES/CONFIG — never routes or route config — and is the only place that talks to the Router (this centralizes + strong-types routes and strips raw Angular navigation out of components and services); (3) typed reactive ROUTE-STATE SELECTORS (signals derived from the URL) as the read side — because a route IS a state and the URL is its single source of truth, so a change from ANY source (a click, the back button, a deep link, a notification) flows through one reactive pipe and the UI re-derives; (4) a per-domain typed EVENT BUS that user interactions emit FACTS/INTENTS to (orderSelected, createRequested) — components emit events, they do not navigate; (5) a BINDING that maps event → navigation command as a PURE function, so multiple events can fold into the same navigation and the mapping is unit-testable with no Router. Cross-domain navigation goes through an app-shell binding (emit an event), never by one domain importing another's navigation service. The funnel is also the one place for navigation middleware (unsaved-changes confirmation, auth + returnUrl, analytics). Because the composer produces a route as a VALUE (commands array / URL), the same typed path feeds BOTH a real `[routerLink]` (so links keep their href — copy-link-address, open-in-new-tab, hover, SEO, a11y) AND the imperative navigator — so the invariant is "no hand-built paths," never "no routerLink"; a link that means "go to a place" stays a real `<a routerLink>` fed by the composer, and only programmatic/decoupled flows go through the navigation service + event bus. Use when a link or button lost its href because navigation became a click handler. Scaffold a domain's set with `nx g @bespunky/nx-tools:domain-navigation <domain>`. Agnostic principle + decision here; the Angular realization (route registry with typed paths, Router-wrapping commands, `toSignal` selectors, DI-scoped event bus, the binding, middleware, cross-domain) is in `reference/angular-techniques.md`. Partner skill to `resumable-state` (that one establishes the URL as the source of truth for navigational state; this one is how you command and observe that state, typed and decoupled).
---

# Typed, reactive navigation

**The rule: a component never builds a route by hand.** No `router.navigate(['/orders', o.id])`, no `[routerLink]="['/orders', o.id]"`, no `routerLink="/orders/…"` literal, no path strings scattered through components and feature services. Every path comes from **one typed, per-domain source — the route composer** — which produces the route as a **value** (a commands array / URL). The component names a destination *by entity*; a typed seam turns it into the URL.

Why this is non-negotiable: hand-built paths scatter route knowledge across the app (change a path → hunt down every caller), couple components to URL structure, and can't be type-checked (a typo fails silently at runtime). Centralizing the path behind one typed composer fixes all three and — because *a route is a state* — lets the whole app react to route changes uniformly, no matter what caused them. **Crucially, the composer is a *value*, not a side effect** — which is exactly what lets the same typed path power a real `<a href>` *and* a programmatic navigate, so going typed never costs you a real link (see *Links must stay links* below).

## Two layers — a reusable kernel, then thin per-domain config

Almost all of the structure below is **reusable** and belongs in one place, not regenerated per domain. Split it:

- **`navigation-core` — the kernel, scaffolded once per workspace.** The route **composer** (pure `(entity) → path/commands`), the **auto-derived typed navigator** (derive `toX(entity)` methods from the typed route tree — *no per-domain navigation code*), the generic **`[bsNavLink]` link directive** (one directive, real `href` from the composer), the **`RouteState`** read-side base, a generic **`EventBus<T>` + `bindEvents`**, and the **navigation middleware** pipeline. In the BeSpunky toolkit this is `nx g @bespunky/nx-tools:navigation-core`, which vendors BeSpunky's **`navigation-x`** (`angular-zen`) for the composer + auto-navigator and adds the rest.
- **The domain layer — thin, per domain.** Only what's genuinely domain-specific: the **typed route config** (the registry, `as const`), the **entity / event / target types**, and the **event → command mapper**. Everything else is *inherited* from the kernel. The `[bsNavLink]` directive, the event bus, the selectors base, and the composer are **not** regenerated — that they once were is the tell that they belonged in the kernel.

A new domain is then ~2–3 thin files plugged into the kernel, not ~8 bespoke ones. The five parts below describe the *concepts*; the kernel implements the reusable ones **once**.

## The architecture — per domain

Five parts. The first three are the typed core; the last two add the reactive, decoupled event layer. (Per *Two layers* above, the reusable implementations live in `navigation-core`; a domain supplies only the typed route config, its types, and the mapper.)

### 1. Route registry — one typed source, derive everything

Define every route of the domain **once**, as a typed descriptor: its path pattern, its path-param types, its query schema, its fragment. From that single registry, **derive** (a) the Angular `Routes` array, (b) the navigation commands, and (c) the route-state selectors. This is the single-source-of-truth taken to its end: the path lives in exactly one place, typed — so it can never drift from the code that builds the URL or the code that reads it. (Typed paths lean on `advanced-typescript` — template-literal types.)

### 2. Navigation service — typed commands that take entities, not routes

One strongly-typed method per route, named for *intent* (`toOrder`, `toEdit`, `toCreate`, `toList`), each receiving **models / entities / values / config** — `toOrder(order: Order)`, `toList(filter: OrderFilter)` — **never a route or route config**. Internally it consults the registry's **composer** (the same value-producing source that links use) and is the **only** place in the domain that *imperatively* navigates. This is what:
- **centralizes and strong-types routes** (callers pass an `Order`, not a path),
- **strips raw Angular navigation out of components and services** (they call `nav.toOrder(order)`),
- makes navigation **refactor-safe** (change the path in the registry; every caller still compiles).

### 3. Route-state selectors — the read side (because a route is a state)

The commands above are *writers* of the route state. The URL is its **single source of truth**, so there must be a typed, reactive **read side**: per-domain selectors derived from the URL — `openOrderId()`, `filter()`, `mode()`, `activeTab()` — exposed as **signals**. **Components react to these selectors, never to the act of navigating.** This is the crux: a route change from *any* source — a click, the **back button**, a **deep link**, a notification, programmatic nav — re-derives the selectors, and the UI updates the same way every time. *That* is the reactivity. (This is the same source-of-truth the `resumable-state` skill establishes — selectors are how a domain consumes it.)

### 4. Event bus — interactions emit facts, not destinations

A per-domain, strongly-typed **event bus** (a discriminated union of domain events). User interactions **emit facts/intents** — `orderSelected`, `createRequested`, `filterChanged` — **named for what happened, never for where to go** (`navigateToOrder` is wrong; the emitter must not decide the destination). **For these decoupled interactions, components emit events; they don't navigate imperatively.** (A plain link to a place still stays a real `<a routerLink>` fed by the composer — see *Links must stay links*; the bus is for programmatic/decoupled flows and non-link interactions, not for replacing links.) Scope the bus via DI to the domain so events don't leak.

### 5. Binding — event → command, as a pure function

A third service **hooks the event bus to navigation**: it maps each `DomainEvent` to a navigation **command**, as a **pure function** (`event → NavigationCommand`), then executes it. Because it's pure and Router-free, it's trivially unit-testable, and **multiple events fold into the same navigation** right here in one obvious, typed place (`orderSelected` and `orderOpenedFromSearch` and `orderDeepLinked` all map to `toOrder`). The binding is the inversion-of-control seam: interactions know nothing of routes; the navigation service knows nothing of who triggered it.

## Links must stay links — the composer is a value, not a side effect

Replacing a link with a click handler that *navigates* throws away the `href` — and with it **copy-link-address, open-in-new-tab (ctrl/cmd/middle-click), hover-preview, SEO, and screen-reader link semantics.** That's a real UX/accessibility regression, and it's entirely avoidable. The fix falls straight out of part 1: the registry's **composer produces the route as a value** (a commands array / URL), and a value can be an `href` *and* a `navigate()`.

So **don't ban `routerLink` — ban hand-built paths.** Anything that means *"go to a place"* stays a real `<a [routerLink]="…">`, fed by the composer:

```html
<a [routerLink]="ordersLinks.detail(order)">{{ order.name }}</a>
```

`RouterLink` natively sets a real `href` from the commands and, on click, intercepts only a **plain left-click** — modifier and middle clicks fall through to the browser (open in new tab), and right-click *Copy link address* works. You keep all of that **and** the typed, centralized path.

For the reactive/event layer on a link, wrap `RouterLink` (or compose the `href` yourself) in a small **link directive** that, on a plain click, routes through the domain event bus / middleware, but on a modifier or middle click lets the browser open the real `href`. The result is **both** a real link **and** a typed, reactive trigger. (This is the value-producing primitive at the heart of BeSpunky's `navigation-x` — its `RouteComposer` is a pure `(entity) → path`; see `reference/angular-techniques.md` for the directive.)

Split the surfaces by what the interaction *is*:
- **A link to a place** → a real `<a routerLink>` fed by the composer (preserve the `href`).
- **Programmatic navigation** (post-save redirect, an effect, multiple events converging) → the imperative navigation service.
- **The event bus** → programmatic/decoupled flows and non-link interactions; it is *not* a replacement for links.

## The loop — why it's reactive, and the black-box discipline

Trace one feature and notice every connection is **one-directional** and every unit is a **black box**:

```
interaction → emits DomainEvent → binding maps event → NavigationCommand
            → navigation service executes it on the Router → the URL changes
            → route-state selectors re-derive → the UI reacts
```

- The **component** emits an event (knows nothing of routes or the Router).
- The **binding** maps event → command (knows events + commands; not the Router, not who emitted).
- The **navigation service** executes the command (knows the registry + Router; not who asked).
- The **selectors** expose the URL as typed state (the read side everyone reacts to).

The URL is the hub. Navigation is just one writer of it; the back button and deep links are others — and because everyone *reads* through the selectors, all of them produce identical UI reactions. No component holds a private "current selection" that the back button can desync.

## Cross-domain navigation — through an app-shell binding, never domain→domain

A domain's navigation service knows **only its own routes**. When domain A must send the user into domain B, A **emits an event**, and an **app-level binding** routes it into B — A never imports B's navigation service. Otherwise the bus/binding indirection just hides fresh coupling. (Architect-mentality: never reach across a boundary into another box's internals.)

## The funnel is the home for navigation middleware

Because all navigation flows through the command pipe, insert cross-cutting concerns **once**, not scattered as guards: **unsaved-changes confirmation** (pairs with `resumable-state`'s `canDeactivate`), **auth redirect + `returnUrl`**, **analytics / breadcrumbs**, scroll restoration. Model them as an interceptor chain over the command.

## Scaffold it — kernel once, thin config per domain

Concentrate the ceremony in two generators:

```
nx g @bespunky/nx-tools:navigation-core              # once per workspace — the reusable kernel
nx g @bespunky/nx-tools:domain-navigation <domain>   # per domain — thin config on top of the kernel
```

`navigation-core` scaffolds the kernel — the composer, the auto-derived typed navigator, the `[bsNavLink]` directive, `RouteState`, `EventBus` + `bindEvents`, and the middleware pipeline (vendored from `navigation-x` plus the reusable additions). `domain-navigation` then scaffolds only the **per-domain config** — the typed route tree, the entity/event/target types, and the event → command mapper — which plug into the kernel; the directive, bus, selectors base and composer are inherited, never regenerated. (Generator-first / *automate every repeated process* / *concentrate complexity*.)

## When to use the whole thing — and when not to

The full five-part set earns its keep when a domain has **multiple interactions converging on the same navigation** and **real deep-linking / resumability** needs. For a small domain with one or two routes and linear flow, the **typed registry + navigation service + selectors (parts 1–3)** are enough — they already remove raw navigation and centralize routes. Add the **event bus + binding (parts 4–5)** when several events must fold into one navigation, or when you genuinely need to decouple *what the user did* from *where it goes*. Don't pay the indirection tax where there's nothing to converge.

## Ask yourself

- Is there any **hand-built path** — `router.navigate(['/x', id])` or `[routerLink]="['/x', id]"` — in a component or feature service? It belongs in the composer; links then bind `[routerLink]` to that composer, not to a literal.
- Is anything that's conceptually **a link to a place rendered as a `(click)` handler**, losing its `href` (copy-link, open-in-new-tab, a11y)? Make it a real `<a routerLink>` fed by the composer.
- Does each navigation method take an **entity/value/config**, not a route or path?
- Are routes defined in **one typed registry**, with the Angular `Routes` and the nav API **derived** from it — or written twice and able to drift?
- Is there a **read side** — typed selectors off the URL — that components react to, so the **back button and deep links** behave identically to a click?
- Do interactions **emit events named for what happened**, leaving the destination to the binding — or do components decide where to go?
- Is the **event → command** mapping a **pure, testable function**, with multiple events folding into one navigation in that one place?
- Does cross-domain navigation go through an **app-shell binding** (an emitted event), or is one domain importing another's navigation service?
- Are cross-cutting concerns (unsaved-changes, auth, analytics) inserted **once at the funnel**, or scattered?

## Red flags

- **A hand-built path** — `router.navigate([...])` or `[routerLink]="['/x', id]"` with a literal array/string inside a component/service — route knowledge leaking out of the composer.
- **A "go to a place" link rendered as a `(click)` handler that navigates** — silently drops the `href`, so users can't copy the URL, open it in a new tab, or middle-click it, and screen readers/SEO lose the link. Feed `[routerLink]` from the composer instead.
- **Route paths written in two places** (the `Routes` config and a navigation method) that can drift.
- **Navigation methods that take a route/path/config** instead of an entity/value.
- **No read side** — components hold a private "selected"/"mode" field, so the back button and deep links desync the UI.
- **Events named for destinations** (`goToOrder`) — the emitter deciding the route, defeating the binding.
- **An imperative, Router-coupled binding** that can't be unit-tested, instead of a pure `event → command` function.
- **One domain importing another domain's navigation service** — cross-domain coupling the bus was meant to prevent.
- **The full bus+binding on a trivial 1–2-route domain** — indirection with nothing to converge (the opposite failure).

---

> **Related.** Partner to **`resumable-state`** — that skill establishes *the URL is the single source of truth for navigational/view state* (deep-linkable, refresh-safe); **this skill** is *how you command and observe that state*: typed per-domain commands write it, typed selectors read it, an event bus + pure binding decouple interaction from destination. The decoupling, single-source-of-truth, and pure-mapping moves are `engineering:software-design` (decoupling & dependency inversion, contracts & API design, domain modeling); the typed route paths and event unions are `engineering:advanced-typescript`; the DI-scoped bus and provider wiring are `engineering:angular-architecture` (DI & providers). The whole thing realizes `engineering:architect-mentality` — *everything is a black box with deliberate one-directional connections*, *model the missing concept* (navigation as a typed domain capability; the event bus; the binding), *concentrate complexity*, and *automate every repeated process* (the `domain-navigation` generator). For the concrete Angular build, read **`reference/angular-techniques.md`**.
