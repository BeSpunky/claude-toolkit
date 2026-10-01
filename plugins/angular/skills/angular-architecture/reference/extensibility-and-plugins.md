# Extensibility & Runtime Plugins (Angular)

Let a host be extended by capabilities it **never imports** — tree-shakable, registered at the composition root, attached per host instance (`architect-mentality` → *Define the seam; let others plug in*, *Know when not to do it*). Built entirely from DI; no custom registry framework.

---

## 1. A capability registry via a multi-provider token

**What.** Define a token that collects capabilities as a `multi` provider. Each capability ships a `provideXCapability()` that adds itself. The host injects them all and attaches them.

**Why.** *Define the seam* — the host depends only on the *contract* (a capability shape), never on concrete capabilities; unused ones tree-shake away because their `provideX()` is never called.

```ts
export interface MapCapability { attach(map: MapEngine): void; }
export const MAP_CAPABILITY = new InjectionToken<readonly MapCapability[]>('MAP_CAPABILITY');

export function provideHeatmap(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: MAP_CAPABILITY, useClass: HeatmapCapability, multi: true },
  ]);
}

// host (e.g. the map component):
const capabilities = inject(MAP_CAPABILITY, { optional: true }) ?? [];
capabilities.forEach(c => c.attach(this.engine));
```

---

## 2. Per-instance attachment via the element injector

**What.** Provide the host's capability service at the **element** level so each host instance gets its own capability instances (state per map, per editor…).

**Why.** *Everything is a black box* — each instance is its own box with its own attached capabilities; no shared global state leaking between instances.

---

## 3. Late / lazy registration for already-created instances

**What.** If capabilities can be lazy-loaded *after* hosts exist, broadcast capability types through a replay stream (or a signal) so existing instances pick them up too — not only ones created afterward.

```ts
// root holds a ReplaySubject<Type<MapCapability>> — replays to hosts created earlier AND later
this.capabilities$
  .pipe(takeUntilDestroyed(this.destroyRef))
  .subscribe(type => this.attach(this.injector.get(type)));
```

**Why.** *Compensate for weaknesses* — lazy loading shouldn't mean "only future instances get the feature."

---

## 4. Typed lookup with a loud failure

**What.** Expose `use(CapabilityType)` returning the attached instance, throwing an actionable error if it wasn't registered.

**Why.** *Design for the consumer* — fail with "you didn't call `provideHeatmap()`", not a silent `undefined`.

```ts
use<T extends MapCapability>(type: Type<T>): T {
  const found = this.attached.get(type);
  if (!found) throw new Error(`Capability ${type.name} not registered — call its provideX() at bootstrap.`);
  return found as T;
}
```

---

## When NOT to build this

A fixed, known set of features is **not** a plugin system — compose them directly (*Know when not to do it*). Reach for this only when third parties, or lazy-loaded chunks, must extend a host that cannot know about them in advance. Building the machinery before that need exists is over-engineering.

---

**Mentality anchors for this cluster:** *Define the seam; let others plug in*, *Know when not to do it*, *Everything is a black box*, *Design for the consumer* — all in the `architect-mentality` skill.
