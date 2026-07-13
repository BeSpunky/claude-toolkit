---
name: resumable-state
description: Make every screen resumable — a URL (route + optional query params and/or fragment) should fully reconstruct WHERE the user is (the module/page, the opened entity, an open dialog/sheet, edit vs create mode, the active tab, applied filters/search/sort, pagination, the scrolled-to section), and every piece of WORKING state (draft text, a chosen image, selected dates/toggles, wizard progress, an unsaved form) should be deliberately persisted and restored from a chosen home — so a refresh, a shared/bookmarked link, the back button, or a returning visit never loses the user's place or their work. Use whenever you add or change navigation, a dialog/modal/sheet, an edit or create flow, tabs, filters/search/sort, a multi-step form or wizard, a draft, or any selection/toggle — and the moment you catch yourself holding view or working state ONLY in a component field (a `selected`, `isOpen`, `mode`, `draft` that vanishes on reload). The core move — every piece of state has a deliberate HOME, chosen by its properties (shareable/bookmarkable? must survive a refresh? survive logout/closing the tab? needed across devices? sensitive or large?): navigational/view state → the URL as the single source of truth; working/data state → an explicitly chosen store (sessionStorage, localStorage, IndexedDB, or the server/DB); only genuinely ephemeral state stays in the component. It is NOT "remember to add deep links / autosave later" — you design the state's home UP FRONT, because retrofitting resumability means re-plumbing how the screen reads its state. This skill carries the agnostic principle + the decision framework; the Angular realization (Router query/matrix params + fragment as state, route-driven inputs, resolvers, guards, two-way signal↔URL and signal↔storage sync, dialog/edit/create-as-route, SSR-safe storage) is in `reference/angular-techniques.md`.
---

# Resumable by design

**The bar: any view the user can reach, they can return to from a URL alone — and any work they've started survives a refresh.** A screen that only exists because of a sequence of clicks (open this, toggle that, type here) and evaporates on reload is a screen the user can't share, can't bookmark, can't recover after a crash, and can't reach with the back button. That is a defect, not a missing nice-to-have.

Run two tests on every screen you build:

1. **The link test** — if I copy the URL right now and paste it into a fresh tab, do I land exactly here: same module, same opened item, same dialog open, same edit/create mode, same tab, same filters? If not, **navigational state is leaking into memory** that the URL should own.
2. **The refresh test** — if I'm halfway through typing/selecting and I hit reload, is my work still here? If not, **working state has no home** and you're trusting it to a component field that reload destroys.

If either test fails, the screen isn't finished — however correct its logic is.

---

## Every piece of state has a home — decide it on purpose

This is the whole skill: **for each piece of state, choose where it lives deliberately, by its properties — never leave it in a component field by default.** Ask five questions; the answers point to the home.

| Ask… | If yes → leans toward |
| --- | --- |
| Should a **shared/bookmarked link** reproduce it? Should **back/forward** move through it? | **the URL** |
| Must it **survive a refresh**, but only for **this session/tab**? | **sessionStorage** |
| Must it **survive closing the tab / returning later** on the same device? | **localStorage** (small) / **IndexedDB** (large or structured) |
| Is it needed **across devices**, is it **authoritative**, or is it **sensitive/large**? | **the server / database** |
| Is it **derivable**, **truly throwaway** (hover, a transient animation), and worthless after this tick? | **the component (in-memory)** — the only thing that legitimately lives there |

Two homes do most of the work, and they map to the two halves below.

### Half 1 — Navigational / view state → the URL is the source of truth

Anything that answers *"what am I looking at and in what mode?"* belongs in the URL, where the **URL is the source of truth and the UI is derived from it** — not the other way around.

- **Route**: the module/page and the opened entity (`/orders/8421`), edit vs create as distinct routes or segments (`/orders/8421/edit`, `/orders/new`).
- **Query params**: applied filters, search text, sort, page number, active tab, an open dialog and which one (`?tab=activity&status=open&dialog=invite`), view toggles (grid/list).
- **Fragment**: the scrolled-to section / anchor / step.

What this buys you, for free, the moment the URL owns it: **shareable & bookmarkable, refresh-safe, correct back/forward, deep-linkable** (notifications/emails can point straight at a record or an open dialog), and **testable** (a URL is a fixture).

The discipline: the component **reads** its view state *from* the URL and **writes changes back** *to* the URL (replace the history entry for incidental changes like typing a filter; push a new entry for meaningful navigation like opening a record). It never holds a second private copy that can drift. A dialog is "open" because the URL says so — closing it is a navigation, so the back button closes it too, which is exactly what users expect.

### Half 2 — Working / data state → a deliberately chosen store (or the DB)

Anything that is the user's *in-progress work* — draft text, a chosen/uploaded image, selected dates, toggles not yet applied, wizard answers, an unsaved form — must be **persisted and restored**, and **which store is an architectural decision**, made from the questions above, not a reflex:

