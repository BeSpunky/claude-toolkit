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
//    recorded one, so a --sync's name-hash pass can never downgrade a design-system or hand-picked colour,
//    and an automated design-system re-derive can never stomp a human's manual choice.
//
// 3. DETERMINISM. Colours are pure functions of (primary | name) — see color.ts — so a sync regenerates
//    byte-identical output and a name-hashed colour is stable across machines and clones.
import { type Tree, logger, parseJson } from '@nx/devkit';
import { applyEdits, modify } from 'jsonc-parser';
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
  const surface: Surface = options.surface ?? 'both';
  const personal = options.personal ?? false;
  const source: Source = options.source ?? (options.primary ? 'design-system' : 'name-hash');

  const existing = readMarker(tree);

  // The ratchet: never let a lower-authority run overwrite a higher-authority identity. Equal rank re-writes
  // (a legitimate refresh — sync re-asserting name-hash, or a design-system colour that changed).
  if (existing && RANK[source] < RANK[existing.source]) return;

  // UNMARKED HUMAN IDENTITY. The ratchet can only defend what it recorded — and a project that set its own
  // `window.title` / bar colours BEFORE this generator ever ran (or by hand, in the editor) has no marker at
  // all. Treated naively that reads as "no identity", so an automatic name-hash pass would overwrite a
  // deliberate choice with a hashed one — the exact downgrade the ratchet exists to prevent, arriving through
  // the one door it doesn't watch. So an automatic pass DETECTS a pre-existing identity and leaves it alone.
  // Only an automatic pass defers: an explicit --primary/--emoji/--source is a human (or the skill) asking for
  // a specific identity, and that still wins.
  const automatic = source === 'name-hash' && !options.primary && !options.emoji;
  if (!existing && automatic && hasUnmarkedIdentity(tree)) {
    logger.info(
      `[window-identity] \`${SETTINGS}\` already defines a window identity that this generator did not write — ` +
        `keeping it. Re-run with an explicit --primary/--emoji (or let the bespunky-vscode-identity skill drive it) ` +
        `to replace it deliberately.`,
    );
    return;
  }

  const primary =
    normalizeHex(options.primary) ??
    (source === 'name-hash' ? nameToPrimaryHex(name) : existing?.primary ?? nameToPrimaryHex(name));
  const emoji = options.emoji ?? existing?.emoji ?? DEFAULT_EMOJI;

  const colors = colorCustomizations(surface, deriveShades(primary));

  // --- write settings.json (merge, COMMENT-PRESERVING) ------------------------------------------------------
  // `.vscode/settings.json` is JSONC in practice: VSCode itself writes comments into it, and humans annotate
  // WHY a colour was chosen right next to it. `JSON.parse` throws on that — and the old code caught the throw
  // and started from `{}`, which silently turned "merge, never clobber" (property 1 in the header) into a total
  // rewrite: every comment and every setting the project owned was destroyed. The provenance ratchet could not
  // save it either, because the marker file is written in the same breath. So: PARSE as JSONC (devkit's
  // parseJson) and EDIT as JSONC (jsonc-parser splices individual keys in place), which keeps comments,
  // formatting and key order intact.
  const settingsText = readText(tree, SETTINGS) || '{}';
  const settings = readJsonc(settingsText) ?? {};

  const currentColors = isPlainObject(settings['workbench.colorCustomizations'])
    ? (settings['workbench.colorCustomizations'] as Json)
    : {};
  // Keep every colour key the PROJECT set; drop the ones we own (so a surface change cleans up the bar it no
  // longer paints); then lay ours on top.
  const owned = OWNED_KEYS as readonly string[]; // widened: OWNED_KEYS is `as const`, so .includes(string) needs it
  const kept = Object.fromEntries(Object.entries(currentColors).filter(([key]) => !owned.includes(key)));
  const nextColors: Json = { ...kept, ...colors };

  // Per-KEY edits rather than one whole-object replace: replacing the object wholesale would drop any comment
  // written INSIDE the colorCustomizations block — exactly where people explain their palette.
  // NEVER emit a delete for something that isn't there. jsonc-parser throws ("Can not delete in empty
  // document") rather than no-opping, so an unconditional cleanup edit — correct on a settings file that has
  // our keys — takes the whole run down on a project that has no .vscode/settings.json at all. Which is every
  // repo this generator now reaches: the layered sync applies the agent layer to projects that were never
  // scaffolded. So each delete is conditioned on the key actually existing in the CURRENT document.
  const edits: JsonEdit[] = [{ path: ['window.title'], value: emoji + TITLE_TAIL }];
  if (Object.keys(nextColors).length === 0) {
    if (settings['workbench.colorCustomizations'] !== undefined) {
      edits.push({ path: ['workbench.colorCustomizations'], value: undefined });
    }
  } else {
    for (const key of OWNED_KEYS) {
      if (!(key in nextColors) && key in currentColors) {
        edits.push({ path: ['workbench.colorCustomizations', key], value: undefined });
      }
    }
    for (const [key, value] of Object.entries(nextColors)) {
      edits.push({ path: ['workbench.colorCustomizations', key], value });
    }
  }

  tree.write(SETTINGS, applyJsoncEdits(settingsText, edits));

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

