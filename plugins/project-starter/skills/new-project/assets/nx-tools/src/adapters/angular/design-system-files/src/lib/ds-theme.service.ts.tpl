import { DOCUMENT, DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';

/**
 * The modes the design system ships. `'system'` means "follow the OS" — it is the ABSENCE of a choice,
 * not a third palette, which is why it maps to REMOVING the attribute rather than setting one.
 *
 * A new MODE (a light/dark-family palette) is added by declaring another map in
 * `styles/_core/_tokens.scss` `$modes` and widening this union — never by branching inside a component.
 * A BRAND is a separate axis on its own attribute (`data-{{tokenPrefix}}-brand`), not another `$modes` entry.
 */
export type DsMode = 'light' | 'dark' | 'system';

/** The attribute the SASS layer's `[data-{{tokenPrefix}}-mode='…']` blocks bind to. Written on <html>. */
const MODE_ATTRIBUTE = 'data-{{tokenPrefix}}-mode';

/**
 * The TS half of the theming mechanism — the ONE thing that writes the mode attribute.
 *
 * The SASS layer (`styles/_core/_theme.scss`) emits a `[data-{{tokenPrefix}}-mode='<mode>']` block per mode; something
 * has to put that attribute on the document, and if the design system doesn't own it, every app
 * hand-rolls its own copy and the two drift. So it lives here, once.
 *
 * Switching modes re-binds custom properties through the cascade — no rebuild, no second stylesheet, no
 * component knows it happened.
 *
 * PERSISTENCE AND FIRST-PAINT ARE DELIBERATELY NOT HERE — and cannot be, from a service. This runs after
 * the JS bundle executes, which is after the browser has already painted the initial HTML. So:
 *   - By DEFAULT (mode `'system'`, no persistence) there is no flash: the CSS itself resolves the OS
 *     preference via `@media (prefers-color-scheme)`, before any JS, with no attribute needed.
 *   - If you PERSIST an explicit choice (localStorage, the user's server profile — a product decision
 *     with real trade-offs; see `bespunky-engineering:resumable-state`), you must apply it BEFORE first
 *     paint with a tiny inline `<script>` in index.html's <head>, then hydrate `mode` from the same key
 *     here. Setting `mode` from a service alone will flash, because the paint already happened. See
 *     HOUSE.md → *The design system* for the inline-script snippet.
 */
@Injectable({ providedIn: 'root' })
export class DsTheme {
  private readonly document = inject(DOCUMENT);

  /** The user's choice. `'system'` (the default) defers to `prefers-color-scheme`. */
  readonly mode = signal<DsMode>('system');

  /** The OS preference, as a signal. Stays `false` during SSR, where there is no `matchMedia`. */
  private readonly prefersDark = signal(false);

  /**
   * What the user actually SEES right now — `'system'` resolved against the OS preference.
   * NOTE: during SSR `prefersDark` is always `false`, so this returns `'light'` on the server for a
   * `'system'` user regardless of their real OS. If you branch a TEMPLATE on `resolved()`, an OS-dark
   * user gets a hydration flip — prefer styling on the tokens/`prefers-color-scheme` over reading this in
   * a template.
   */
  readonly resolved = computed<'light' | 'dark'>(() => {
    const mode = this.mode();
    if (mode !== 'system') return mode;
    return this.prefersDark() ? 'dark' : 'light';
  });

  constructor() {
    const view = this.document.defaultView;

    // SSR-safe: `defaultView`/`matchMedia` are absent on the server, so we simply never subscribe there.
    if (view?.matchMedia) {
      const query = view.matchMedia('(prefers-color-scheme: dark)');
      this.prefersDark.set(query.matches);
      const onChange = (event: MediaQueryListEvent): void => this.prefersDark.set(event.matches);
      query.addEventListener('change', onChange);
      // The MediaQueryList is owned by `window` and outlives this injector; without cleanup the listener
      // (→ this service, its effect) leaks on every torn-down injector (TestBed, a re-bootstrapped app,
      // an Angular-Elements teardown).
      inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
    }

    // The ONE bridge between the mode signal and the SASS layer's selectors.
    effect(() => {
      const root = this.document.documentElement;
      const mode = this.mode();

      // Removing the attribute is what lets the `:root:not([data-{{tokenPrefix}}-mode])` block — i.e. the OS
      // preference — take over again. Setting it to 'system' would match nothing and silently pin the default.
      if (mode === 'system') root.removeAttribute(MODE_ATTRIBUTE);
      else root.setAttribute(MODE_ATTRIBUTE, mode);
    });
  }
}
