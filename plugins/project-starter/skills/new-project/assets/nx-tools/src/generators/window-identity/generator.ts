// House generator: give the workspace a per-window VSCode IDENTITY, so a project opened in one window is
// visually distinguishable from every other open window — an emoji in window.title (dock / Alt-Tab) and a
// quiet, design-system-coloured band on a bar. This is the deterministic WRITER half of the feature; the
// bespunky-vscode-identity skill is the intelligence that finds the design-system primary and a fitting
// emoji and calls this generator with them.
//
// THREE properties earn this its own generator rather than a hand-written file edit:
//
// 1. MERGE, never clobber (the claude-settings lesson). .vscode/settings.json is co-owned — the project may
//    keep its own settings and even its own colorCustomizations there. So this re-asserts only the keys it
//    OWNS (window.title + the identity colour keys), clears the owned colour keys first so a surface change
//    cleans up the bar it no longer paints, and leaves every other key the project added untouched.
//
// 2. A no-clobber PROVENANCE RATCHET (the stamp lesson). A colour has a source — name-hash < design-system <
//    manual — recorded in .vscode/.window-identity.json. A run only writes when its source RANKS >= the
//    recorded one, so a --repair's name-hash pass can never downgrade a design-system or hand-picked colour,
//    and an automated design-system re-derive can never stomp a human's manual choice.
//
// 3. DETERMINISM. Colours are pure functions of (primary | name) — see color.ts — so a repair regenerates
//    byte-identical output and a name-hashed colour is stable across machines and clones.
import { type Tree } from '@nx/devkit';
import {
  colorCustomizations,
  deriveShades,
  nameToPrimaryHex,
  OWNED_KEYS,
  parseHex,
  toHex,
  type Surface,
} from './color';
import { type WindowIdentitySchema } from './schema';

type Json = Record<string, unknown>;
type Source = 'name-hash' | 'design-system' | 'manual';

const SETTINGS = '.vscode/settings.json';
const MARKER = '.vscode/.window-identity.json';

// A neutral placeholder emoji. The COLOUR carries per-project distinctness at baseline; the skill replaces
// this with something project-fitting. A window pane reads as "this is a window identity" — honest about
// being a default, in the same spirit as the design-system generator's loudly-placeholder token values.
const DEFAULT_EMOJI = '🪟';

// window.title uses VSCode's ${rootName} so the label tracks the folder without this generator knowing it.
// Built by concatenation, NOT a template literal, so TypeScript doesn't try to interpolate ${...}.
const TITLE_TAIL = ' ${rootName}${separator}${activeEditorShort}';

const RANK: Record<Source, number> = { 'name-hash': 0, 'design-system': 1, manual: 2 };

// The gitignore block --personal maintains. Marked so it can be inserted, healed, or removed idempotently.
const IGNORE_START = '# @bespunky/window-identity:personal (git-ignored personal window identity)';
const IGNORE_BODY = `${IGNORE_START}\n${SETTINGS}\n${MARKER}\n`;

interface Marker {
  source: Source;
  primary: string;
  emoji: string;
  surface: Surface;
}

