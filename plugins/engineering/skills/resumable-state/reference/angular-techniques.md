# Resumable state — the Angular realization

The agnostic principle lives in the SKILL: every piece of state has a deliberate home; navigational/view state → the URL as source of truth; working/data state → an explicitly chosen store; only ephemeral state stays in the component. This file is the **how, in modern Angular** (standalone, signals, `inject()`, `input()`, `provideRouter`). Read it alongside the `angular-architecture` skill (its SSR cluster governs safe storage access; its lifecycle/reactivity cluster governs the signals/effects used here).

---

## 1. The URL is the source of truth — read it as inputs, write it through the Router

### Read: route + query as signal inputs

Enable component-input binding once, then route params, query params, and resolved data flow straight into `input()` signals — no manual `ActivatedRoute` plumbing:

```ts
// app.config.ts
provideRouter(routes, withComponentInputBinding())
```

```ts
// order-page.ts — /orders/:id and /orders/new both resolve here
@Component({ /* standalone */ })
export class OrderPage {
  // From the route path:  /orders/8421  →  id() === '8421'
  readonly id = input<string>();                 // absent for /orders/new
  // From the route's `data: { mode: 'create' }` or a path segment:
  readonly mode = input<'view' | 'edit' | 'create'>('view');
  // From query params:  ?tab=activity&status=open
  readonly tab = input<'details' | 'activity'>('details');
  readonly status = input<string>();
}
```

The component is now **derived from the URL**: paste `/orders/8421/edit?tab=activity` into a fresh tab and it reconstructs exactly. There is no private `selectedId`/`currentTab` field to drift.

For purely reactive reads without input binding, `toSignal` the param maps:

```ts
private readonly route = inject(ActivatedRoute);
readonly query = toSignal(this.route.queryParamMap, { requireSync: true });
readonly status = computed(() => this.query().get('status') ?? 'all');
```

### Write: navigate, don't assign

Changing view state is a navigation. **Merge** so you don't wipe sibling params; **replace** the history entry for incidental edits (typing a filter), **push** for meaningful moves (opening a record, switching a major tab):

```ts
private readonly router = inject(Router);
private readonly route = inject(ActivatedRoute);

setStatus(status: string | null) {
  this.router.navigate([], {
    relativeTo: this.route,
    queryParams: { status },                 // null removes the param
    queryParamsHandling: 'merge',            // keep tab, page, etc.
    replaceUrl: true,                        // incidental → don't spam history
  });
}
```

Forgetting `queryParamsHandling: 'merge'` is the classic bug: setting one param silently drops every other. Default the back button to do the right thing by making each meaningful state its own history entry.

---

## 2. A `urlParam` seam — model "this value lives in the URL" once

Don't hand-wire read+write on every field. A tiny writable-signal seam keeps the URL the source of truth while giving you an ergonomic `signal`:

```ts
export function urlParam(name: string, opts: { replace?: boolean } = {}) {
  const router = inject(Router);
  const route = inject(ActivatedRoute);
  const map = toSignal(route.queryParamMap, { requireSync: true });
  const value = computed(() => map().get(name) ?? null);

  return {
    value,                                   // read: always reflects the URL
    set: (next: string | null) =>
      router.navigate([], {
        relativeTo: route,
        queryParams: { [name]: next },
        queryParamsHandling: 'merge',
        replaceUrl: opts.replace ?? true,
      }),
  };
}

// usage
readonly statusParam = urlParam('status');
// template: [ngModel]="statusParam.value()" (statusModelChange)="statusParam.set($event)"
```

Because reads come *from* the URL and writes go *to* it, there is exactly one source of truth — no mirror to sync, no double-write loop. (If you debounce a free-text search param, debounce the `set`, not a second signal.)

---

## 3. Dialog / edit / create as URL state

A dialog, a sheet, edit mode, create mode — these are **states the URL should own**, so they're deep-linkable and the back button closes/exits them.

**Edit & create as routes** (distinct, deep-linkable):

```ts
{ path: 'orders/new',        component: OrderPage, data: { mode: 'create' } },
{ path: 'orders/:id',        component: OrderPage, data: { mode: 'view' } },
{ path: 'orders/:id/edit',   component: OrderPage, data: { mode: 'edit' } },
```

**Dialog as a query param**, opened/closed by an effect that follows the URL:

```ts
readonly dialog = urlParam('dialog');                 // ?dialog=invite
private readonly cdkDialog = inject(Dialog);
private ref?: DialogRef;

constructor() {
  effect(() => {
    const which = this.dialog.value();
    if (which === 'invite' && !this.ref) {
      this.ref = this.cdkDialog.open(InviteDialog);
      this.ref.closed.subscribe(() => this.dialog.set(null)); // closing = navigate
    } else if (which !== 'invite' && this.ref) {
      this.ref.close(); this.ref = undefined;
    }
  });
}
```

