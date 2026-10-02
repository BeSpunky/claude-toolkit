---
name: typed-reactive-navigation
description: >-
  Navigation is never a raw router call in a component - it is strongly typed, reactive, and per-domain. Use whenever you add or change navigation, route to a screen/detail/dialog/edit/create, wire a "go to X" interaction, organize a domain's routes, or catch yourself writing a hand-built path in a component or service - `router.navigate([...])` / `routerLink="/literal"` (Angular), `navigate('/x/' + id)` / `Link to="/literal"` (React Router), `router.push(...)` (Vue / Next), `history.pushState`; or when a link lost its href to a click handler. Any router, any framework. Per domain: one typed ROUTE REGISTRY that the route config and the navigation API both derive from; a NAVIGATION SERVICE whose typed commands take entities, never routes; URL-derived route-state SELECTORS as the reactive read side; an EVENT BUS of facts plus a pure event-to-command BINDING. Links stay real links. Partner to `resumable-state`; Angular is an adapter reference.
---

# Typed, reactive navigation

**The rule: a component never builds a route by hand.** No `router.navigate(['/orders', o.id])`, no `navigate('/orders/' + o.id)`, no `[routerLink]="['/orders', o.id]"` / `<Link to="/orders/…">` / `<a href="/orders/…">` literal, no path strings scattered through components and feature services — whatever the router. Every path comes from **one typed, per-domain source — the route composer** — which produces the route as a **value** (a commands array / URL). The component names a destination *by entity*; a typed seam turns it into the URL.

Why this is non-negotiable: hand-built paths scatter route knowledge across the app (change a path → hunt down every caller), couple components to URL structure, and can't be type-checked (a typo fails silently at runtime). Centralizing the path behind one typed composer fixes all three and — because *a route is a state* — lets the whole app react to route changes uniformly, no matter what caused them. **Crucially, the composer is a *value*, not a side effect** — which is exactly what lets the same typed path power a real `<a href>` *and* a programmatic navigate, so going typed never costs you a real link (see *Links must stay links* below).

**On your stack.** Everything below is stack-agnostic — any router (Angular Router, React Router, Vue Router, Next, SvelteKit, a hand-rolled history wrapper), any reactive primitive (signals, observables, store selectors), any scoping mechanism (DI, context, a module instance). Code samples use Angular because that is the realization the toolkit ships; the concrete build per stack lives in an **adapter reference** — Angular in [`reference/angular-techniques.md`](reference/angular-techniques.md). A house project lists the layers it wears in its `HOUSE.md` stamp (`layers=`); the `navigation` layer is the Angular adapter's scaffolding (see *Scaffold it*).

## Two layers — a reusable kernel, then thin per-domain config

Almost all of the structure below is **reusable** and belongs in one place, not regenerated per domain. Split it:

- **`navigation-core` — the kernel, scaffolded once per workspace.** The route **composer** (pure `(entity) → path/commands`), the **auto-derived typed navigator** (derive `toX(entity)` methods from the typed route tree — *no per-domain navigation code*), the generic **link primitive** (one directive/component — `[bsNavLink]` in the Angular adapter — real `href` from the composer), the **`RouteState`** read-side base, a generic **`EventBus<T>` + `bindEvents`**, and the **navigation middleware** pipeline. In a house project wearing the `navigation` layer (Angular) this is `nx g @bespunky/nx-tools:navigation-core`, which vendors BeSpunky's **`navigation-x`** (`angular-zen`) for the composer + auto-navigator and adds the rest; on another stack, the same kernel is a small library you write once.
- **The domain layer — thin, per domain.** Only what's genuinely domain-specific: the **typed route config** (the registry, `as const`), the **entity / event / target types**, and the **event → command mapper**. Everything else is *inherited* from the kernel. The link primitive, the event bus, the selectors base, and the composer are **not** regenerated — that they once were is the tell that they belonged in the kernel.

A new domain is then ~2–3 thin files plugged into the kernel, not ~8 bespoke ones. The five parts below describe the *concepts*; the kernel implements the reusable ones **once**.

## The architecture — per domain

Five parts. The first three are the typed core; the last two add the reactive, decoupled event layer. (Per *Two layers* above, the reusable implementations live in `navigation-core`; a domain supplies only the typed route config, its types, and the mapper.)

### 1. Route registry — one typed source, derive everything

Define every route of the domain **once**, as a typed descriptor: its path pattern, its path-param types, its query schema, its fragment. From that single registry, **derive** (a) the router's route config (Angular `Routes`, a React Router route tree, …), (b) the navigation commands, and (c) the route-state selectors. This is the single-source-of-truth taken to its end: the path lives in exactly one place, typed — so it can never drift from the code that builds the URL or the code that reads it. (Typed paths lean on `advanced-typescript` — template-literal types.)

