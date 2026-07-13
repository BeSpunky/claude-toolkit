# Typed, reactive navigation — the Angular realization

The agnostic architecture lives in the SKILL: route registry → derive everything; typed commands that take entities; selectors as the read side; a typed event bus; a pure event→command binding; cross-domain through an app-shell binding. This file is the **how, in modern Angular** (standalone, signals, `inject()`, `provideRouter`). It pairs with `resumable-state` (the URL as source of truth) and `angular-architecture` (DI scoping, SSR).

> **Read this as the anatomy of the kernel, not as per-domain code.** Per the SKILL's *Two layers*, the reusable pieces below — the composer, the navigator, the link directive, the read-side base, the event bus + binding — live **once** in the `navigation-core` kernel (`nx g @bespunky/nx-tools:navigation-core`, which vendors BeSpunky's `navigation-x`). A **domain** supplies only thin config (`nx g @bespunky/nx-tools:domain-navigation <domain>`): the typed route tree (`routeConfigFor<Entity>().route({…} as const)`), its entity/event types, and the pure `event → navigator` mapper — then calls `useNavigationX(routes)` (navigates) and `useNavigationLinks(routes)` (composes the path value for `[bsNavLink]`/`[routerLink]`). The sections here show *what the kernel implements* so you understand the moving parts; you don't hand-write them per domain.

---

## 1. Route registry — define each route once, derive the rest

```ts
// orders.routes.ts — the SINGLE source of truth for the Orders domain's routes.
export const ORDERS_ROUTES = {
  list:   { path: '',         commands: () => ['/orders'] as const },
  create: { path: 'new',      commands: () => ['/orders', 'new'] as const },
  detail: { path: ':id',      commands: (id: string) => ['/orders', id] as const },
  edit:   { path: ':id/edit', commands: (id: string) => ['/orders', id, 'edit'] as const },
} as const;

// Derive the Angular config from the registry — paths come from ONE place.
// Pass your components in so this file owns route *structure*, not component identity.
export function makeOrdersRoutes(c: {
  list: unknown; create: unknown; edit: unknown; detail: unknown;
}): Routes {
  return [
    { path: ORDERS_ROUTES.list.path,   loadComponent: () => c.list as never },
    { path: ORDERS_ROUTES.create.path, loadComponent: () => c.create as never },
    { path: ORDERS_ROUTES.edit.path,   loadComponent: () => c.edit as never },
    { path: ORDERS_ROUTES.detail.path, loadComponent: () => c.detail as never },
  ];
}
```

The `commands()` builders are the typed link between "a route" and "the array the Router wants" — the navigation service calls them, never literal arrays. (Push the typing further with template-literal path types from `advanced-typescript` when you want the param names checked against the path.)

---

## 2. Navigation service — typed commands, the only Router caller

```ts
// orders-navigation.service.ts
@Injectable({ providedIn: 'root' })
export class OrdersNavigation {
  private readonly router = inject(Router);

  // Commands receive ENTITIES/VALUES, never routes. Name them for intent.
  toList(filter?: OrderFilter) {
    return this.router.navigate(ORDERS_ROUTES.list.commands() as unknown[], {
      queryParams: filter ? { status: filter.status } : undefined,
      queryParamsHandling: 'merge',
    });
  }
  toCreate()              { return this.router.navigate(ORDERS_ROUTES.create.commands() as unknown[]); }
  toOrder(order: Order)   { return this.router.navigate(ORDERS_ROUTES.detail.commands(order.id) as unknown[]); }
  toEdit(order: Order)    { return this.router.navigate(ORDERS_ROUTES.edit.commands(order.id) as unknown[]); }
}
```

Pass the **entity** (`toOrder(order: Order)`), not its id, wherever the caller already holds it — the service decides what part of the model becomes the URL. Components inject `OrdersNavigation` and call intent methods; they never see `Router`.

---

## 2b. Links stay links — `[routerLink]` from the composer, plus a link directive

The registry's `commands()` builders **are the composer** — a pure `(entity) → commands` value. (This is exactly the primitive at the heart of BeSpunky's `navigation-x` in `angular-zen`: its `RouteComposer.compose(entity)` is a pure `(entity) → path`, derived from the typed route tree and shared by every navigator.) Because it's a *value*, it can be an `href` **and** a `navigate()` — so a typed link is just `[routerLink]` bound to the composer, never a literal and never a click handler that drops the `href`.

A typed link surface — returns commands, does **not** navigate:

