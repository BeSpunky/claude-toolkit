/**
 * The design system's runtime, framework-neutral: switching the MODE (light / dark / follow-the-OS).
 *
 * A mode is a RE-BINDING of tokens: the SASS layer emits `[data-{{tokenPrefix}}-mode='…']` blocks, and this is the
 * ONE place that writes that attribute. No rebuild, no second stylesheet, no component knows it happened.
 *
 * Plain DOM on purpose — any framework (or none) calls it. A framework binding may wrap it in its own idiom
 * (a service, a hook, a store); it must not re-implement it, or the two will drift.
 *
 * PERSISTENCE AND FIRST PAINT ARE NOT HERE: anything run from a bundle runs after the first paint. The default
 * (`'system'`) needs no script — the CSS resolves `prefers-color-scheme` itself. To persist an explicit choice,
 * apply it with a tiny inline `<script>` in the page's <head>, then call `setMode` with the same value.
 */
export type DsMode = 'light' | 'dark' | 'system';

/** The attribute the SASS layer's mode blocks bind to. */
export const MODE_ATTRIBUTE = 'data-{{tokenPrefix}}-mode';

/**
 * Set the mode on `root` (default: the document element). `'system'` REMOVES the attribute — it is the absence of
 * a choice, which is what lets the `:root:not([data-{{tokenPrefix}}-mode])` block (the OS preference) take over.
 */
export function setMode(mode: DsMode, root: Element = document.documentElement): void {
  if (mode === 'system') root.removeAttribute(MODE_ATTRIBUTE);
  else root.setAttribute(MODE_ATTRIBUTE, mode);
}

/** The mode currently set on `root`. */
export function getMode(root: Element = document.documentElement): DsMode {
  const value = root.getAttribute(MODE_ATTRIBUTE);
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** What the user actually SEES: `'system'` resolved against the OS preference. */
export function resolvedMode(root: Element = document.documentElement): 'light' | 'dark' {
  const mode = getMode(root);
  if (mode !== 'system') return mode;
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