- **sessionStorage** — survives refresh, dies with the tab. Right for a draft that only makes sense in this sitting (a half-typed comment, scroll position, an unsubmitted form you don't want to outlive the session).
- **localStorage** — survives closing the tab/browser, same device, small string values. Right for longer drafts, last-used selections, preferences, "continue where you left off".
- **IndexedDB** — same lifetime as localStorage but for **large or structured** data (a chosen image blob, a big document draft, many rows).
- **server / database** — when the state must be **authoritative, available on another device, or is sensitive**. Autosave the draft to the server (debounced, optimistic), keep a local cache for instant restore and offline.

For each persisted piece, design the four moving parts deliberately: a **stable key** (namespaced, collision-free, scoped to the user/entity where needed), **serialization** (what shape goes in, how it parses back, versioned if it may change), **restore-on-load** (read it when the screen initializes — this is the half people forget), and **clear-on-commit** (delete the draft once it's saved, so a stale draft doesn't resurrect over fresh server data).

### The residue — what legitimately stays in memory

Only state that is **derivable** (compute it; don't store it) or **truly ephemeral** (a hover flag, an in-flight animation value, a one-tick latch) stays in a component field. If you can't justify it as one of those, it has the wrong home.

---

## Design the home up front — not as a later pass

Resumability is **cheap when designed in and expensive when retrofitted**, because the home of a piece of state determines *how the screen reads it*. A filter read from a signal is wired differently than a filter read from the URL; a draft kept in a field is wired differently than one hydrated from storage on init. Decide each piece's home **when you build the screen**, so reading-from-its-home is the original code path, not a rewrite.

Two anti-patterns this prevents:

- **The mirror trap** — keeping the URL/storage *and* an in-memory copy "in sync." Two sources of truth drift and cause double-write loops. Pick one source (the URL for view state, the store for working state) and derive the UI from it.
- **The write-only persistence trap** — saving state but never *restoring* it on load (or saving on every keystroke but reading only once, stale). Persistence without a restore path is theatre; it passes code review and fails the refresh test.

Concentrate this so you don't hand-wire it per field: **model the seam once** — a small "this value lives in the URL" / "this value lives in storage" primitive (a signal that initializes from its home and writes back on change) — and reuse it. Doing it by hand on every field is how half the fields end up resumable and half don't. (The Angular form of that primitive is in the reference.)

---

## Ask yourself

- For this screen: does a **copied URL reproduce it exactly** — module, opened item, open dialog, edit/create mode, tab, filters, sort, page? If not, what view state is leaking into memory?
- Does the **back button** do the expected thing — close the dialog, undo the filter, leave edit mode — because those are URL states?
- If the user **refreshes mid-task**, is their draft / selection / wizard progress still there? Where exactly does it live, and *when is it restored*?
- For each persisted piece, did I **deliberately choose the store** from its properties (shareable? survive refresh? survive close? cross-device? sensitive/large?) — or default to whatever was handy?
- Did I design the **key, serialization, restore-on-load, and clear-on-commit** — or only the save half?
- Is there **one source of truth** per piece (URL *or* store, UI derived) — or a private in-memory mirror that can drift?
- Is anything sitting in a **component field** that should outlive the component? Can I justify each field as *derivable* or *truly ephemeral*?
- Am I putting **sensitive data** somewhere a link or `localStorage` shouldn't hold it (tokens, PII in the URL)?

## Red flags

- **A dialog/modal/edit-mode/tab that the URL doesn't reflect** — open it, refresh, it's gone; share the link, the recipient lands somewhere else.
- **Filters / search / sort / pagination held only in component signals** — refresh resets them; the result list can't be linked to.
- **A draft, chosen image, or multi-step form that a reload wipes** — no persistence, or persistence with no restore-on-load.
- **`localStorage`/`sessionStorage` chosen by reflex** without asking whether the state should survive the tab, the device, or belongs on the server.
- **State mirrored** in both the URL/storage and an in-memory copy kept "in sync" — two sources of truth.
- **Saving on change but never restoring**, or restoring once and going stale — write-only persistence.
- **A stale draft overwriting fresh server data** because it was never cleared on successful save.
- **Sensitive or large data in the URL or `localStorage`** (tokens, PII, blobs) — wrong home for the property.
- **"We'll add deep links / autosave later"** — deferring the state's home until it's a re-plumbing job.

---

> **Related.** Its partner skill is **`engineering:typed-reactive-navigation`** — this skill establishes that *the URL is the single source of truth for navigational state*; that one is *how you command and observe that state*: typed per-domain navigation services write it (taking entities, never routes), typed selectors read it, and an event bus + pure binding decouple interaction from destination. Reach for it whenever you'd otherwise call `router.navigate` from a component. This is `engineering:architecture-first` applied to state — *where a piece of state lives* is a structural decision, so model its home up front rather than patching resumability on later. The state-classification and source-of-truth thinking draws on `engineering:software-design` (domain modeling, single source of truth, contracts). The payoff is a use-quality: `product-ux:astonishing-to-use` (resumability removes the friction of losing your place or your work, and makes links shareable) and `product-ux:keep-users-oriented` (a user who can always get back, and never loses work, stays oriented). For the concrete Angular realization — Router query/matrix params and fragment as the state source of truth, route-driven inputs, resolvers, `canDeactivate` guards, two-way `signal↔URL` and `signal↔storage` sync, dialog/edit/create-as-route, and SSR-safe storage access — read **`reference/angular-techniques.md`**.