### 2. Navigation service — typed commands that take entities, not routes

One strongly-typed method per route, named for *intent* (`toOrder`, `toEdit`, `toCreate`, `toList`), each receiving **models / entities / values / config** — `toOrder(order: Order)`, `toList(filter: OrderFilter)` — **never a route or route config**. Internally it consults the registry's **composer** (the same value-producing source that links use) and is the **only** place in the domain that *imperatively* navigates. This is what:
- **centralizes and strong-types routes** (callers pass an `Order`, not a path),
- **strips raw router calls out of components and services** (they call `nav.toOrder(order)`),
- makes navigation **refactor-safe** (change the path in the registry; every caller still compiles).

### 3. Route-state selectors — the read side (because a route is a state)

The commands above are *writers* of the route state. The URL is its **single source of truth**, so there must be a typed, reactive **read side**: per-domain selectors derived from the URL — `openOrderId()`, `filter()`, `mode()`, `activeTab()` — exposed as **reactive values** (signals, observables, store selectors — whatever your stack reacts to). **Components react to these selectors, never to the act of navigating.** This is the crux: a route change from *any* source — a click, the **back button**, a **deep link**, a notification, programmatic nav — re-derives the selectors, and the UI updates the same way every time. *That* is the reactivity. (This is the same source-of-truth the `resumable-state` skill establishes — selectors are how a domain consumes it.)

### 4. Event bus — interactions emit facts, not destinations

A per-domain, strongly-typed **event bus** (a discriminated union of domain events). User interactions **emit facts/intents** — `orderSelected`, `createRequested`, `filterChanged` — **named for what happened, never for where to go** (`navigateToOrder` is wrong; the emitter must not decide the destination). **For these decoupled interactions, components emit events; they don't navigate imperatively.** (A plain link to a place still stays a real link fed by the composer — see *Links must stay links*; the bus is for programmatic/decoupled flows and non-link interactions, not for replacing links.) Scope the bus to the domain (DI, context, a module instance) so events don't leak.

### 5. Binding — event → command, as a pure function

A third service **hooks the event bus to navigation**: it maps each `DomainEvent` to a navigation **command**, as a **pure function** (`event → NavigationCommand`), then executes it. Because it's pure and Router-free, it's trivially unit-testable, and **multiple events fold into the same navigation** right here in one obvious, typed place (`orderSelected` and `orderOpenedFromSearch` and `orderDeepLinked` all map to `toOrder`). The binding is the inversion-of-control seam: interactions know nothing of routes; the navigation service knows nothing of who triggered it.

## Links must stay links — the composer is a value, not a side effect

Replacing a link with a click handler that *navigates* throws away the `href` — and with it **copy-link-address, open-in-new-tab (ctrl/cmd/middle-click), hover-preview, SEO, and screen-reader link semantics.** That's a real UX/accessibility regression, and it's entirely avoidable. The fix falls straight out of part 1: the registry's **composer produces the route as a value** (a commands array / URL), and a value can be an `href` *and* a `navigate()`.

So **don't ban links — ban hand-built paths.** Anything that means *"go to a place"* stays a real link, fed by the composer. In Angular:

```html
<a [routerLink]="ordersLinks.detail(order)">{{ order.name }}</a>
```

(React Router: `<Link to={ordersLinks.detail(order)}>`; Vue: `<RouterLink :to="…">`; no framework: `<a href>` plus a click handler that defers to the browser on modifier clicks.) Angular's `RouterLink` natively sets a real `href` from the commands and, on click, intercepts only a **plain left-click** — modifier and middle clicks fall through to the browser (open in new tab), and right-click *Copy link address* works. You keep all of that **and** the typed, centralized path.

For the reactive/event layer on a link, wrap your router's link primitive (or compose the `href` yourself) in a small **link directive** that, on a plain click, routes through the domain event bus / middleware, but on a modifier or middle click lets the browser open the real `href`. The result is **both** a real link **and** a typed, reactive trigger. (This is the value-producing primitive at the heart of BeSpunky's `navigation-x` — its `RouteComposer` is a pure `(entity) → path`; see `reference/angular-techniques.md` for the directive.)

Split the surfaces by what the interaction *is*:
- **A link to a place** → a real link fed by the composer (preserve the `href`).
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