```ts
@Injectable({ providedIn: 'root' })
export class OrdersLinks {
  list   = () => ORDERS_ROUTES.list.commands();
  create = () => ORDERS_ROUTES.create.commands();
  detail = (o: Order) => ORDERS_ROUTES.detail.commands(o.id);
  edit   = (o: Order) => ORDERS_ROUTES.edit.commands(o.id);
}
```

```html
<!-- real <a href>: copy-link, ctrl/cmd/middle-click → new tab, hover, SEO, a11y — AND typed/centralized -->
<a [routerLink]="ordersLinks.detail(order)">{{ order.name }}</a>
```

`RouterLink` sets a genuine `href` from the commands and intercepts only a **plain left-click**; modifier and middle clicks open the real href in a new tab. That is the entire answer to "going typed cost me my href" — feed `RouterLink` from the composer instead of replacing it.

**The elevated form — a link directive that *augments* `RouterLink`, never reimplements it.** `[bsNavLink]` (in `navigation-core`) composes `RouterLink` via `hostDirectives`, so it inherits the real `href` and **every** RouterLink feature — `queryParams`, `fragment`, `target`, relative routes, `state`, `replaceUrl`, modifier/middle-click "open in new tab", and `RouterLinkActive`. It adds only what RouterLink lacks: it binds the composer's *value*, and emits a typed `navigated` event on each activation (a seam for analytics / breadcrumbs / telemetry). **Veto concerns — unsaved-changes, auth — belong in Router guards** (`canDeactivate` / `canActivate`), which fire for *every* navigation source (link, back button, programmatic), not just a click:

```ts
@Directive({
  selector: 'a[bsNavLink], area[bsNavLink]',
  hostDirectives: [RouterLink],                       // inherit href + every RouterLink feature
})
export class BsNavLinkDirective {
  private readonly link = inject(RouterLink);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLAnchorElement>>(ElementRef);

  readonly bsNavLink = input.required<string | readonly unknown[]>();   // the composer value
  readonly navigated = output<string | readonly unknown[]>();           // analytics/telemetry seam

  constructor() {
    effect(() => {
      const value = this.bsNavLink();
      this.link.routerLink = value as string | unknown[];               // RouterLink owns the navigation
      this.host.nativeElement.setAttribute('href', this.router.serializeUrl(this.tree(value)));
    });
  }

  @HostListener('click', ['$event'])
  onClick(e: MouseEvent) {
    if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) this.navigated.emit(this.bsNavLink());
  }

  private tree(value: string | readonly unknown[]) {
    return typeof value === 'string'
      ? this.router.parseUrl(value.startsWith('/') ? value : '/' + value)
      : this.router.createUrlTree(value as unknown[]);
  }
}
```

```html
<a [bsNavLink]="links.toDetail(order)" (navigated)="track($event)">{{ order.name }}</a>
```

**Why compose, not reimplement:** a directive that sets the `href` and handles the click *itself* (`serializeUrl` + `navigateByUrl`) just re-creates a subset of `RouterLink` and loses its richer inputs and `RouterLinkActive` — strictly worse than `[routerLink]`. `hostDirectives: [RouterLink]` keeps all of it and adds only the typed-composer binding + the `navigated` seam. The directive lives in `navigation-core` (one directive for the whole app), and the link *value* comes from `useNavigationLinks(routes)` — the composer twin of `useNavigationX` — not from a per-domain `Links` class.

---

## 3. Route-state selectors — the read side, off the URL