export default async function windowIdentityGenerator(
  tree: Tree,
  options: WindowIdentitySchema = {},
): Promise<void> {
  const name = options.name ?? workspaceName(tree) ?? 'project';
  const surface: Surface = options.surface ?? 'status';
  const personal = options.personal ?? false;
  const source: Source = options.source ?? (options.primary ? 'design-system' : 'name-hash');

  const existing = readMarker(tree);

  // The ratchet: never let a lower-authority run overwrite a higher-authority identity. Equal rank re-writes
  // (a legitimate refresh — repair re-asserting name-hash, or a design-system colour that changed).
  if (existing && RANK[source] < RANK[existing.source]) return;

  const primary =
    normalizeHex(options.primary) ??
    (source === 'name-hash' ? nameToPrimaryHex(name) : existing?.primary ?? nameToPrimaryHex(name));
  const emoji = options.emoji ?? existing?.emoji ?? DEFAULT_EMOJI;

  const colors = colorCustomizations(surface, deriveShades(primary));

  // --- write settings.json (merge) -------------------------------------------------------------------------
  const settings = readJson(tree, SETTINGS) ?? {};
  settings['window.title'] = emoji + TITLE_TAIL;

  const existingColors = isPlainObject(settings['workbench.colorCustomizations'])
    ? { ...(settings['workbench.colorCustomizations'] as Json) }
    : {};
  for (const key of OWNED_KEYS) delete existingColors[key]; // clear our keys; keep the project's own
  Object.assign(existingColors, colors);
  if (Object.keys(existingColors).length > 0) settings['workbench.colorCustomizations'] = existingColors;
  else delete settings['workbench.colorCustomizations'];

  writeJson(tree, SETTINGS, settings);

  // --- write the provenance marker -------------------------------------------------------------------------
  const marker: Marker = { source, primary, emoji, surface };
  writeJson(tree, MARKER, marker as unknown as Json);

  // --- personal vs committed: maintain the gitignore block -------------------------------------------------
  setPersonalIgnore(tree, personal);
}

/** Read the workspace name from the root package.json (scope stripped), or `null`. Seeds the name hash. */
function workspaceName(tree: Tree): string | null {
  const pkg = readJson(tree, 'package.json');
  const raw = pkg?.['name'];
  return typeof raw === 'string' && raw ? raw.replace(/^@[^/]+\//, '') : null;
}

/** Canonicalise a hex colour, or `undefined` when the input isn't a valid hex (so callers fall back). */
function normalizeHex(hex: string | undefined): string | undefined {
  if (!hex) return undefined;
  const rgb = parseHex(hex);
  return rgb ? toHex(rgb) : undefined;
}

/** Read the provenance marker, validating `source` — a garbled marker is treated as absent (start fresh). */
function readMarker(tree: Tree): Marker | null {
  const raw = readJson(tree, MARKER);
  if (!raw) return null;

  const { source, primary, emoji, surface } = raw as Partial<Marker>;
  if (source !== 'name-hash' && source !== 'design-system' && source !== 'manual') return null;
  if (typeof primary !== 'string' || typeof emoji !== 'string') return null;

  const s: Surface[] = ['title', 'status', 'titlebar', 'both'];
  return { source, primary, emoji, surface: s.includes(surface as Surface) ? (surface as Surface) : 'status' };
}

/** Insert / heal / remove the --personal gitignore block, idempotently. */
function setPersonalIgnore(tree: Tree, personal: boolean): void {
  const current = tree.exists('.gitignore') ? tree.read('.gitignore', 'utf8') ?? '' : '';
  const withoutBlock = stripIgnoreBlock(current);

  if (personal) {
    const sep = withoutBlock === '' || withoutBlock.endsWith('\n') ? '' : '\n';
    tree.write('.gitignore', `${withoutBlock}${sep}\n${IGNORE_BODY}`);
  } else if (withoutBlock !== current) {
    tree.write('.gitignore', withoutBlock);
  }
}

/** Remove a previously-written IGNORE_BODY block (and a trailing blank line) from a .gitignore string. */
function stripIgnoreBlock(gitignore: string): string {
  const lines = gitignore.split('\n');
  const start = lines.indexOf(IGNORE_START);
  if (start === -1) return gitignore;

  // The block is the marker line plus the two path lines that follow it.
  const end = start + 3;
  const before = lines.slice(0, start).join('\n').replace(/\n+$/, '\n');
  const after = lines.slice(end).join('\n');
  return `${before}${after}`.replace(/\n{3,}/g, '\n\n');
}

function readJson(tree: Tree, path: string): Json | undefined {
  if (!tree.exists(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(tree.read(path, 'utf8') ?? '');
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(tree: Tree, path: string, value: Json): void {
  tree.write(path, `${JSON.stringify(value, null, 2)}\n`);
}

function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
