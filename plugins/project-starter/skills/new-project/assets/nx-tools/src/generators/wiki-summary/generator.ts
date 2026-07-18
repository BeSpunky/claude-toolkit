// House generator: regenerate `<wikiFolder>/summary.json` for a library's wiki.
//
// This is a devkit port of the legacy `tools/generators/generate-wiki-summary.js` Node script
// (byte-identical across angular-zen and angular-google-maps). The port preserves the script's
// contract EXACTLY while gaining two things the script could not have:
//
//   1. Tree-first I/O — it walks the wiki via the Nx `Tree` (`tree.children`/`tree.isFile`/
//      `tree.read`), never raw `fs`. That makes it dry-run-safe and composable with other
//      generators in a single `nx g` run (the whole point of porting a script to a generator).
//   2. A fixed `.order` parser — the original split on the literal `'\r\n'`, which silently
//      collapses an LF-only `.order` file into a single line (every order index becomes
//      `undefined`, so `sort` no-ops and the output falls back to readdir/alphabetical order).
//      `parseOrder` below splits on `/\r?\n/` and trims, so ordering is honored on LF and CRLF
//      alike. See the deviation note in the generator's report / PR.
//
// Contract preserved verbatim from the donor:
//   - Folders = entries that do NOT start with '.' and do NOT end with '.md'.
//   - Docs    = entries that end with '.md'.
//   - `.order` lists doc names WITHOUT the `.md` extension; the order map keys append `.md`.
//   - title   = filename sans `.md`, with every '-' replaced by a space.
//   - file    = `${path}/${doc}` — note the root call uses path '' so root files are `/<doc>.md`.
//   - A doc gains `children` ONLY when a sibling folder of the same name (sans `.md`) exists.
import {
  type Tree,
  writeJson,
  formatFiles,
} from '@nx/devkit';
import { WikiSummaryGeneratorSchema } from './schema';

/** A single node in the generated summary tree. */
interface SummaryNode {
  title: string;
  file: string;
  children?: SummaryNode[];
}

/**
 * Parse a `.order` file's contents into an ordered list of doc names.
 *
 * LF/CRLF-tolerant (`/\r?\n/`) and trims each line — the fix for the donor's latent
 * `split('\r\n')` bug. Blank lines (and whitespace-only lines) are dropped so a trailing
 * newline never injects a phantom entry. Pure + side-effect-free so it is unit-testable in
 * isolation against both line-ending styles.
 *
 * @param content Raw `.order` file contents.
 * @returns The doc names in declared order (WITHOUT the `.md` extension), as authored.
 */
export function parseOrder(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// Predicates mirroring the donor's extract* helpers.
const isFolderName = (name: string): boolean => !name.startsWith('.') && !name.endsWith('.md');
const isMarkdownDoc = (name: string): boolean => name.endsWith('.md');

/**
 * Build the order map for a folder: `<docName>.md` -> declared index.
 *
 * Mirrors the donor's `createMarkdownOrderMap` — reads the per-folder `.order` (if present) via
 * the Tree and appends `.md` to each entry so the keys match the doc names yielded by the walk.
 */
function createMarkdownOrderMap(tree: Tree, folderPath: string): Record<string, number> {
  const orderFile = `${folderPath}/.order`;

  if (!tree.exists(orderFile)) return {};

  // ASSUMPTION: `.order` is UTF-8 text (the donor read it with 'utf8'). `tree.read(path,'utf-8')`
  // returns the decoded string; we coalesce a null read (race / vanished file) to '' so a missing
  // file behaves identically to an empty order map.
  const content = tree.read(orderFile, 'utf-8') ?? '';

  return parseOrder(content).reduce<Record<string, number>>((map, fileName, index) => {
    map[`${fileName}.md`] = index;
    return map;
  }, {});
}

/**
 * Recursively summarise a directory of the wiki, relative to `wikiFolder`.
 *
 * @param tree       The Nx Tree.
 * @param wikiFolder The summary root (workspace-relative); never part of the emitted `file` path.
 * @param path       The current sub-path relative to `wikiFolder`. '' for the root call, so root
 *                   docs emit as `/<doc>` exactly like the donor (`${path}/${doc}`).
 */
function generateDirectorySummary(tree: Tree, wikiFolder: string, path: string): SummaryNode[] {
  const scannedPath = path === '' ? wikiFolder : `${wikiFolder}/${path}`;

  // ASSUMPTION: `tree.children` returns the immediate child names (files + dirs) of a dir, akin to
  // `fs.readdirSync`. The donor relies on readdir's order as the *tie-breaker* for docs whose
  // `.order` index is equal/undefined; the Tree's child order is the analogous tie-breaker here.
  const contentList = tree.children(scannedPath);

  // A name is a folder when it is NOT a Tree file (mirrors fs directory detection) AND passes the
  // donor's name filter (no leading '.', not a '.md'). Checking `isFile` keeps us honest even if a
  // name without an extension were somehow a file.
  const folderSet = new Set(
    contentList.filter(
      (name) => isFolderName(name) && !tree.isFile(`${scannedPath}/${name}`)
    )
  );

  const docs = contentList.filter(
    (name) => isMarkdownDoc(name) && tree.isFile(`${scannedPath}/${name}`)
  );

  const order = createMarkdownOrderMap(tree, scannedPath);

  // Preserve the donor's exact sort: `order[a] - order[b]`. An unlisted doc yields `undefined`,
  // so the subtraction is `NaN` and the comparator leaves relative order unchanged (the engine's
  // stable sort keeps the `tree.children` order) — identical fallback semantics to the original.
  return [...docs]
    .sort((doc1, doc2) => order[doc1] - order[doc2])
    .map((doc) => {
      const fileName = doc.substring(0, doc.length - '.md'.length);

      const node: SummaryNode = {
        title: fileName.replace(/-/g, ' '),
        file: `${path}/${doc}`,
      };

      // `children` only when a sibling folder of the same name exists — verbatim donor rule.
      if (folderSet.has(fileName)) {
        const childPath = `${path}/${fileName}`;
        node.children = generateDirectorySummary(tree, wikiFolder, childPath);
      }

      return node;
    });
}

export default async function wikiSummaryGenerator(
  tree: Tree,
  options: WikiSummaryGeneratorSchema
): Promise<void> {
  // Normalize a trailing slash so `${wikiFolder}/...` joins stay clean; the donor took the path
  // raw, but argv defaults and prompts can introduce a trailing slash.
  const wikiFolder = options.wikiFolder.replace(/\/+$/, '');

  const summary = generateDirectorySummary(tree, wikiFolder, '');

  // writeJson emits 2-space-indented JSON (matches the donor's JSON.stringify(summary, null, 2)).
  writeJson(tree, `${wikiFolder}/summary.json`, summary);

  if (!options.skipFormat) await formatFiles(tree);
}
