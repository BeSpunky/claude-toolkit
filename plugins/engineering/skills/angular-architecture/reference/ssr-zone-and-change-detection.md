# SSR, Zone & Change Detection (Angular)

Run safely on the server, and control *when* Angular reacts — so the app is correct under SSR and efficient under heavy or imperative workloads (`architect-mentality` → *Compensate for your materials' weaknesses*). Modern Angular: `afterNextRender`, `PendingTasks`, OnPush + signals, zoneless.

---

## 1. Platform-safe execution

**What.** Code that touches the DOM or browser globals must not run on the server. Guard it, or schedule it for the browser only.

**Why.** *Compensate for weaknesses* — SSR is a known sharp edge; shield every consumer from it by construction, not by hoping.

```ts
// runs only in the browser, after the DOM exists — never executes on the server:
afterNextRender(() => { this.chart = createChart(this.host.nativeElement); });

// branch when you must:
if (isPlatformBrowser(inject(PLATFORM_ID))) { /* browser-only */ }
```

For globals, inject them behind tokens instead of referencing `window`/`document` directly — see the **DI & providers** reference (technique 4).

**Pitfalls.** Constructor and `ngOnInit` run on the server too; only `afterNextRender`/`afterRender` are browser-only. Don't put DOM work in `ngOnInit`.

---

## 2. Keep SSR waiting for async work

**What.** SSR serializes the page once the app is "stable." If you start async work the server should wait for, register it as a pending task; to avoid re-fetching in the browser, hand the result over via `TransferState`.

**Why.** *Compensate for weaknesses* — otherwise crawlers and users get an unhydrated shell.

```ts
const pendingTasks = inject(PendingTasks);   // @angular/core (public in recent Angular)
const done = pendingTasks.add();             // app stays "unstable" until released
loadThing().finally(done);
```

**Pitfalls.** Work that never completes (a long-lived interval/stream) will hang SSR — only mark genuinely finite work. Prefer Angular's data mechanisms (route resolvers, `HttpClient` + `TransferState`) where they fit, rather than hand-rolling.

---

## 3. Control when Angular reacts

**What.** Decide reactivity by *category*: high-frequency or native-internal changes should not trigger change detection; user-facing state the view shows should.

**Why.** *Compensate for weaknesses* — high-frequency imperative callbacks (drag, pointer-move, render ticks) are a classic CD footgun; handle it at one choke point, not per call site.

- **OnPush + signals** (modern default posture): the view updates when a *signal it reads* changes — nothing else.
- **Zone apps, hot paths:** wrap native work in `ngZone.runOutsideAngular(() => …)`; re-enter with `ngZone.run(() => …)` only for the events that must update the view.
- **Zoneless** (the direction of travel): there is no automatic CD — reflect native state into the view through signals, updating only what you render.

**Pitfalls.** Under zoneless/OnPush, mutating a plain field won't update the view — use a signal. Re-entering the zone for every native tick defeats the optimization.

---

## 4. Gate rendering on readiness

**What.** When a subtree needs an async dependency (a loaded SDK, a ready native object), gate it so descendants can assume readiness — solving the wait once (see also `angular-native-wrappers`, piece 6).

**Why.** *Concentrate complexity* — no threading promises/observables through the whole tree.

```ts
@if (mapReady()) { <app-map/> }            // a signal flips true when the SDK resolves
// or: @defer (when mapReady()) { <app-map/> }
```

**Pitfalls.** Gating hides everything below until ready — show a placeholder/skeleton so the user isn't staring at nothing (*Design for the consumer*).

---

**Mentality anchors for this cluster:** *Compensate for your materials' weaknesses*, *Concentrate complexity*, *Place everything on purpose*, *Design for the consumer* — all in the `architect-mentality` skill.
