import { DOCUMENT, Injectable, computed, inject, signal } from '@angular/core';

/** Token overrides: token name WITHOUT the `--{{tokenPrefix}}-` prefix (`'color-primary'`), mapped to a CSS value. */
export type DsTokenOverrides = Record<string, string>;

const LINK_ELEMENT_ID = '{{tokenPrefix}}-theme';
const STYLE_ELEMENT_ID = '{{tokenPrefix}}-theme-inline';
const PREFIX = '--{{tokenPrefix}}-';

/**
 * Runtime theming — swapping the app's theme after it has loaded.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * READ THIS FIRST: a theme should be a CSS FILE, not JavaScript.
 *
 * The right way to ship a brand / tenant / user-selectable theme is to AUTHOR it in the design system
 * (`ds.theme-overrides(...)` in `packages/design-system/themes/<name>.theme.scss`), let it compile to a
 * standalone `.css`, and LINK it:
 *
 *     <link id="{{tokenPrefix}}-theme" rel="stylesheet" href="theme-acme.css">   <!-- in index.html, before first paint -->
 *
 * That is better than JavaScript on every axis that matters:
 *   - NO FLASH. A <link> in <head> applies before the first paint. Anything JS does happens after the
 *     bundle boots, so the user watches the default theme paint and then snap to the brand.
 *   - The browser caches, revalidates and CDN-serves it for free.
 *   - The theme keeps the design system's COMPILE-TIME guarantees: an unknown token name is a build
 *     error, not a value that silently does nothing.
 *
 * So `use()` below just points that <link> at a different pre-built file. It is a one-liner because the
 * hard work already happened at build time — which is the point.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `setTokens()` is the EXCEPTION, for the one case a file cannot cover: values that do not exist until
 * runtime — a colour dragged out of a picker, a tenant palette stored as a hex in a database. You cannot
 * pre-build a stylesheet for a colour nobody has chosen yet. Reach for it only then.
 */
@Injectable({ providedIn: 'root' })
export class DsRuntimeTheme {
  private readonly document = inject(DOCUMENT);

  private readonly href = signal<string | null>(null);

  /** The pre-built theme stylesheet currently linked, or `null` for the built-in theme. */
  readonly active = computed<string | null>(() => this.href());

  /**
   * Point the theme <link> at a pre-built theme stylesheet. **This is the normal path.**
   *
   * The element is expected to exist in `index.html` (so the initial theme is applied before first paint);
   * if it doesn't, we create it, and you accept a flash on the first switch.
   */
  use(href: string): void {
    if (!this.canTheme()) return;
    this.linkElement().href = href;
    this.href.set(href);
  }

  /** Drop the linked theme; the app falls back to the design system's built-in one. */
  useNone(): void {
    if (!this.canTheme()) return;
    this.document.getElementById(LINK_ELEMENT_ID)?.remove();
    this.href.set(null);
  }

  /**
   * Override tokens with values computed at RUNTIME — a colour picker, a per-tenant hex from an API.
   * The exception, not the default: if the values are known at build time, ship a theme FILE instead
   * (see the class doc) and get no-flash, caching, and a compile-time typo check for free.
   *
   * Emits ONE <style> element mirroring the theme's structure — deliberately not inline styles on <html>,
   * which cannot be conditional on `[data-{{tokenPrefix}}-mode]` and so would override BOTH modes with one value,
   * freezing the theme the moment the user switches mode. Per-mode overrides also get their
   * `prefers-color-scheme` block, without which they'd silently do nothing for every user on 'system' —
   * the default, i.e. most of them.
   *
   * NOTE the trade-off you are accepting: there is no compiler here. An unknown token name resolves to
   * nothing and fails silently. Keep this path small, and prefer a theme file whenever you can.
   */
  setTokens(overrides: { base?: DsTokenOverrides; light?: DsTokenOverrides; dark?: DsTokenOverrides }): void {
    if (!this.canTheme()) return;

    const declare = (tokens: DsTokenOverrides): string =>
      Object.entries(tokens)
        .map(([key, value]) => `${PREFIX}${key}: ${value};`)
        .join(' ');

    const rules: string[] = [];
    if (overrides.base) rules.push(`:root { ${declare(overrides.base)} }`);

    for (const mode of ['light', 'dark'] as const) {
      const tokens = overrides[mode];
      if (!tokens) continue;
      const body = declare(tokens);
      rules.push(`[data-{{tokenPrefix}}-mode='${mode}'] { ${body} }`);
      rules.push(`@media (prefers-color-scheme: ${mode}) { :root:not([data-{{tokenPrefix}}-mode]) { ${body} } }`);
    }

    this.styleElement().textContent = rules.join('\n');
  }

  /** Remove any runtime-computed token overrides (does not touch the linked theme file). */
  clearTokens(): void {
    if (!this.canTheme()) return;
    this.document.getElementById(STYLE_ELEMENT_ID)?.remove();
  }

  /** The theme <link>, ideally already in index.html; created (and appended last) if absent. */
  private linkElement(): HTMLLinkElement {
    const existing = this.document.getElementById(LINK_ELEMENT_ID);
    if (existing) return existing as HTMLLinkElement;

    const element = this.document.createElement('link');
    element.id = LINK_ELEMENT_ID;
    element.rel = 'stylesheet';
    this.document.head.appendChild(element);
    return element;
  }

  /** The one <style> element for runtime-computed overrides. Appended last, so it wins on source order. */
  private styleElement(): HTMLStyleElement {
    const existing = this.document.getElementById(STYLE_ELEMENT_ID);
    if (existing) return existing as HTMLStyleElement;

    const element = this.document.createElement('style');
    element.id = STYLE_ELEMENT_ID;
    this.document.head.appendChild(element);
    return element;
  }

  /** SSR has no live document. Render the <link> into the served HTML instead. */
  private canTheme(): boolean {
    return !!this.document.defaultView;
  }
}