/**
 * Does `.vscode/settings.json` already carry a window identity this generator did not write?
 *
 * True when a `window.title` is set, or when ANY key we own already has a value. Both are things a human (or
 * an older, pre-marker toolkit) put there deliberately — and neither is something an automatic name-hash pass
 * has any business replacing. Paired with the marker check in the caller: a marker means we own it and the
 * ratchet decides; no marker plus a visible identity means somebody else owns it and we keep our hands off.
 */
function hasUnmarkedIdentity(tree: Tree): boolean {
  const settings = readJson(tree, SETTINGS);
  if (!settings) return false;

  if (typeof settings['window.title'] === 'string' && settings['window.title'].trim() !== '') return true;

  const colors = isPlainObject(settings['workbench.colorCustomizations'])
    ? (settings['workbench.colorCustomizations'] as Json)
    : {};
  return (OWNED_KEYS as readonly string[]).some((key) => key in colors);
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
  return { source, primary, emoji, surface: s.includes(surface as Surface) ? (surface as Surface) : 'both' };
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

/** JSONC formatting for spliced edits — 2-space, matching VSCode's own settings style. */
const JSONC_FORMAT = { tabSize: 2, insertSpaces: true, eol: '\n' };

interface JsonEdit {
  path: (string | number)[];
  /** `undefined` REMOVES the key (jsonc-parser's delete semantics). */
  value: unknown;
}

/**
 * Apply key edits to a JSONC document IN PLACE — comments, formatting and key order all survive, because
 * jsonc-parser splices the minimal text range for each key rather than re-serializing the document.
 */
function applyJsoncEdits(source: string, edits: JsonEdit[]): string {
  return edits.reduce(
    (text, { path, value }) => applyEdits(text, modify(text, path, value, { formattingOptions: JSONC_FORMAT })),
    source,
  );
}

/** Raw file text, or `''` when the file is absent. */
function readText(tree: Tree, path: string): string {
  return tree.exists(path) ? tree.read(path, 'utf8') ?? '' : '';
}

/**
 * Parse a JSONC string (comments + trailing commas tolerated — devkit's parseJson, not JSON.parse).
 * `undefined` means genuinely unparseable, not merely commented.
 */
function readJsonc(source: string): Json | undefined {
  try {
    const parsed: unknown = parseJson(source);
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Read + parse a JSONC file from the tree. */
function readJson(tree: Tree, path: string): Json | undefined {
  const text = readText(tree, path);
  return text ? readJsonc(text) : undefined;
}

function writeJson(tree: Tree, path: string, value: Json): void {
  tree.write(path, `${JSON.stringify(value, null, 2)}\n`);
}

function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
