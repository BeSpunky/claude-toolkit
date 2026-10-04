// DEVCONTAINER PROVENANCE — which parts of a devcontainer.json the HOUSE wrote.
//
// An OWNED devcontainer (marker `owned: true`) is the house's file: a key the house once rendered is the house's
// to change or remove. An ADOPTED one is the project's, and the merge only ever ADDS to it — so, without a
// record, every later migration had to treat a key the house itself added as possibly the project's, and could
// only REPORT it, never clean it up (0.40.0 retire-claude-code-feature met exactly that: a feature the house's
// own merge had put there, left behind in every adopted project as "maybe yours").
//
// So the adopted merge RECORDS each addition in the marker (`adopted.houseAdded`), and this module is the one
// place that answers "did the house write this?" — the generator to keep the record, migrations to ask it.
//
// A record entry only counts while the file STILL HOLDS it, exactly as written: a value the project has since
// changed has become the project's, and an entry the project removed is gone. The generator prunes both on
// every run; `houseWrote` re-checks anyway, because a migration may run on a file edited since that run.
//
// Projects adopted before the record existed have none for their earlier additions — those stay "maybe yours"
// (reported, never removed); the record covers what the merge adds from here on.
import type { Tree } from '@nx/devkit';
import { parseJson } from '@nx/devkit';

export const DEVCONTAINER = '.devcontainer/devcontainer.json';
export const DEVCONTAINER_MARKER = '.devcontainer/.bespunky-devcontainer.json';

type Json = unknown;

/**
 * One thing the house added to an adopted devcontainer.json: a VALUE written at an object `path`
 * (`["features", "ghcr.io/…/github-cli"]`), or a MEMBER appended to the array at `path` (`["mounts"]`).
 * Paths are segment arrays, never dotted strings — feature ids are full of dots and slashes.
 */
export type HouseWrite = { path: string[]; value: Json } | { path: string[]; member: Json };

/** Does `doc` still hold `entry` exactly as the house wrote it? */
export function holds(doc: Json, entry: HouseWrite): boolean {
  const at = entry.path.reduce<Json>(
    (node, key) => (node && typeof node === 'object' && !Array.isArray(node) ? (node as Record<string, Json>)[key] : undefined),
    doc,
  );
  if ('member' in entry) return Array.isArray(at) && at.some((have) => same(have, entry.member));
  return at !== undefined && same(at, entry.value);
}

/**
 * The record to write: what was recorded before and the file still holds, plus this run's additions —
 * de-duplicated, so a re-run never grows it.
 */
export function reconcileHouseAdded(previous: readonly HouseWrite[], added: readonly HouseWrite[], doc: Json): HouseWrite[] {
  const kept: HouseWrite[] = [];
  for (const entry of [...previous, ...added]) {
    if (!holds(doc, entry)) continue;
    if (kept.some((have) => same(have, entry))) continue;
    kept.push(entry);
  }
  return kept;
}

/** The record as the marker holds it — empty when there is no marker, no record, or it cannot be read. */
export function recordedHouseAdded(marker: Json): HouseWrite[] {
  const list = (marker as { adopted?: { houseAdded?: unknown } } | null)?.adopted?.houseAdded;
  return Array.isArray(list) ? list.filter(isHouseWrite) : [];
}

/**
 * THE question a migration asks before removing or rewriting something in a devcontainer.json: did the house
 * write it? True when the house OWNS the file, or when the adopted record says the house added exactly this
 * and the file still holds it. Anything else is the project's — report it, never remove it.
 */
export function houseWrote(tree: Tree, entry: HouseWrite): boolean {
  const marker = read(tree, DEVCONTAINER_MARKER);
  if ((marker as { owned?: unknown } | undefined)?.owned === true) return true;
  const doc = read(tree, DEVCONTAINER);
  return doc !== undefined && holds(doc, entry) && recordedHouseAdded(marker).some((have) => same(have, entry));
}

function read(tree: Tree, file: string): Json | undefined {
  try {
    return tree.exists(file) ? parseJson(tree.read(file, 'utf8') ?? '') : undefined;
  } catch {
    return undefined;
  }
}

function isHouseWrite(entry: unknown): entry is HouseWrite {
  if (!entry || typeof entry !== 'object') return false;
  const { path } = entry as { path?: unknown };
  return Array.isArray(path) && path.every((key) => typeof key === 'string') && ('value' in entry || 'member' in entry);
}

/** Structural equality — these are config values (scalars, small arrays and objects), not identities. */
function same(a: Json, b: Json): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
