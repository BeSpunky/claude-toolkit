# DI & Providers (Angular)

Dependency injection is Angular's primary **seam** (`architect-mentality` → *Define the seam; let others plug in*). These techniques make DI do the heavy lifting: a unit declares what it needs, receives it from outside, and stays substitutable and testable.

All examples are modern Angular: `inject()`, `provideX()` functions, `InjectionToken` with a `factory`, and standalone APIs. Each technique names the mentality principle it serves so the *why* is never lost.

---

## 1. Provider factories (`provideX()`), not hand-written provider literals

**What.** When many providers share a shape, or a provider carries a cross-cutting concern (a platform guard, a fixed dependency wiring), write a function that returns the provider(s) — the `provideX()` convention — instead of repeating provider objects at every call site.

**Why.** *Work smart, not hard* + *Concentrate complexity*: the cross-cutting logic lives once; consumers stay declarative (`providers: [provideMapEngine({ … })]`).

```ts
export function provideMapEngine(config: MapEngineConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: MAP_ENGINE_CONFIG, useValue: config },
    {
      provide: MapEngine,
      useFactory: () => {
        if (!isPlatformBrowser(inject(PLATFORM_ID))) return null; // SSR guard, centralized once
        return new MapEngine(inject(MAP_ENGINE_CONFIG));
      },
    },
  ]);
}
```

**When.** Any reusable provider, especially library entry points. **When not.** A one-off local provider with no shared concern — write it inline (*Know when not to do it*).

**Pitfalls.** Use `makeEnvironmentProviders` for application/environment scope; a plain `Provider[]` for component scope. `inject()` only works inside the factory (an injection context).

---

## 2. Hierarchical (element-level) DI for parent–child relationships

**What.** A child component/directive injects its **parent** to attach itself — modeling containment as a typed DI relationship instead of `@Input` plumbing.

**Why.** *Everything is a black box*: the parent–child link is a deliberate, well-typed, one-directional connection. *Design for the consumer*: nesting `<x-marker>` inside `<x-map>` just works.

```ts
@Component({ selector: 'x-map', providers: [MapEngine] })   // one engine per <x-map> element
export class MapComponent { readonly engine = inject(MapEngine); }

@Directive({ selector: 'x-marker' })
export class MarkerDirective {
  private readonly map = inject(MapComponent);     // resolved up the element-injector tree
  private readonly marker = this.map.engine.addMarker();
}
```

Use `{ optional: true }` if the parent may be absent; `{ host: true }` / `{ skipSelf: true }` to scope resolution.

**Pitfalls.** Element-injector providers create a fresh instance per element (intended here). A circular parent↔child injection is a design smell (*black box* red flag).

---

## 3. Class-as-token for configuration

**What.** Declare config as a **class**, not just an interface, so the class itself is the injection token — no separate `InjectionToken` needed.

**Why.** Simplicity (*Concentrate complexity*): one symbol does double duty (type *and* token).

```ts
export class MapEngineConfig { key!: string; region?: string; }

// provider: { provide: MapEngineConfig, useValue: Object.assign(new MapEngineConfig(), userConfig) }
const cfg = inject(MapEngineConfig);   // typed, no token plumbing
```

**Note.** An `interface` cannot be a token (it's erased at runtime); a class can. If the config is purely structural and you'd rather not ship a class, use `new InjectionToken<Config>('…')` instead. Choose **on purpose** (*Place everything on purpose*).

---

## 4. Platform / global values behind a token + factory

**What.** Never reference `window`/globals directly. Provide them through a token whose `factory` is platform-aware; for `document`, inject Angular's `DOCUMENT`.

**Why.** *Compensate for your materials' weaknesses* — SSR safety by construction; still mockable, so *Abstractions must never trap*.

```ts
export const WINDOW = new InjectionToken<Window | null>('WINDOW', {
  providedIn: 'root',
  factory: () => (isPlatformBrowser(inject(PLATFORM_ID)) ? window : null),
});

// inject(WINDOW) → null on the server, no ReferenceError; trivially overridable in tests
```

**Pitfalls.** Don't re-provide Angular's own `DOCUMENT`; inject it (from `@angular/common`). Type the value to include the server case (`Window | null`) so callers handle it.

---

## 5. Optional config + graceful degradation

**What.** Inject cross-cutting config **optionally**; expose an `enabled` flag and an `ensureEnabled()` assertion that throws an *actionable* message.

**Why.** *Design for the consumer*: a library feature can lie dormant when unconfigured, and fail loudly (with the fix) only when truly required.

```ts
@Injectable({ providedIn: 'root' })
export class I18nIntegration {
  private readonly config = inject(I18N_CONFIG, { optional: true });

  get enabled() { return !!this.config; }

  private ensureEnabled(): asserts this is { config: I18nConfig } {
    if (!this.config) throw new Error('i18n not configured — call provideI18nIntegration() at bootstrap.');
  }
}
```

The `asserts this is { … }` guard narrows `config?` to non-null after the call — types follow the runtime check.

---

## 6. "Provide once" guard (the modern replacement for `forRoot` single-import checks)

**What.** With `provideX()` replacing `forRoot`, guard against double provision using a sentinel checked with `skipSelf`.

**Why.** *Compensate for weaknesses* — catches a real misconfiguration at startup with a clear message instead of mysterious double-state.

```ts
export function provideThing(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: THING_GUARD, useValue: true },
    {
      provide: ENVIRONMENT_INITIALIZER, multi: true,
      useValue: () => {
        if (inject(THING_GUARD, { optional: true, skipSelf: true }))
          throw new Error('provideThing() was already called higher up — call it exactly once.');
      },
    },
  ]);
}
```

---

## 7. Immutable element metadata via attribute injection

**What.** For an element attribute that never changes (an outlet/slot name, a static variant), inject it once rather than modeling it as a reactive `@Input`.

**Why.** *Place everything on purpose* — static metadata is injected statically; reactivity it doesn't need is not added.

```ts
// Angular 17+
private readonly slot = inject(new HostAttributeToken('slot'), { optional: true });
```

---

## 8. Strategy by config — "primitive shorthand OR full provider"

**What.** Accept a convenience primitive *or* a full provider in one config field, and dispatch to the right provider via a **`typeof`-keyed map (not a `switch`)**, always with a safe default.

**Why.** *Design for the consumer* + *Refuse false tradeoffs*: ergonomic for the 90% case, fully extensible for the rest — not either/or.

```ts
type LocalizeStrategy = number | string | Provider;   // index → path segment | string → query param | full provider

function provideLocalizer(strategy?: LocalizeStrategy): Provider {
  const make: Record<string, () => Provider> = {
    number:    () => ({ provide: Localizer, useClass: RoutePositionLocalizer }),
    string:    () => ({ provide: Localizer, useClass: QueryParamLocalizer }),
    object:    () => strategy as Provider,                          // caller's own provider
    undefined: () => ({ provide: Localizer, useClass: NoopLocalizer }), // safe default
  };
  return make[typeof strategy]();
}
```

(The "map object instead of `switch`" is itself a house convention — keep it consistent everywhere: `architect-mentality` → *Lead with one mental model*.)

---

**Mentality anchors for this cluster:** *Define the seam*, *Work smart, not hard*, *Concentrate complexity*, *Compensate for your materials' weaknesses*, *Design for the consumer* — all in the `architect-mentality` skill.