Because all navigation flows through the command pipe, insert cross-cutting concerns **once**, not scattered as guards: **unsaved-changes confirmation** (pairs with `resumable-state`'s leave-guard — `canDeactivate` in Angular), **auth redirect + `returnUrl`**, **analytics / breadcrumbs**, scroll restoration. Model them as an interceptor chain over the command.

## Scaffold it — kernel once, thin config per domain

Concentrate the ceremony in generators. In a house project wearing the `navigation` layer (today the Angular adapter — the `HOUSE.md` stamp's `layers=` lists `navigation`), the house ships two:

```
nx g @bespunky/nx-tools:navigation-core              # once per workspace — the reusable kernel
nx g @bespunky/nx-tools:domain-navigation <domain>   # per domain — thin config on top of the kernel
```

`navigation-core` scaffolds the kernel — the composer, the auto-derived typed navigator, the `[bsNavLink]` directive, `RouteState`, `EventBus` + `bindEvents`, and the middleware pipeline (vendored from `navigation-x` plus the reusable additions). `domain-navigation` then scaffolds only the **per-domain config** — the typed route tree, the entity/event/target types, and the event → command mapper — which plug into the kernel; the directive, bus, selectors base and composer are inherited, never regenerated. (Generator-first / *automate every repeated process* / *concentrate complexity*.)

## When to use the whole thing — and when not to

The full five-part set earns its keep when a domain has **multiple interactions converging on the same navigation** and **real deep-linking / resumability** needs. For a small domain with one or two routes and linear flow, the **typed registry + navigation service + selectors (parts 1–3)** are enough — they already remove raw navigation and centralize routes. Add the **event bus + binding (parts 4–5)** when several events must fold into one navigation, or when you genuinely need to decouple *what the user did* from *where it goes*. Don't pay the indirection tax where there's nothing to converge.

## Ask yourself

- Is there any **hand-built path** — `router.navigate(['/x', id])`, `navigate('/x/' + id)`, `[routerLink]="['/x', id]"`, `<Link to="/x">` — in a component or feature service? It belongs in the composer; links then bind to that composer, not to a literal.
- Is anything that's conceptually **a link to a place rendered as a `(click)` handler**, losing its `href` (copy-link, open-in-new-tab, a11y)? Make it a real link fed by the composer.
- Does each navigation method take an **entity/value/config**, not a route or path?
- Are routes defined in **one typed registry**, with the router config and the nav API **derived** from it — or written twice and able to drift?
- Is there a **read side** — typed selectors off the URL — that components react to, so the **back button and deep links** behave identically to a click?
- Do interactions **emit events named for what happened**, leaving the destination to the binding — or do components decide where to go?
- Is the **event → command** mapping a **pure, testable function**, with multiple events folding into one navigation in that one place?
- Does cross-domain navigation go through an **app-shell binding** (an emitted event), or is one domain importing another's navigation service?
- Are cross-cutting concerns (unsaved-changes, auth, analytics) inserted **once at the funnel**, or scattered?

## Red flags

- **A hand-built path** — `router.navigate([...])`, `navigate('/x/' + id)`, or a link bound to a literal array/string inside a component/service — route knowledge leaking out of the composer.
- **A "go to a place" link rendered as a `(click)` handler that navigates** — silently drops the `href`, so users can't copy the URL, open it in a new tab, or middle-click it, and screen readers/SEO lose the link. Feed the link from the composer instead.
- **Route paths written in two places** (the router config and a navigation method) that can drift.
- **Navigation methods that take a route/path/config** instead of an entity/value.
- **No read side** — components hold a private "selected"/"mode" field, so the back button and deep links desync the UI.
- **Events named for destinations** (`goToOrder`) — the emitter deciding the route, defeating the binding.
- **An imperative, Router-coupled binding** that can't be unit-tested, instead of a pure `event → command` function.
- **One domain importing another domain's navigation service** — cross-domain coupling the bus was meant to prevent.
- **The full bus+binding on a trivial 1–2-route domain** — indirection with nothing to converge (the opposite failure).

---

> **Related.** Partner to **`resumable-state`** — that skill establishes *the URL is the single source of truth for navigational/view state* (deep-linkable, refresh-safe); **this skill** is *how you command and observe that state*: typed per-domain commands write it, typed selectors read it, an event bus + pure binding decouple interaction from destination. The decoupling, single-source-of-truth, and pure-mapping moves are `bespunky-engineering:software-design` (decoupling & dependency inversion, contracts & API design, domain modeling); the typed route paths and event unions are `bespunky-engineering:advanced-typescript`; in Angular, the DI-scoped bus and provider wiring are `bespunky-angular:angular-architecture` (DI & providers). The whole thing realizes `bespunky-engineering:architect-mentality` — *everything is a black box with deliberate one-directional connections*, *model the missing concept* (navigation as a typed domain capability; the event bus; the binding), *concentrate complexity*, and *automate every repeated process* (the `domain-navigation` generator). For the concrete Angular build, read the adapter reference **`reference/angular-techniques.md`**.
