// 0.29.0 — move an existing window identity from a status-bar-only band to `both` (status bar AND title bar),
// following the change of the window-identity generator's default `surface` from `status` to `both`.
//
// WHY A MIGRATION AND NOT JUST THE GENERATOR. The surface colours are owned template output — the generator
// clears its owned keys and repaints per the current surface on every run — so a name-hash project picks up
// the new default the next time the generator runs. But two facts make that insufficient on its own, which is
// exactly the gap a migration fills:
//
//   1. A project carrying a REAL identity (a design-system primary, or a hand-picked `manual` colour) is
//      protected by the generator's provenance ratchet: a plain `--sync` runs the generator at `name-hash`
//      authority, which ranks BELOW the recorded source, so the generator early-returns and never repaints it.
//      Only something not subject to the ratchet — this migration — can move those projects to `both`.
//   2. `nx migrate --run-migrations` can be run on its own, without the full scaffold sync that invokes the
//      generator. So the migration must fully transition the identity by itself rather than lean on a generator
//      run happening later in the same sync.
//
// DELIBERATELY MOVES EVERY MARKED PROJECT, including one whose marker records `surface: "status"`. That value
// is almost always the OLD DEFAULT inherited (the skill re-derives with `--primary` but no `--surface`), not a
// deliberate choice — and the marker cannot distinguish the two. The house call (recorded in this effort's
// DECISION.md) was to follow the new default everywhere, accepting that the rare project that deliberately ran
// `--surface=status` is moved to `both` too. It loses nothing that a one-flag re-run does not restore
// (`nx g @bespunky/nx-tools:window-identity --surface=status --source=manual`), and `both` degrades gracefully
// to the status band alone where the title bar is OS-native, so no project is left worse off.
//
// CLEANUP IS INHERENT, not skipped. `both` is a strict SUPERSET of `status`: it writes every owned colour key
// the old surface wrote and adds the title-bar keys. So there is no retired key to delete, no moved path to
// retarget, no duplicate to clear — the old state (marker `surface`, the status-only key set) is fully
// overwritten by the new one. The only thing NOT touched is a project with no marker at all: that is either an
// identity this generator never wrote or an unmarked human one the ratchet protects, and moving it would be the
// guess the house rules forbid — so it is left alone (and there is nothing to report, since it is not ours).
//
// SELF-CONTAINED ON PURPOSE, like every migration here: the colour derivation is COPIED from the generator's
// color.ts verbatim, not imported, so a project jumping several versions at once gets the 0.29.0 both-band it
// was written against rather than whatever a future color.ts computes. The values are a pure function of the
// marker's recorded primary, so this reproduces byte-for-byte what the 0.29.0 generator writes for `both`.
import { type Tree, parseJson, logger } from '@nx/devkit';
import { applyEdits, modify } from 'jsonc-parser';

const SETTINGS = '.vscode/settings.json';
const MARKER = '.vscode/.window-identity.json';

type Surface = 'title' | 'status' | 'titlebar' | 'both';
type Json = Record<string, unknown>;

interface Marker {
  source: 'name-hash' | 'design-system' | 'manual';
  primary: string;
  emoji: string;
  surface: Surface;
}

export default async function migrateWindowIdentitySurfaceToBoth(tree: Tree): Promise<void> {
  const marker = readMarker(tree);

  // No marker → not an identity this generator wrote (or an unmarked human one). Not ours to move; nothing to
  // report, because there is no leftover — there was never anything here to migrate.
  if (!marker) return;

  // Already on `both` → the transition is done. Idempotent: re-running the ladder changes nothing.
  if (marker.surface === 'both') return;

  const from = marker.surface;
  const colors = bothColors(deriveShades(marker.primary));

  // --- merge the both-band into settings.json, COMMENT-PRESERVING ------------------------------------------
  // Same discipline as the generator: parse and edit as JSONC so a project's own settings and the comments
  // explaining its palette survive. Every edit ADDS a key (never a delete), so it is safe even on a `{}`
  // document — `both` is a superset, so no owned key is being removed.
  const settingsText = readText(tree, SETTINGS) || '{}';
  const edits: JsonEdit[] = Object.entries(colors).map(([key, value]) => ({
    path: ['workbench.colorCustomizations', key],
    value,
  }));
  tree.write(SETTINGS, applyJsoncEdits(settingsText, edits));

  // --- move the marker to `both` ---------------------------------------------------------------------------
  const next: Marker = { ...marker, surface: 'both' };
  tree.write(MARKER, `${JSON.stringify(next, null, 2)}\n`);

  logger.info(
    `[migrate-window-identity-surface-to-both] Moved the window identity from '${from}' to 'both' — the ` +
      `title-bar band now matches the status band (${SETTINGS}, ${MARKER}). It needs ` +
      `window.titleBarStyle: custom to paint the title bar, and otherwise shows the status band alone. To keep ` +
      `a status-only identity, re-run: nx g @bespunky/nx-tools:window-identity --surface=status --source=manual`,
  );
}

