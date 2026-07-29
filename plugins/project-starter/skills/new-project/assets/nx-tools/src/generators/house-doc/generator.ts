// House generator: write the generated HOUSE.md reference + keep a bounded pointer to it in CLAUDE.md.
//
// The toolkit-owned conventions (architecture directives, the branch/release workflow, serving,
// worktrees, Firebase, Nx, the shared browser) used to live inline in each project's CLAUDE.md — where
// they went STALE, because `scaffold.sh --sync` deliberately never rewrites the hand-owned CLAUDE.md.
// This generator moves them to HOUSE.md, a GENERATOR-OWNED reference rewritten on every run (so it always
// matches the installed @bespunky/nx-tools), and leaves only a small, marker-delimited POINTER in
// CLAUDE.md — the single part of CLAUDE.md it touches, so the rest stays the project's own.
//
// Idempotent + --sync-safe: HOUSE.md is fully rewritten every run; the pointer is upserted between its
// markers (inserted if absent, replaced/restored if present), so a hand-deleted or edited pointer heals.
//
// It also renders the STAMP into HOUSE.md's header — a marker line recording the @bespunky/nx-tools (and,
// for provenance, the plugin) version this project was last generated with. The stamp exists so that "is
// this project behind the installed toolkit?" is a FILE READ rather than a five-minute Docker run: it is
// what lets project-starter's SessionStart hook detect a toolkit upgrade and ask for a sync, instead of
// speculatively running one.
//
// WHY THE STAMP LIVES IN HOUSE.md, and not in a file of its own. The hook's whole premise is that the stamp
// reaches every clone, so it must be COMMITTED — which rules out `.claude/`, the conventional home for LOCAL
// Claude state (this project's own generators already gitignore `.claude/data/` and `.claude/skills/`), where
// one entirely reasonable `.gitignore` line would silently delete the stamp from every other checkout and
// leave the hook nagging forever with no way to fix it. HOUSE.md is the opposite: root-level, unambiguously
// committed, generator-owned, rewritten on every sync — and already the file the hook stats to decide
// whether this is even a house project. One file, one truth, no new gitignore surface.
import { type Tree, formatFiles } from '@nx/devkit';
import { findDesignSystem } from '../_utils/design-system';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectLayers, type LayerId } from '../../layers/registry';

interface HouseDocSchema {
  // Render the Firebase sections. Default: auto-detect firebase.json at the workspace root.
  firebase?: boolean;
  // The layers this project has. Default: DETECTED from the workspace. Drives which sections render (a
  // non-Angular project has no business reading the Angular MCP section) and is recorded in the stamp.
  layers?: LayerId[];
  // The package manager this project uses (yarn | npm | pnpm). Passed by scaffold.sh, which DETECTS it
  // from the project's own lockfile. HOUSE.md is the doc the agent reads and copies commands out of, so
  // `yarn nx build` in an npm project is not a cosmetic mismatch — it is a command that fails.
  packageManager?: string;
  // The @bespunky/nx-tools version whose generators are producing this project. Passed by scaffold.sh
  // (derived from the staged package.json — never hand-maintained). THIS is the version the hook compares:
  // it is what actually determines the generated output, so it is what a sync can actually change.
  nxToolsVersion?: string;
  // The bespunky-project-starter plugin version that shipped those generators. Recorded for provenance but
  // deliberately NOT what the hook compares — the house convention bumps a plugin's version on ANY change
  // (a SKILL.md typo, a README line), and demanding a multi-minute sync for a change that
  // regenerates nothing would train everyone to ignore the notice.
  pluginVersion?: string;
}

// The pointer block's bounds. START matches the opening marker's stable prefix (the marker line carries a
// human note after it); END is the exact closing marker. Everything from START to END is the owned block.
const START = '<!-- @bespunky/house-tooling:start';
const END = '<!-- @bespunky/house-tooling:end -->';

// What an unknown version records as. A version is only unknown when a generator is invoked directly
// (`nx g …:house-doc`) rather than through scaffold.sh; the hook treats it as "can't compare" and — like a
// missing stamp on a house project — asks for a sync, which is exactly the action that fixes it.
const UNKNOWN = 'unknown';

