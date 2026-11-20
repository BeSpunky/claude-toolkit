// A HOUSE REGION — the part of a file the house owns, inside a file that is otherwise the project's.
//
// Ownership is per key, not per file: a barrel holds the house's exports beside the project's, a conventions doc
// the house's rules beside the project's own, an app source file the house's mechanism beside the project's look.
// A generator that owns the whole of such a file rewrites the project's half on every upgrade; one that owns none of
// it can never fix its own half. The region is the concept that sits between: two marker lines, and everything
// between them is the house's, rewritten on every run; everything outside them is never touched.
//
// THE GRAMMAR, one for every file and comment syntax: a line that OPENS a comment with `@bespunky/<name>:start` opens
// the region, and the first such line with `@bespunky/<name>:end` after it closes it. The comment is whatever the file
// speaks (`//`, `/* */`, `<!-- -->`, `#`), the marker is its first word, and the start line may carry a note after the
// name for the human reading it. The region spans both marker lines in full. A line that merely MENTIONS a marker —
// prose quoting it in backticks, a sentence telling someone where to write one — is not one: anchoring on any mention
// would let a CLAUDE.md that quotes the pointer's end marker grow a second pointer on every run, or a quoted start
// marker swallow every line between it and the real end. A second copy of a region (pasted by hand) is not maintained:
// the first is the region, and the copy is the project's text like any other. The CLAUDE.md pointer (`house-tooling`) and the stylesheet's `design-system:use` /
// `design-system:theme` blocks were the first regions; they are found through here.
import type { Tree } from '@nx/devkit';

/** A span of `source`: `from` is the start of the start marker's line, `to` the end of the end marker's line (before its newline). */
export interface RegionSpan {
  readonly from: number;
  readonly to: number;
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A comment opener, then the marker as the comment's first word. The span stops before a `\r`, so CRLF survives. */
const markerPattern = (name: string, edge: 'start' | 'end'): RegExp =>
  new RegExp(`^[ \\t]*(?://+|/\\*+|<!--|#+)[ \\t]*@bespunky/${escape(name)}:${edge}(?![\\w:-])[^\\r\\n]*`, 'gm');

/** The first marker line for `@bespunky/<name>:<edge>` at or after `from`, or null. `x:start` is not `x:starting`. */
export function markerLine(source: string, name: string, edge: 'start' | 'end', from = 0): RegionSpan | null {
  const pattern = markerPattern(name, edge);
  pattern.lastIndex = from;
  const match = pattern.exec(source);
  return match ? { from: match.index, to: match.index + match[0].length } : null;
}

/** The whole region — the first start marker, the first end marker after it, everything between — or null. */
export function findRegion(source: string, name: string): RegionSpan | null {
  const start = markerLine(source, name, 'start');
  const end = start && markerLine(source, name, 'end', start.to);
  return start && end ? { from: start.from, to: end.to } : null;
}

/**
 * A region's standing in `source`: `present` (a whole region), `absent` (no marker of it at all), or `damaged` — a
 * marker of it with no whole region around it (a start without an end, an end before its start). Damaged is not
 * absent: the file was the house's, a hand edit broke it, and it is never maintained again until someone says so.
 */
export function regionState(source: string, name: string): 'present' | 'absent' | 'damaged' {
  if (findRegion(source, name)) return 'present';
  return markerLine(source, name, 'start') || markerLine(source, name, 'end') ? 'damaged' : 'absent';
}

/** The region's text, markers included — or null. */
export function regionText(source: string, name: string): string | null {
  const span = findRegion(source, name);
  return span ? source.slice(span.from, span.to) : null;
}

/** `source` with its region replaced by `block` (markers included), or null when `source` has no such region. */
export function replaceRegion(source: string, name: string, block: string): string | null {
  const span = findRegion(source, name);
  return span ? source.slice(0, span.from) + block + source.slice(span.to) : null;
}

/** Every whole region a text declares, by name, in order. */
export function regionNames(source: string): string[] {
  const names = [...source.matchAll(/^[ \t]*(?:\/\/+|\/\*+|<!--|#+)[ \t]*@bespunky\/([\w:-]+?):start(?![\w:-])/gm)].map((m) => m[1]);
  return [...new Set(names)].filter((name) => findRegion(source, name) !== null);
}

/** `text` in the line endings `like` uses — a region written into a CRLF file is CRLF too. */
export function inLineEndingsOf(like: string, text: string): string {
  const lf = text.replace(/\r\n/g, '\n');
  return like.includes('\r\n') ? lf.replace(/\n/g, '\r\n') : lf;
}

/**
 * What a run did to a file that carries house regions:
 *   - `seeded`    — the file was absent and has been written whole;
 *   - `refreshed` — at least one of its regions changed;
 *   - `current`   — every region already matched;
 *   - `unowned`   — the file exists and carries NONE of the regions: it is wholly the project's, and was not touched;
 *   - `damaged`   — none is whole, but a marker of one survives (see regionState): not touched, and the caller says so.
 */
export type RegionSync = 'seeded' | 'refreshed' | 'current' | 'unowned' | 'damaged';

/**
 * Bring the house regions of `path` up to `rendered` — the file as the house would write it today, regions included.
 *
 * Absent, the file is written whole: the seed is the house's text with the project's half in its seeded form. Present,
 * only the regions it still carries are rewritten, each from the same region of `rendered`; the rest of the file is
 * never read for anything but finding them. A region the project removed stays removed — it has taken that part over,
 * and putting the house's text back beside its own would duplicate it (two barrels exporting one name do not compile).
 */
export function syncHouseRegions(tree: Tree, path: string, rendered: string): RegionSync {
  const names = regionNames(rendered);
  if (names.length === 0) throw new Error(`syncHouseRegions: the template for ${path} declares no house region.`);
  if (!tree.exists(path)) {
    tree.write(path, rendered);
    return 'seeded';
  }
  const current = tree.read(path, 'utf8') ?? '';
  let next = current;
  let owned = false;
  for (const name of names) {
    const replaced = replaceRegion(next, name, inLineEndingsOf(current, regionText(rendered, name)!));
    if (replaced === null) continue;
    owned = true;
    next = replaced;
  }
  if (!owned) return names.some((name) => regionState(current, name) === 'damaged') ? 'damaged' : 'unowned';
  if (next === current) return 'current';
  tree.write(path, next);
  return 'refreshed';
}

/** What a caller says about a `damaged` sync: which file, which markers, and the two ways back. */
export const DAMAGED_REGION = (path: string, names: readonly string[]): string =>
  `${path}: its house region is damaged — a ${names.map((n) => `\`@bespunky/${n}:start\``).join(' / ')} or \`:end\` marker ` +
  `line survives without its pair, so the house no longer maintains this file. Restore the missing marker line around ` +
  `the house's part, or delete both to make the whole file yours.`;
