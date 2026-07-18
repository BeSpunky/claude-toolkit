// Dev-only worktree tab label.
//
// When several worktrees are served at once they share the noVNC viewer and open as look-alike tabs.
// This makes each one recognisable AT A GLANCE: on a `<slug>.localhost` worktree domain it prefixes the
// document title with `[slug]` and repaints the favicon as a colored dot (hue hashed from the slug, plus
// the slug's initial). The MAIN tree's base host (`<workspaceName>.localhost` or plain localhost) is left
// untouched.
//
// Purely runtime — it derives everything from `location.hostname`, so there is NO build-time coupling to
// which worktree is being served. Dev-only: the whole payload is gated on `ngDevMode`, which the Angular
// optimizer folds to a literal `false` in production builds, so this module tree-shakes out of prod.
// Generator-owned (nx-tools serve generator) — do not edit by hand.
import { makeEnvironmentProviders, provideEnvironmentInitializer, type EnvironmentProviders } from '@angular/core';

// The workspace identity, baked in as the base-host sentinel: a hostname whose sub-label equals this is
// the MAIN tree, not a worktree, so it gets no label.
const WORKSPACE_NAME = '{{workspaceName}}';

// Angular's dev-mode flag. The optimizer folds it to a literal `false` in production builds, which is what
// makes this whole initializer tree-shakeable out of prod. Declared locally — apps don't get a global type.
declare const ngDevMode: boolean;

/**
 * Provide the dev-only worktree tab label. In a production build `ngDevMode` folds to `false`, so the
 * initializer branch — and `applyWorktreeTabLabel` with all its DOM/canvas code — is dead-code-eliminated;
 * only the empty `makeEnvironmentProviders([])` remains.
 */
export function provideWorktreeTabLabel(): EnvironmentProviders {
  return typeof ngDevMode !== 'undefined' && ngDevMode
    ? provideEnvironmentInitializer(() => applyWorktreeTabLabel())
    : makeEnvironmentProviders([]);
}

/** Derive the label from the hostname and, when it's a worktree domain, apply the title prefix + favicon tint. */
function applyWorktreeTabLabel(): void {
  // SSR / non-browser guard — nothing to label without a document + location.
  if (typeof document === 'undefined' || typeof location === 'undefined') return;

  const match = /^([a-z0-9-]+)\.localhost$/i.exec(location.hostname);
  if (!match) return; // not a `<x>.localhost` domain (plain localhost, an IP, a real host) → no-op.

  const label = match[1].toLowerCase();
  if (!label || label === WORKSPACE_NAME.toLowerCase()) return; // the base host → no-op.

  const base = (document.title || WORKSPACE_NAME).replace(/^\[[^\]]+\]\s+/, ''); // strip any prior prefix (idempotent)
  document.title = `[${label}] ${base}`;
  tintFavicon(label);
}

/** Replace the favicon with a small colored dot — hue hashed from `label`, the slug's initial in white. */
function tintFavicon(label: string): void {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const hue = hueFromLabel(label);
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.charAt(0).toUpperCase(), size / 2, size / 2 + 1);

  setFaviconHref(canvas.toDataURL('image/png'));
}

/** Stable small hash of the label → a hue in [0, 360). Same slug → same color across restarts. */
function hueFromLabel(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Point the (single) `<link rel="icon">` at `href`, creating it if the document has none. */
function setFaviconHref(href: string): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/png';
  link.href = href;
}