Query params and the fragment are easy to read globally from the Router (they're the resumable view-state). Re-derive on every navigation so the URL stays the single source of truth:

```ts
// orders-route.selectors.ts
@Injectable({ providedIn: 'root' })
export class OrdersRouteState {
  private readonly router = inject(Router);

  private readonly tree = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.parseUrl(this.router.url)),
    ),
    { initialValue: this.router.parseUrl(this.router.url) },
  );

  readonly query    = computed(() => this.tree().queryParams as Record<string, string | undefined>);
  readonly fragment = computed(() => this.tree().fragment ?? null);

  // Example selectors — replace/extend per domain:
  readonly filter   = computed<OrderFilter>(() => ({ status: this.query()['status'] ?? 'all' }));
  readonly openDialog = computed(() => this.query()['dialog'] ?? null);
}
```

Components react to `ordersRouteState.filter()` etc. **Path params** (`:id`) are component-scoped, so read those via **component-input binding** — `provideRouter(routes, withComponentInputBinding())`, then `readonly id = input<string>()` on the page — rather than walking the URL tree. Either way the back button, a deep link, and a click all update the same signals.

---

## 4. Event bus — typed facts, DI-scoped

```ts
// orders.events.ts — events are FACTS/INTENTS, never destinations.
export type OrderEvent =
  | { type: 'listOpened' }
  | { type: 'createRequested' }
  | { type: 'orderSelected'; order: Order }
  | { type: 'editRequested'; order: Order }
  | { type: 'filterChanged'; filter: OrderFilter };

@Injectable({ providedIn: 'root' })   // or provide at a domain-route level to scope it
export class OrdersEvents {
  private readonly bus = new Subject<OrderEvent>();
  readonly events$ = this.bus.asObservable();
  emit(event: OrderEvent) { this.bus.next(event); }
}
```

A component dispatches `ordersEvents.emit({ type: 'orderSelected', order })` from a click — it does not know or care that this navigates. Provide the bus at the domain's route (an element-level provider) when you want one bus instance per domain activation rather than a global one (see `angular-architecture` → DI & providers).

---

## 5. Binding — pure event→command, wired once

Keep the mapping a **pure function** (testable with no Router), and a thin service that subscribes:

```ts
// orders-navigation.binding.ts

// PURE: event -> navigation. Multiple events fold into one navigation HERE.
export function orderEventToNavigation(nav: OrdersNavigation, e: OrderEvent): unknown {
  switch (e.type) {
    case 'listOpened':      return nav.toList();
    case 'filterChanged':   return nav.toList(e.filter);
    case 'createRequested': return nav.toCreate();
    case 'orderSelected':   return nav.toOrder(e.order);
    case 'editRequested':   return nav.toEdit(e.order);
  }
}

@Injectable({ providedIn: 'root' })
export class OrdersNavigationBinding {
  private readonly events = inject(OrdersEvents);
  private readonly nav = inject(OrdersNavigation);
  constructor() {
    this.events.events$
      .pipe(takeUntilDestroyed())
      .subscribe((e) => orderEventToNavigation(this.nav, e));
  }
}

// Eagerly instantiate the binding so it subscribes as soon as the domain loads.
export function provideOrdersNavigation(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => inject(OrdersNavigationBinding)),
  ]);
}
```

Add `provideOrdersNavigation()` to the domain's route `providers` (or the app config). The pure `orderEventToNavigation` is your unit-test target: assert `orderSelected → toOrder`, no Router, no Angular TestBed.

---

## 6. Middleware on the funnel

Because every navigation passes through `OrdersNavigation`, wrap its `go` step with an interceptor chain — confirm-on-unsaved (read a "dirty" signal, defer to `resumable-state`'s `canDeactivate`), auth + `returnUrl`, analytics. Model interceptors as `(command, next) => …` so they compose, rather than sprinkling guards across routes.

---

## 7. Cross-domain — emit, don't import

`OrdersNavigation` knows only Orders routes. To send the user from Orders into the Billing domain, emit a cross-domain event and let an **app-shell binding** translate it:

```ts
// app-level binding — the ONLY place that knows both domains.
inject(OrdersEvents).events$.subscribe((e) => {
  if (e.type === 'invoiceRequested') inject(BillingNavigation).toInvoice(e.order);
});
```

Orders never imports `BillingNavigation`. The app shell owns cross-domain wiring; domains stay black boxes.

---

## Testing & SSR

- **Pure binding** → plain unit tests (`expect(spyNav.toOrder).toHaveBeenCalledWith(order)`), no TestBed.
- **Navigation service** → mock `Router`, assert the command array + query params.
- **Selectors** → drive `router.events`/URL and assert the signal values.
- **SSR**: `Router` and `parseUrl` are SSR-safe; selectors derived from them are fine. (Storage-backed state still needs the SSR guard from `resumable-state`.)

## Pitfalls

- **Literal command arrays in the service** (`navigate(['/orders', id])`) instead of `ORDERS_ROUTES.detail.commands(id)` — reintroduces the drift the registry exists to prevent.
- **Selectors that cache a snapshot** instead of re-deriving on `NavigationEnd` — they go stale on back/forward.
- **Events that carry a destination** (`{ type: 'goToOrder' }`) — the emitter deciding the route; keep events factual.
- **An impure binding** that calls the Router directly — untestable; keep `event → command` pure and let the service touch the Router.
- **A domain importing another domain's navigation service** — route cross-domain through the app shell.
- **Forgetting to instantiate the binding** (a lazy `providedIn: 'root'` service no one references never subscribes) — wire it via `provideEnvironmentInitializer`.
- **`queryParamsHandling` omitted** on commands that set a query param — silently drops sibling params (same trap as `resumable-state`).
