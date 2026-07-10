// House generator: write the generated HOUSE.md reference + keep a bounded pointer to it in CLAUDE.md.
//
// The toolkit-owned conventions (architecture directives, the branch/release workflow, serving,
// worktrees, Firebase, Nx, the shared browser) used to live inline in each project's CLAUDE.md — where
// they went STALE, because `scaffold.sh --repair` deliberately never rewrites the hand-owned CLAUDE.md.
// This generator moves them to HOUSE.md, a GENERATOR-OWNED reference rewritten on every run (so it always
// matches the installed @bespunky/nx-tools), and leaves only a small, marker-delimited POINTER in
// CLAUDE.md — the single part of CLAUDE.md it touches, so the rest stays the project's own.
//
// Idempotent + --repair-safe: HOUSE.md is fully rewritten every run; the pointer is upserted between its
// markers (inserted if absent, replaced/restored if present), so a hand-deleted or edited pointer heals.
import { type Tree, formatFiles } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface HouseDocSchema {
  // Render the Firebase sections. Default: auto-detect firebase.json at the workspace root.
  firebase?: boolean;
}

// The pointer block's bounds. START matches the opening marker's stable prefix (the marker line carries a
// human note after it); END is the exact closing marker. Everything from START to END is the owned block.
const START = '<!-- @bespunky/house-tooling:start';
const END = '<!-- @bespunky/house-tooling:end -->';

export default async function houseDocGenerator(
  tree: Tree,
  options: HouseDocSchema = {},
): Promise<void> {
  const firebase = options.firebase ?? tree.exists('firebase.json');
  const tpl = (name: string) => readFileSync(join(__dirname, name), 'utf8');
  const render = (s: string) => renderConditionals(s, firebase);

  // 1) The generated reference — rewritten every run (generator-owned; never hand-edited).
  tree.write('HOUSE.md', render(tpl('HOUSE.md.tpl')));

  // 2) The bounded pointer in CLAUDE.md — the ONLY part of CLAUDE.md this touches. Skip when CLAUDE.md
  //    doesn't exist yet (a fresh scaffold writes CLAUDE.md from the template, which already carries the
  //    pointer); on --repair CLAUDE.md exists and the pointer is inserted/regenerated.
  if (tree.exists('CLAUDE.md')) {
    const current = tree.read('CLAUDE.md', 'utf8') ?? '';
    const pointer = render(tpl('pointer.md.tpl')).trim();
    const next = upsertPointer(current, pointer);
    if (next !== current) tree.write('CLAUDE.md', next);
  }

  await formatFiles(tree);
}

/** Minimal mustache-subset renderer: {{#firebase}}…{{/firebase}}, {{^firebase}}…{{/firebase}}, {{TOOLKIT_STAMP}}. */
function renderConditionals(src: string, firebase: boolean): string {
  return src
    .replace(/\{\{#firebase\}\}([\s\S]*?)\{\{\/firebase\}\}/g, (_m, body) => (firebase ? body : ''))
    .replace(/\{\{\^firebase\}\}([\s\S]*?)\{\{\/firebase\}\}/g, (_m, body) => (firebase ? '' : body))
    .replace(/\{\{TOOLKIT_STAMP\}\}/g, 'nx-tools');
}

/**
 * Insert or replace the whole marker-delimited pointer block (markers included) in CLAUDE.md.
 *   - both markers present → replace the entire old block (START…END) with the new one (restore/regenerate).
 *   - markers absent       → insert the block right before the first `## ` heading (prominent, deterministic),
 *     falling back to appending at the end.
 * `pointer` is the full rendered block, including both markers.
 */
function upsertPointer(source: string, pointer: string): string {
  const startIdx = source.indexOf(START);
  const endMarkerIdx = source.indexOf(END);
  if (startIdx !== -1 && endMarkerIdx !== -1 && endMarkerIdx > startIdx) {
    const before = source.slice(0, startIdx);
    const after = source.slice(endMarkerIdx + END.length);
    return `${before}${pointer}${after}`;
  }
  const headingIdx = source.search(/^## /m);
  if (headingIdx !== -1) {
    return `${source.slice(0, headingIdx)}${pointer}\n\n${source.slice(headingIdx)}`;
  }
  return `${source.trimEnd()}\n\n${pointer}\n`;
}