/** Read + validate the provenance marker; a garbled marker is treated as absent (not ours to touch). */
function readMarker(tree: Tree): Marker | null {
  const text = readText(tree, MARKER);
  if (!text) return null;

  let raw: unknown;
  try {
    raw = parseJson(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;

  const { source, primary, emoji, surface } = raw as Partial<Marker>;
  if (source !== 'name-hash' && source !== 'design-system' && source !== 'manual') return null;
  if (typeof primary !== 'string' || typeof emoji !== 'string') return null;
  const surfaces: Surface[] = ['title', 'status', 'titlebar', 'both'];
  if (!surfaces.includes(surface as Surface)) return null;

  return { source, primary, emoji, surface: surface as Surface };
}

// ── The `both` colour key set — COPIED from color.ts (colorCustomizations + OWNED_KEYS, the both case) ───────
// `both` paints every owned key: the six status keys and the four title keys. Frozen here so this migration's
// output never drifts with a future color.ts.
function bothColors(s: Shades): Record<string, string> {
  return {
    'statusBar.background': s.band,
    'statusBar.foreground': s.fg,
    'statusBar.noFolderBackground': s.band,
    'statusBar.debuggingBackground': s.band,
    'statusBarItem.remoteBackground': s.bandDark,
    'statusBarItem.remoteForeground': s.fg,
    'titleBar.activeBackground': s.bandDark,
    'titleBar.activeForeground': s.fg,
    'titleBar.inactiveBackground': s.bandDarker,
    'titleBar.inactiveForeground': s.fgMuted,
  };
}

// ── Colour derivation — COPIED VERBATIM from the window-identity generator's color.ts (0.29.0) ───────────────
// Pure functions of the primary hex; no Date/Math.random, so byte-identical to the generator's output.

interface Rgb { r: number; g: number; b: number; }
interface Hsl { h: number; s: number; l: number; }
interface Shades { band: string; bandDark: string; bandDarker: string; fg: string; fgMuted: string; }

function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
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

function hslToRgb({ h, s, l }: Hsl): Rgb {
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

function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => {
    const srgb = c / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function deriveShades(primaryHex: string): Shades {
  const hsl = rgbToHsl(parseHex(primaryHex) ?? { r: 0x88, g: 0x88, b: 0x88 });
  const s = Math.min(hsl.s, 0.5);

  const band = toHex(hslToRgb({ h: hsl.h, s, l: 0.34 }));
  const bandDark = toHex(hslToRgb({ h: hsl.h, s: Math.min(s, 0.45), l: 0.26 }));
  const bandDarker = toHex(hslToRgb({ h: hsl.h, s: Math.min(s, 0.4), l: 0.2 }));

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

// ── JSONC edit helpers (comment-preserving), matching the generator ─────────────────────────────────────────

const JSONC_FORMAT = { tabSize: 2, insertSpaces: true, eol: '\n' };

interface JsonEdit {
  path: (string | number)[];
  value: unknown;
}

function applyJsoncEdits(source: string, edits: JsonEdit[]): string {
  return edits.reduce(
    (text, { path, value }) => applyEdits(text, modify(text, path, value, { formattingOptions: JSONC_FORMAT })),
    source,
  );
}

function readText(tree: Tree, path: string): string {
  return tree.exists(path) ? tree.read(path, 'utf8') ?? '' : '';
}