export default async function houseDocGenerator(
  tree: Tree,
  options: HouseDocSchema = {},
): Promise<void> {
  // DETECTED by default, never declared — the same rule the layer registry states for itself. A caller may
  // pass layers explicitly (scaffold.sh knows what it just ensured, before the tree reflects it), but a
  // direct `nx g …:house-doc` reads the workspace, so HOUSE.md can't describe a project that isn't there.
  const layers = options.layers ?? detectLayers(tree);
  const firebase = options.firebase ?? layers.includes('firebase');
  const packageManager = options.packageManager ?? detectPackageManager(tree);
  const nxTools = options.nxToolsVersion ?? UNKNOWN;
  const plugin = options.pluginVersion ?? UNKNOWN;
  const tpl = (name: string) => readFileSync(join(__dirname, name), 'utf8');

  // `firebase` stays an explicit flag rather than folding into `layers`, because it is the one section set a
  // caller overrides directly (scaffold.sh --firebase renders the Firebase docs for a project that is about
  // to become a Firebase project, before firebase.json exists to detect).
  const flags: Record<string, boolean> = Object.fromEntries([
    ...layers.map((id) => [id, true]),
    ['firebase', firebase],
  ]);
  // The design system's REAL root, not a guess. HOUSE.md's whole job is telling a reader — human or
  // agent — where things are, and it hardcoded `packages/design-system`. Projects scaffolded before the
  // libs-dir inference learned to ignore `tools/` have theirs at `tools/design-system`, so the document
  // pointed at a directory that does not exist, and an agent following it either gives up or creates a
  // SECOND design system at the path the doc named. Resolved through the same tag-based lookup every
  // generator already trusts, so the doc and the generators can never disagree.
  const dsRoot = findDesignSystem(tree)?.root ?? 'packages/design-system';
  const render = (s: string) => renderTemplate(s, flags, nxTools, plugin, layers, packageManager, dsRoot);

  // 1) The generated reference — rewritten every run (generator-owned; never hand-edited), carrying the
  //    stamp in its header. No timestamp anywhere: a stamp that changed on every sync would dirty the
  //    tree (and the git diff) even when the toolkit hadn't moved. Version identity is the whole question.
  tree.write('HOUSE.md', render(tpl('HOUSE.md.tpl')));

  // 2) The bounded pointer in CLAUDE.md — the ONLY part of CLAUDE.md this touches. Skip when CLAUDE.md
  //    doesn't exist yet (a fresh scaffold writes CLAUDE.md from the template, which already carries the
  //    pointer); on --sync CLAUDE.md exists and the pointer is inserted/regenerated.
  if (tree.exists('CLAUDE.md')) {
    const current = tree.read('CLAUDE.md', 'utf8') ?? '';
    const pointer = render(tpl('pointer.md.tpl')).trim();
    const next = upsertPointer(current, pointer);
    if (next !== current) tree.write('CLAUDE.md', next);
  }

  // 3) Keep the hook's SNOOZE file out of git. It records "this developer declined the sync for version
  //    X" — a per-person, per-machine decision, the exact opposite of the stamp: it must NOT travel to
  //    other clones, or one person's "not now" would silence the notice for the whole team.
  ignoreSnoozeFile(tree);

  await formatFiles(tree);
}

/**
 * Minimal mustache-subset renderer: {{#flag}}…{{/flag}}, {{^flag}}…{{/flag}}, and the stamp tokens.
 *
 * The flag set is now every LAYER plus `firebase`, not the single hard-coded `firebase` it started as. That
 * generalization is the whole point: a HOUSE.md that documents the Angular MCP server, the design-system
 * SASS API and the shared browser to a plain TypeScript library is not merely noisy — it is instructions to
 * use tooling the project does not have, aimed at a reader (human or model) with no way to tell.
 *
 * An UNKNOWN flag renders as false, which is the safe direction: a section guarded by a typo'd flag
 * disappears (visible, fixable) rather than appearing in every project regardless of shape.
 */
