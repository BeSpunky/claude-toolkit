/**
 * The design system's DEFAULT MODE, as the runtime sees it — shared by `DsTheme` (what the user sees) and
 * `DsRuntimeTheme` (where an unpinned visitor's overrides go). Never restated here: it is read back from the
 * stylesheet `ds.theme()` emitted.
 */
/** The custom property `ds.theme()` emits `$default-mode` as (styles/_core/_tokens.scss). */
const DEFAULT_MODE_PROPERTY = '--{{tokenPrefix}}-default-mode';

/**
 * The design system's `$default-mode`, read from the stylesheet that `ds.theme()` emitted it into — so the design
 * decision has ONE home (the tokens) and the runtime never restates it. `null` while the default follows the OS
 * (`'system'`), and wherever there is no stylesheet to read (SSR, a test without the global styles).
 */
export function fixedDefaultMode(root: Element): 'light' | 'dark' | null {
  const view = root.ownerDocument?.defaultView;
  if (typeof view?.getComputedStyle !== 'function') return null;
  const value = view.getComputedStyle(root).getPropertyValue(DEFAULT_MODE_PROPERTY).trim();
  return value === 'light' || value === 'dark' ? value : null;
}