Now `/team?dialog=invite` opens the invite dialog on load; closing it removes the param; back/forward open and close it. (For a heavier "dialog as a real route," use a **named (auxiliary) outlet** instead of a query param — same principle, the URL owns "open.")

---

## 4. Restore deep links before render — resolvers and guards

- **Resolvers** fetch the entity a deep link needs *before* the component renders, so `/orders/8421` shows the order, not a flicker-then-load. Modern resolvers are plain functions: `resolve: { order: (route) => inject(OrdersApi).get(route.paramMap.get('id')!) }`.
- **`canDeactivate` guard** protects unsaved working state: warn (or autosave) when the user navigates away mid-edit — the working-state companion to URL-owned view state.
- **`canMatch`/`canActivate`** gate deep links that require auth, and redirect back to the intended URL after login (preserve `returnUrl` as a query param — itself resumable state).

---

## 5. Working state → storage, with a `storedSignal` seam (SSR-safe)

For drafts/selections that belong in `sessionStorage`/`localStorage`, model "this value lives in storage" once. **Guard storage access for SSR** — there is no `localStorage` on the server (see the `angular-architecture` SSR cluster):

```ts
export function storedSignal<T>(key: string, initial: T, store: 'local' | 'session' = 'local') {
  const platformId = inject(PLATFORM_ID);
  const browser = isPlatformBrowser(platformId);
  const backing = () => (store === 'local' ? localStorage : sessionStorage);

  const start = (() => {
    if (!browser) return initial;                    // SSR: no storage
    const raw = backing().getItem(key);
    return raw ? (JSON.parse(raw) as T) : initial;   // restore-on-load
  })();

  const sig = signal<T>(start);
  if (browser) {
    effect(() => {
      const v = sig();
      if (v === undefined || v === null) backing().removeItem(key);  // clear-on-commit
      else backing().setItem(key, JSON.stringify(v));                // persist-on-change
    });
  }
  return sig;
}

// usage — a comment draft that survives refresh but not the session:
readonly draft = storedSignal('order:8421:comment', '', 'session');
```

This bakes in all four moving parts the SKILL calls for: a **namespaced key**, **serialization** (`JSON`), **restore-on-load** (read at init), and **clear-on-commit** (`removeItem` when emptied after save). Set `draft.set('')` (or `null`) the moment the comment posts so a stale draft never resurrects over fresh data.

For **large/structured** working state (an uploaded image blob, a big document), swap the backing store for **IndexedDB** (e.g. `idb-keyval`) behind the same seam — strings to `localStorage`, blobs/objects to IndexedDB.

---

## 6. When the home is the server (cross-device / authoritative / sensitive)

If the draft must follow the user to another device, is the authoritative copy, or is sensitive, **autosave to the server** and keep a local cache only for instant restore:

- Debounced autosave: an `effect()` (or a `toObservable(...).pipe(debounceTime(...))`) PUTs the draft; reflect "Saving… / Saved" via `keep-users-oriented`.
- Optimistic local cache (IndexedDB/`localStorage`) so a refresh restores instantly while the server round-trips, then reconciles.
- Never put tokens or PII in the URL or `localStorage`; sensitive working state belongs on the server behind auth.

---

## Pitfalls

- **Double-write loop** — writing to the URL inside an `effect` that reads the URL, without `replaceUrl`/guarding, creates a navigate→react→navigate cycle. Keep one source of truth: read derives the UI, the *user action* writes.
- **Dropping sibling params** — omitting `queryParamsHandling: 'merge'` wipes every other query param. Always merge unless you mean to reset.
- **SSR storage crash** — touching `localStorage`/`window` on the server throws. Guard with `isPlatformBrowser` / `afterNextRender`.
- **Write-only persistence** — saving to storage but reading it only once (or never) on init. The restore path is the half that makes the refresh test pass.
- **Stale draft over fresh data** — not clearing the draft on successful commit, so the next visit restores an old draft over newer server state.
- **Storing derivable state** — persisting what you can compute (a filtered list, a total). Persist the inputs (the filter), derive the rest.
- **Key collisions / unbounded growth** — un-namespaced keys clobber each other across entities/users; never-cleared drafts fill storage. Namespace by entity/user; clear on commit; consider TTLs.
- **Sensitive/large data in the wrong home** — tokens or PII in the URL (logged, shared, in history) or blobs in `localStorage` (5 MB cap). Match the home to the property: server for sensitive, IndexedDB for large.
