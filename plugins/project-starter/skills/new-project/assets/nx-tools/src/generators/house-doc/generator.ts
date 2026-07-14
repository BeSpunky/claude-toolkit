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
//
// It also renders the STAMP into HOUSE.md's header — a marker line recording the @bespunky/nx-tools (and,
// for provenance, the plugin) version this project was last generated with. The stamp exists so that "is
// this project behind the installed toolkit?" is a FILE READ rather than a five-minute Docker run: it is
// what lets project-starter's SessionStart hook detect a toolkit upgrade and ask for a repair, instead of
// speculatively running one.
//
// WHY THE STAMP LIVES IN HOUSE.md, and not in a file of its own. The hook's whole premise is that the stamp
// reaches every clone, so it must be COMMITTED — which rules out `.claude/`, the conventional home for LOCAL
// Claude state (this project's own generators already gitignore `.claude/data/` and `.claude/skills/`), where
// one entirely reasonable `.gitignore` line would silently delete the stamp from every other checkout and
// leave the hook nagging forever with no way to fix it. HOUSE.md is the opposite: root-level, unambiguously
// committed, generator-owned, rewritten on every repair — and already the file the hook stats to decide
// whether this is even a house project. One file, one truth, no new gitignore surface.
import { type Tree, formatFiles } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface HouseDocSchema {
  // Render the Firebase sections. Default: auto-detect firebase.json at the workspace root.
  firebase?: boolean;
  // The @bespunky/nx-tools version whose generators are producing this project. Passed by scaffold.sh
  // (derived from the staged package.json — never hand-maintained). THIS is the version the hook compares:
  // it is what actually determines the generated output, so it is what a repair can actually change.
  nxToolsVersion?: string;
  // The bespunky-project-starter plugin version that shipped those generators. Recorded for provenance but
  // deliberately NOT what the hook compares — the house convention bumps a plugin's version on ANY change
  // (a SKILL.md typo, a README line), and demanding a multi-minute Docker repair for a change that
  // regenerates nothing would train everyone to ignore the notice.
  pluginVersion?: string;
}

// The pointer block's bounds. START matches the opening marker's stable prefix (the marker line carries a
// human note after it); END is the exact closing marker. Everything from START to END is the owned block.
const START = '<!-- @bespunky/house-tooling:start';
const END = '<!-- @bespunky/house-tooling:end -->';

// What an unknown version records as. A version is only unknown when a generator is invoked directly
// (`nx g …:house-doc`) rather than through scaffold.sh; the hook treats it as "can't compare" and — like a
// missing stamp on a house project — asks for a repair, which is exactly the action that fixes it.
const UNKNOWN = 'unknown';

export default async function houseDocGenerator(
  tree: Tree,
  options: HouseDocSchema = {},
): Promise<void> {
  const firebase = options.firebase ?? tree.exists('firebase.json');
  const nxTools = options.nxToolsVersion ?? UNKNOWN;
  const plugin = options.pluginVersion ?? UNKNOWN;
  const tpl = (name: string) => readFileSync(join(__dirname, name), 'utf8');
  const render = (s: string) => renderTemplate(s, firebase, nxTools, plugin);

  // 1) The generated reference — rewritten every run (generator-owned; never hand-edited), carrying the
  //    stamp in its header. No timestamp anywhere: a stamp that changed on every repair would dirty the
  //    tree (and the git diff) even when the toolkit hadn't moved. Version identity is the whole question.
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

  // 3) Keep the hook's SNOOZE file out of git. It records "this developer declined the repair for version
  //    X" — a per-person, per-machine decision, the exact opposite of the stamp: it must NOT travel to
  //    other clones, or one person's "not now" would silence the notice for the whole team.
  ignoreSnoozeFile(tree);

  await formatFiles(tree);
}

/** Minimal mustache-subset renderer: {{#firebase}}…{{/firebase}}, {{^firebase}}…{{/firebase}}, and the stamp tokens. */
function renderTemplate(
  src: string,
  firebase: boolean,
  nxToolsVersion: string,
  pluginVersion: string,
): string {
  return src
    .replace(/\{\{#firebase\}\}([\s\S]*?)\{\{\/firebase\}\}/g, (_m, body) => (firebase ? body : ''))
    .replace(/\{\{\^firebase\}\}([\s\S]*?)\{\{\/firebase\}\}/g, (_m, body) => (firebase ? '' : body))
    .replace(/\{\{NX_TOOLS_VERSION\}\}/g, nxToolsVersion)
    .replace(/\{\{PLUGIN_VERSION\}\}/g, pluginVersion);
}

/** Add the hook's local-only snooze file to .gitignore (idempotent). */
function ignoreSnoozeFile(tree: Tree): void {
  const entry = '.claude/house-snooze.json';
  const gitignore = tree.exists('.gitignore') ? (tree.read('.gitignore', 'utf8') ?? '') : '';
  if (gitignore.includes(entry)) return;

  const sep = gitignore === '' || gitignore.endsWith('\n') ? '' : '\n';
  tree.write(
    '.gitignore',
    `${gitignore}${sep}\n# Claude Code — this developer's "not now" on a house-tooling repair (local, never shared)\n${entry}\n`,
  );
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
