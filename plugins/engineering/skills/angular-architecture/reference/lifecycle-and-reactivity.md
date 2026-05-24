# Lifecycle & Reactivity (Angular)

How units come to life, react to change, and tear down cleanly — with the boilerplate **concentrated, not copy-pasted** (`architect-mentality` → *Concentrate complexity*, *Work smart, not hard*). Modern Angular: signal inputs, `effect()`, `DestroyRef`, `takeUntilDestroyed`.

---

## 1. Teardown without boilerplate

**What.** Stop manually tracking subscriptions and calling `unsubscribe()` in `ngOnDestroy`. Tie every stream and imperative resource to the unit's lifetime in one move.

**Why.** *Work smart* + *Concentrate complexity*: teardown is a cross-cutting concern; solve it once at the framework seam, not per subscription.

```ts
@Component({ /* … */ })
export class ChartComponent {
  private readonly destroyRef = inject(DestroyRef);
  constructor() {
    this.data$.pipe(takeUntilDestroyed()).subscribe(/* … */);   // auto-unsubscribed
    const chart = createChart();
    this.destroyRef.onDestroy(() => chart.destroy());            // imperative cleanup, same lifetime
  }
}
```

**When not.** You rarely need a `Destroyable` base class anymore. Reach for a base only when several units share *more* lifecycle behavior than teardown (then it's a template-method base — technique 2).

**Pitfalls.** `takeUntilDestroyed()` with no argument must run in an injection context (field initializer / constructor); elsewhere pass `takeUntilDestroyed(this.destroyRef)`.

---

## 2. Template-method abstract directive

**What.** When a *family* of directives/components differs only in one decision, put all the plumbing in one `@Directive()` abstract base and let each member override a single method.

**Why.** *Concentrate complexity* + *Lead with one mental model*: the family is learned once; a new member is a few lines.

```ts
@Directive()    // parameterless @Directive() lets an abstract class seed components, directives, and services
export abstract class RenderOnPredicate {
  private readonly tpl = inject(TemplateRef);
  private readonly vcr = inject(ViewContainerRef);
  protected abstract shouldRender(): boolean;
  ngOnInit() { this.shouldRender() ? this.vcr.createEmbeddedView(this.tpl) : this.vcr.clear(); }
}

@Directive({ selector: '[browserOnly]' })
export class BrowserOnlyDirective extends RenderOnPredicate {
  private readonly platformId = inject(PLATFORM_ID);
  protected shouldRender() { return isPlatformBrowser(this.platformId); }
}
```

**Pitfalls.** Decorate the base with `@Directive()` (no selector) so Angular accepts it as a base; subclasses bring the selector.

---

## 3. Typed structural-directive microsyntax

**What.** When you build a custom structural directive with template context (`*myDir="… as x"`), make the `as`/`let` bindings strongly typed with a static `ngTemplateContextGuard`.

**Why.** *Design for the consumer* — the template author gets real types and autocomplete, not `any`.

```ts
interface RenderContext<T> { $implicit: T; data: T; }

@Directive({ selector: '[withData]' })
export class WithDataDirective<T> {
  static ngTemplateContextGuard<T>(dir: WithDataDirective<T>, ctx: unknown): ctx is RenderContext<T> { return true; }
  // …vcr.createEmbeddedView(tpl, { $implicit: value, data: value })
}
```

**Pitfalls.** The guard must be `static` and re-declared per directive — the template type-checker does not inherit it from a base class.

---

## 4. Reactive inputs the modern way

**What.** Use signal inputs; derive with `computed`; react with `effect`. This retires the old "use a `BehaviorSubject` so I don't miss the first `@Input` before `ngOnInit`" workaround — a signal input always has a current value.

**Why.** *Refuse false tradeoffs* + *Place everything on purpose*: state the view reflects is a signal; you don't hand-roll replay machinery for inputs.

```ts
export class MarkerComponent {
  readonly position = input.required<Coord>();
  readonly label = input<string>();
  private readonly latLng = computed(() => toLatLng(this.position()));   // derived, on purpose
  constructor() {
    effect(() => this.marker.setPosition(this.latLng()));               // react to input changes
  }
}
```

Bridges, when you genuinely need streams: `toObservable(signal)` / `toSignal(observable$)`.

**Pitfalls.** `effect()` runs in an injection context. If you find yourself *setting* a signal inside an `effect`, you probably wanted a `computed`.

---

## 5. Bind an external object's lifecycle to the component's

**What.** Create the external/native object when the unit initializes; destroy it when the unit is destroyed — so structural control flow (`@if`/`@for`) drives imperative create/destroy for free.

**Why.** *Everything is a black box* + *Work smart*: the Angular unit owns the native object's lifetime; adding/removing the element adds/removes the thing.

```ts
constructor() {
  const overlay = this.map.addOverlay();                  // born with the component
  inject(DestroyRef).onDestroy(() => overlay.remove());    // dies with it
}
```

Then `@for (m of markers(); track m.id) { <app-marker [data]="m"/> }` keeps the map's overlays in sync with the data automatically.

**Pitfalls.** Don't create the native object in a field initializer if it needs inputs that aren't set yet — create it where its dependencies exist, on purpose.

---

**Mentality anchors for this cluster:** *Concentrate complexity*, *Work smart, not hard*, *Refuse false tradeoffs*, *Design for the consumer*, *Lead with one mental model* — all in the `architect-mentality` skill.