function renderTemplate(
  src: string,
  flags: Record<string, boolean>,
  nxToolsVersion: string,
  pluginVersion: string,
  layers: readonly string[],
  packageManager: string,
  dsRoot: string,
): string {
  // Collapse the blank-line runs a removed conditional block leaves behind — the same tidy the devcontainer
  // renderer does, and for the same reason: HOUSE.md is READ, by humans and by the agent, and a document
  // full of gaps where Angular or Firebase sections used to be reads as damaged rather than as tailored.
  return collapseBlankRuns(
    expandBlocks(src, flags)
    .replace(/\{\{DS_ROOT\}\}/g, dsRoot)
    .replace(/\{\{PM\}\}/g, packageManager)
    .replace(/\{\{NX_TOOLS_VERSION\}\}/g, nxToolsVersion)
    .replace(/\{\{PLUGIN_VERSION\}\}/g, pluginVersion)
    // The stamp's layer list. A RECORD of what was applied, never an input to a later decision — the sync
    // re-DETECTS. Its value is drift: a project whose workspace now has `firebase` but whose stamp doesn't
    // grew a layer that never got its house tooling, and that is a fact worth being able to see.
    .replace(/\{\{LAYERS\}\}/g, layers.length ? layers.join(',') : 'none'),
  );
}

/**
 * Expand {{#flag}}/{{^flag}} blocks until none remain.
 *
 * A single `String.replace` pass is NOT enough once blocks NEST — and they do the moment a layer section
 * contains a Firebase aside. `replace` consumes the outer match and continues AFTER it, so the tags inside a
 * kept body are never looked at again and ship verbatim into HOUSE.md. Iterating to a fixed point is what
 * makes `{{#web}}…{{#firebase}}…{{/firebase}}…{{/web}}` mean what it reads like.
 *
 * The backreference in the pattern (`\{\{\/\1\}\}`) is what keeps an outer block from ending on an inner
 * block's closing tag. The iteration bound is a guard against a malformed template, not an expected path.
 */
function expandBlocks(src: string, flags: Record<string, boolean>): string {
  const POSITIVE = /\{\{#([\w-]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
  const NEGATIVE = /\{\{\^([\w-]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;

  let out = src;
  for (let pass = 0; pass < 10; pass++) {
    const next = out
      .replace(POSITIVE, (_m, flag: string, body: string) => (flags[flag] ? body : ''))
      .replace(NEGATIVE, (_m, flag: string, body: string) => (flags[flag] ? '' : body));
    if (next === out) return out;
    out = next;
  }
  return out;
}

/** Add the hook's local-only snooze file to .gitignore (idempotent). */
function ignoreSnoozeFile(tree: Tree): void {
  const entry = '.claude/house-snooze.json';
  const gitignore = tree.exists('.gitignore') ? (tree.read('.gitignore', 'utf8') ?? '') : '';
  if (gitignore.includes(entry)) return;

  const sep = gitignore === '' || gitignore.endsWith('\n') ? '' : '\n';
  tree.write(
    '.gitignore',
    `${gitignore}${sep}\n# Claude Code — this developer's "not now" on a house-tooling sync (local, never shared)\n${entry}\n`,
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

/**
 * The project's package manager, from its own lockfile.
 *
 * Same evidence and same precedence scaffold.sh uses, so the doc can't disagree with the tool that wrote
 * it. Defaults to the house standard only when the project genuinely declares nothing.
 */
/**
 * ONE precedence rule, shared with scaffold.sh's `detect_package_manager` and the generated post-create.sh.
 *
 * The `packageManager` field wins because it is the only signal a human deliberately WROTE; every other one
 * is an artifact, and artifacts are exactly what a stray lockfile leaves behind. This used to read neither
 * the field nor `yarn.lock`, so a yarn workspace that happened to carry a package-lock.json got a HOUSE.md
 * full of `npm` commands while the sync and the container both ran yarn — the document disagreeing with the
 * tooling it documents.
 */
function detectPackageManager(tree: Tree): string {
  const declared = /"packageManager"\s*:\s*"(yarn|npm|pnpm)@/.exec(tree.read('package.json', 'utf8') ?? '')?.[1];
  if (declared) return declared;

  if (tree.exists('pnpm-lock.yaml')) return 'pnpm';
  if (tree.exists('yarn.lock')) return 'yarn';
  if (tree.exists('package-lock.json')) return 'npm';
  return 'yarn';
}

/** Squeeze runs of 3+ newlines (i.e. two or more consecutive blank lines) down to a single blank line. */
function collapseBlankRuns(markdown: string): string {
  return markdown.replace(/\n[ \t]*(\n[ \t]*){2,}/g, '\n\n');
}
