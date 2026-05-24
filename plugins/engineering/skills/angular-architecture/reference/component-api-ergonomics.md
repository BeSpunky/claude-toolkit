# Component API Ergonomics (Angular)

A component's inputs and outputs are its **public contract** — design them for the consumer and for change (`architect-mentality` → *Design for the consumer*, *Work smart, not hard*). Modern Angular: `input()`, `output()`, `model()`.

---

## 1. Entity-shaped inputs — pass the model, not scalars

**What.** Accept the whole domain object, not a handful of primitive inputs pulled from it.

**Why.** *Work smart* + minimize blast radius: when the model changes, you adapt the component once, not every call site.

```ts
// instead of [name] [lat] [lng] [open] [phone] …
readonly branch = input.required<Branch>();
```

Consumers write `<branch-map [branch]="branch"/>`; adding a field to `Branch` needs zero template churn.

**When not.** A truly generic, reusable primitive (a `<button>`-like) should take primitives — it has no domain model (*Place everything on purpose*).

---

## 2. Intent-named feature components

**What.** Wrap raw or third-party UI in a component named for its *use case*, even in a small app.

**Why.** *Concentrate complexity* + *Design for the consumer*: a cross-cutting change (a new behavior on every branch map) happens in one place, not scattered across templates.

```ts
// not <x-map> copy-pasted with config everywhere, but:
@Component({ selector: 'branch-map', /* … */ })
export class BranchMapComponent { readonly branch = input.required<Branch>(); }
```

---

## 3. Permissive inputs, normalized internally

**What.** Accept a union of the shapes a reasonable caller would naturally offer, and normalize once at the boundary.

**Why.** *Design for the consumer* + *Refuse false tradeoffs*: callers never pre-convert; you still operate on one canonical type internally.

```ts
export type CoordLike = LatLng | [number, number] | { lat: number; lng: number };

// read type is LatLng; accepted (write) type is CoordLike; normalized at the input boundary:
readonly center = input.required<LatLng, CoordLike>({ transform: toLatLng });
```

A shared interface (everything that can produce bounds implements `BoundsLike`) lets heterogeneous objects interoperate — pass a marker *or* a polygon straight into `fitBounds()`.

**Pitfalls.** Normalize at exactly one boundary (the input transform), never again at each use site.

---

## 4. Carry the domain object with a typed payload slot

**What.** Let consumers recover *their* entity in event handlers without lookups, by emitting it alongside the event.

**Why.** *Work smart* — no "which model does this clicked marker belong to?" array-scanning.

```ts
readonly markerClick = output<{ marker: Marker; data: T }>();
// handler: onClick(e) { this.select(e.data); }   // the entity is right there
```

(For a wrapper object the consumer holds onto, the equivalent is a free-form, typed `data`/`custom` slot it carries.)

---

## 5. Guessable, consistent naming

**What.** Name outputs for the event (`opened`, `boundsChanged`), inputs for the domain; keep the mapping mechanical across the whole library.

**Why.** *Lead with one mental model* + *Design for the consumer*: a consumer learns the convention once and then predicts every other component's API without the reference.

---

**Mentality anchors for this cluster:** *Design for the consumer*, *Work smart, not hard*, *Refuse false tradeoffs*, *Lead with one mental model*, *Place everything on purpose* — all in the `architect-mentality` skill.
