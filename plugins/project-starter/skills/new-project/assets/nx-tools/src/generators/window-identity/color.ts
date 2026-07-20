// Deterministic colour derivation for the window-identity generator.
//
// Everything here is a PURE function of its inputs — no Date, no Math.random — so the same project name
// (or the same design-system primary) always yields the same window identity. That determinism is the
// whole point: `scaffold.sh --repair` must regenerate byte-identical settings, and a name-hashed colour
// must be stable across machines and clones, or the identity would flicker on every run and dirty the tree.
//
// The design brief (from the POC): a QUIET band, never a Peacock glow. So a primary is always pushed to a
// mid-dark lightness with capped saturation before it colours a bar, and the foreground is chosen by actual
// WCAG contrast against that band — not assumed white.

export type Surface = 'title' | 'status' | 'titlebar' | 'both';

export interface Rgb { r: number; g: number; b: number; } // channels 0..255
export interface Hsl { h: number; s: number; l: number; } // h 0..360, s/l 0..1

/** Parse `#rgb` / `#rrggbb` (leading `#` optional) → rgb, or `null` when it isn't a hex colour. */
export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;

  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** rgb → canonical lowercase `#rrggbb`, clamping each channel into range. */
export function toHex({ r, g, b }: Rgb): string {
  const channel = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l };

  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h = (h * 60 + 360) % 360;

  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/** WCAG relative luminance of an rgb colour (0 = black, 1 = white). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours (1..21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * A project name → a stable "primary" hex — the NAME-HASH placeholder colour used before a project has a
 * design system. FNV-1a over the name picks the hue (distinct per project, deterministic); saturation and
 * lightness are fixed at pleasant mid values. `Math.imul` keeps the hash in 32-bit integer space.
 */
export function nameToPrimaryHex(name: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hue = (h >>> 0) % 360;
  return toHex(hslToRgb({ h: hue, s: 0.5, l: 0.45 }));
}

export interface Shades {
  /** The status-bar band — the liveliest of the three, a thin strip carries more colour gracefully. */
  band: string;
  /** A darker band for the title bar (a full-width surface wants a calmer tone) and the remote indicator. */
  bandDark: string;
  /** Darker still — the inactive title bar. */
  bandDarker: string;
  /** Foreground chosen by real contrast against `band` — a hue-tinted near-white or near-dark. */
  fg: string;
  /** A muted foreground for the inactive title bar. */
  fgMuted: string;
}

/**
 * Derive the quiet-band palette from a primary hex. Saturation is capped and lightness pinned to mid-dark
 * targets so any brand colour — even a neon — becomes a calm, readable band rather than a glowing one.
 */
export function deriveShades(primaryHex: string): Shades {
  const hsl = rgbToHsl(parseHex(primaryHex) ?? { r: 0x88, g: 0x88, b: 0x88 });
  const s = Math.min(hsl.s, 0.5);

  const band = toHex(hslToRgb({ h: hsl.h, s, l: 0.34 }));
  const bandDark = toHex(hslToRgb({ h: hsl.h, s: Math.min(s, 0.45), l: 0.26 }));
  const bandDarker = toHex(hslToRgb({ h: hsl.h, s: Math.min(s, 0.4), l: 0.2 }));

  // Foreground: pick the hue-tinted light or dark that actually clears more contrast on the band.
  const bandRgb = parseHex(band)!;
  const light = hslToRgb({ h: hsl.h, s: 0.3, l: 0.92 });
  const dark = hslToRgb({ h: hsl.h, s: 0.3, l: 0.12 });
  const fgRgb = contrastRatio(light, bandRgb) >= contrastRatio(dark, bandRgb) ? light : dark;
  const onLight = relativeLuminance(fgRgb) > 0.5;

  return {
    band,
    bandDark,
    bandDarker,
    fg: toHex(fgRgb),
    fgMuted: toHex(hslToRgb({ h: hsl.h, s: 0.2, l: onLight ? 0.72 : 0.32 })),
  };
}

/**
 * Every VSCode `workbench.colorCustomizations` key this generator OWNS. On each run the generator clears all
 * of these before writing the current surface's subset — that's how a surface change (status → titlebar)
 * cleans up the bar it no longer colours, while any colour key the PROJECT added survives untouched.
 */
export const OWNED_KEYS = [
  'statusBar.background',
  'statusBar.foreground',
  'statusBar.noFolderBackground',
  'statusBar.debuggingBackground',
  'statusBarItem.remoteBackground',
  'statusBarItem.remoteForeground',
  'titleBar.activeBackground',
  'titleBar.activeForeground',
  'titleBar.inactiveBackground',
  'titleBar.inactiveForeground',
] as const;

/** The colour keys for a surface. `title` colours nothing (emoji-in-title only) → empty. */
export function colorCustomizations(surface: Surface, shades: Shades): Record<string, string> {
  const out: Record<string, string> = {};
  const wantStatus = surface === 'status' || surface === 'both';
  const wantTitle = surface === 'titlebar' || surface === 'both';

  if (wantStatus) {
    out['statusBar.background'] = shades.band;
    out['statusBar.foreground'] = shades.fg;
    // A blurred/no-folder/debugging window keeps the same identity instead of VSCode's default blue/orange.
    out['statusBar.noFolderBackground'] = shades.band;
    out['statusBar.debuggingBackground'] = shades.band;
    // The remote indicator (green "WSL"/container chunk) would otherwise fight the band — fold it in.
    out['statusBarItem.remoteBackground'] = shades.bandDark;
    out['statusBarItem.remoteForeground'] = shades.fg;
  }
  if (wantTitle) {
    out['titleBar.activeBackground'] = shades.bandDark;
    out['titleBar.activeForeground'] = shades.fg;
    out['titleBar.inactiveBackground'] = shades.bandDarker;
    out['titleBar.inactiveForeground'] = shades.fgMuted;
  }
  return out;
}
