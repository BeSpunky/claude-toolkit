# Content Projection & DOM Bridging (Angular)

Let consumers supply Angular-managed content that ends up somewhere Angular doesn't normally control — a third-party overlay, a portal, a canvas-driven panel — **without losing live bindings** (`architect-mentality` → *Abstractions must never trap*, *Design for the consumer*). Modern Angular: `model()`, CDK Portals, signals.

---

## 1. Hand Angular-managed content to a non-Angular sink — keep it live

**What.** A consumer projects rich content and you must place it inside a foreign sink (a 3rd-party popup, a detached DOM region). Don't serialize it to an HTML string — that kills bindings. Render a view and move its **live** root nodes.

**Why.** *Refuse false tradeoffs* — you can have both the foreign sink *and* live Angular bindings; you don't have to give up reactivity to cross the boundary.

```ts
// render a projected template into a portal and attach it to a foreign host element:
const portal = new TemplatePortal(this.tpl(), inject(ViewContainerRef));
const outlet = new DomPortalOutlet(foreignHostEl /*, …per CDK version */);
outlet.attach(portal);                                  // real DOM — bindings & DI intact
inject(DestroyRef).onDestroy(() => outlet.dispose());
```

**Pitfalls.** Serializing `outerHTML` is the tempting shortcut and it is the *easy-but-complex* one (`architect-mentality` → *Go the extra mile*): it freezes the content and drops reactivity. Move nodes, don't stringify them.

---

## 2. Two-way binding without the hack

**What.** To expose a `[(value)]` two-way binding, use a `model()` signal — not the old getter + empty-setter trick.

**Why.** *Place everything on purpose* — `model()` is the dedicated tool; the getter/dummy-setter pattern was only ever a workaround for its absence.

```ts
export class OverlayDirective {
  readonly overlays = model<Overlay[]>([]);              // enables [(overlays)]
  add(o: Overlay) { this.overlays.update(list => [...list, o]); }
}
```

---

## 3. Defuse `ExpressionChangedAfterItHasBeenCheckedError` at the cause

**What.** This error means a bound value changed *after* change detection read it. The fix is structural — not a `setTimeout`.

**Why.** *Architecture-first / model the missing concept* — the error is a **symptom**; the cause is mis-timed state. Treat it as a design signal, not noise to silence.

- Set initial bound values **before** the first CD pass (constructor / field initializer).
- Prefer **signals / `computed`** for derived view state — they recompute coherently and largely eliminate the error.
- If a value genuinely must settle after render, that's `afterNextRender` territory — but first ask whether the data flow is modeled correctly.

**Pitfalls.** `setTimeout` or a stray `ChangeDetectorRef.detectChanges()` to "make it go away" is symptom-masking — exactly what the `architecture-first` skill forbids. Find *why* the value changes late.

---

**Mentality anchors for this cluster:** *Abstractions must never trap*, *Refuse false tradeoffs*, *Design for the consumer*, *Go the extra mile* — all in the `architect-mentality` skill; and *fix the root cause* in `architecture-first`.
