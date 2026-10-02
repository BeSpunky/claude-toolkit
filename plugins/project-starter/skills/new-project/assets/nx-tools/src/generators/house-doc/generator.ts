// House generator: write the generated house docs + keep a bounded pointer to them in CLAUDE.md.
//
// TWO generated files, split by HOW THEY REACH THE MODEL — the distinction this generator exists to keep:
//   - HOUSE.rules.md — the DIRECTIVES (must hold on every change). IMPORTED by CLAUDE.md (`@HOUSE.rules.md`),
//     so it is in context every session. Small, and layer-gated so a project only carries the rules that can
//     apply to it: a markdown repo is not told how to redesign a UI or which port not to bind.
//   - HOUSE.md — the MECHANICAL HOW-TO (stack, generators, serving, Firebase, Nx). LINKED, read on demand.
//     Large, and the file the version stamp and the SessionStart hook live on.
// Getting a rule into the wrong one is not cosmetic: a directive in HOUSE.md is a directive nothing loads.
//
// The toolkit-owned conventions used to live inline in each project's CLAUDE.md — where they went STALE,
// because `scaffold.sh --sync` deliberately never rewrites the hand-owned CLAUDE.md. This generator owns
// them instead, in the two files above, and leaves only a small, marker-delimited POINTER in CLAUDE.md —
// the single part of an EXISTING CLAUDE.md it touches, so the rest stays the project's own. When there is
// no CLAUDE.md at all it seeds one, because a pointer with nowhere to live is how both generated files end
// up referenced by nothing.
//
// Idempotent + --sync-safe: both docs are fully rewritten every run; the pointer is upserted between its
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
import { nxInvocation } from '../_utils/nx-host';
import { type Tree, formatFiles } from '@nx/devkit';
import { retireInlineHouseSections } from '../_utils/inline-house-sections';
import { findDesignSystem } from '../_utils/design-system';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type LayerId } from '../../layers/registry';
import { activeLayers, docSections } from '../_utils/layer-contributions';
import { matchesEvidence } from '../../layers/evidence';
import { SERVE_EXECUTOR } from '../_utils/dev-server';
import { resolveWorkspaceLayout } from '../_utils/workspace-layout';
import { detectLinking } from '../_utils/linking';
import { houseProjectHome } from '../_utils/project-files';

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
  const active = activeLayers(tree, options.layers);
  const layers = active.map((entry) => entry.id);
  const firebase = options.firebase ?? layers.includes('firebase');
  // The package manager means something only where there is a package.json (the `node` layer); the sections
  // that name it are gated on that layer. It never falls back to a guess for a repo without one — that is how a
  // Python repo used to be told to run `yarn nx …`.
  const invocation = nxInvocation(tree, options.packageManager);
  const packageManager = invocation.packageManager ?? '';
  // HOW THIS REPO INVOKES NX — the one command every Nx line in the docs starts with. `./nx` on the wrapper
  // host (no package.json, or a repo already running the wrapper); the package manager's runner on a
  // package.json host. Rendering `{{PM}} nx` instead produced `npm nx` — not a command — on every npm project
  // and every wrapper-hosted repo.
  const nx = invocation.command;
  const nxTools = options.nxToolsVersion ?? UNKNOWN;
  const plugin = options.pluginVersion ?? UNKNOWN;
  const tpl = (name: string) => readFileSync(join(__dirname, name), 'utf8');

  // The section flags are the active layers' `docSections` (descriptor) — a layer's docs arrive with the layer.
  // `ui` is one of them, switched on by `web`, `angular` and `design-system` alike: "does something here run a
  // dev-server" (`web`) is a fact about the dev loop, not about whether this project has an interface to
  // design, and an Angular component library with no app is an ordinary shape that still gets the redesign
  // directive.
  //
  // `firebase` stays an explicit override as well, because it is the one section set a caller forces directly
  // (scaffold.sh --firebase renders the Firebase docs for a project that is about to become a Firebase project,
  // before firebase.json exists to detect).
  const flags: Record<string, boolean> = Object.fromEntries([...docSections(active)].map((flag) => [flag, true]));
  flags.firebase = firebase;
  // HOW THIS REPO SERVES — the other command the web docs are written around. The dev loop is the stack-free
  // engine (`tools/dev/dev serve`, reading `.bespunky/dev.json`); `nx serve <app>` is only its Nx face, and exists
  // only where the Nx adapter wired the house `serve` executor onto an app. Rendering `nx serve` unconditionally
  // told a Python repo (a hand-written declaration, no Nx app) to run a target it does not have — beside
  // `@angular/build` and 4200, which it has never heard of. Evidence, never a guess from the layer list.
  const nxServed = matchesEvidence(tree, { executors: [SERVE_EXECUTOR] });
  flags['nx-serve'] = nxServed;
  const serve = nxServed ? `${nx} serve` : 'tools/dev/dev serve';
  // WHERE THINGS LIVE, and HOW THEY REACH EACH OTHER — the two workspace facts every path and import in these docs
  // depends on. Both are DETECTED through the very resolvers the generators use (`resolveWorkspaceLayout`,
  // `detectLinking`), so the doc and the generators can never disagree. The docs used to say `apps/<app>` and
  // `libs/<lib-name>` outright, which was wrong for every workspace that keeps its projects under `packages/`
  // — and an agent copying a command out of HOUSE.md then generated into a directory the workspace doesn't use.
  const layout = resolveWorkspaceLayout(tree);
  const linking = detectLinking(tree);
  flags[`linking-${linking}`] = true;
  // One home for everything (`packages`) reads as one directory, not as "apps in X, libraries in X".
  flags['layout-shared'] = layout.appsDir === layout.libsDir;
  // The design system's REAL root, not a guess. HOUSE.md's whole job is telling a reader — human or
  // agent — where things are, and it hardcoded `packages/design-system`. Projects scaffolded before the
  // libs-dir inference learned to ignore `tools/` have theirs at `tools/design-system`, so the document
  // pointed at a directory that does not exist, and an agent following it either gives up or creates a
  // SECOND design system at the path the doc named. Resolved through the same tag-based lookup every
  // generator already trusts; before one exists, where the design-system generator would put it.
  const dsRoot = findDesignSystem(tree)?.root ?? `${layout.libsDir}/design-system`;
  // Cloud Functions' real home — found the way firebase-emulators finds it (an existing project wins over the
  // canonical `<appsDir>/functions`), so a project whose functions predate the layout model is described as it is.
  const functions = firebase ? houseProjectHome(tree, 'functions', `${layout.appsDir}/functions`) : undefined;
  const tokens: Record<string, string> = {
    DS_ROOT: dsRoot,
    PM: packageManager,
    SERVE: serve,
    NX: nx,
    APPS_DIR: layout.appsDir,
    LIBS_DIR: layout.libsDir,
    FUNCTIONS_ROOT: functions?.root ?? '',
    FUNCTIONS_PROJECT: functions?.name ?? '',
    LINKING: linking,
    NX_TOOLS_VERSION: nxTools,
    PLUGIN_VERSION: plugin,
    // The stamp's layer list. A RECORD of what was applied, never an input to a later decision — the sync
    // re-DETECTS. Its value is drift: a project whose workspace now has `firebase` but whose stamp doesn't
    // grew a layer that never got its house tooling, and that is a fact worth being able to see.
    LAYERS: layers.length ? layers.join(',') : 'none',
  };
  const render = (s: string) => renderTemplate(s, flags, tokens);

  // 1) The generated reference — rewritten every run (generator-owned; never hand-edited), carrying the
  //    stamp in its header. No timestamp anywhere: a stamp that changed on every sync would dirty the
  //    tree (and the git diff) even when the toolkit hadn't moved. Version identity is the whole question.
  tree.write('HOUSE.md', render(tpl('HOUSE.md.tpl')));

  // 2) The DIRECTIVES — the half that has to be in context whether or not anyone reads a link.
  //
  //    HOUSE.md is reached by a markdown link, and a link is only followed if the reader decides to follow
  //    it. Claude Code loads CLAUDE.md into every session and follows its `@path` IMPORTS; it does not load
  //    a file merely because CLAUDE.md mentions one. So for four releases the rules that say "non-negotiable"
  //    were sitting one un-taken hop outside the context that was supposed to be governed by them — present
  //    in the repo, absent from the session. Splitting them out is what lets the pointer IMPORT the rules
  //    (always on, and small) while still LINKING the mechanical how-to (on demand, and large): a single
  //    `@HOUSE.md` would have restored the rules at the cost of dragging every emulator recipe and port
  //    table into every session forever.
  tree.write('HOUSE.rules.md', render(tpl('HOUSE.rules.md.tpl')));

  // 3) The bounded pointer in CLAUDE.md — the ONLY part of CLAUDE.md this touches.
  //
  //    CLAUDE.md is SEEDED when absent rather than skipped. It used to be skipped, on the reasoning that a
  //    fresh scaffold writes CLAUDE.md from the skill's template and a sync therefore always finds one. That
  //    holds for the greenfield path and fails for the one this mode exists to serve: `--sync --ensure=agent`
  //    retrofits onto a repo of ANY shape, and an arbitrary repo need not have a CLAUDE.md at all. The result
  //    was the worst of the two failures above — HOUSE.md and HOUSE.rules.md written, and nothing anywhere
  //    referencing either. The seed is deliberately minimal (headings and prompts, no house prose): authoring
  //    the real, project-specific CLAUDE.md is still the new-project skill's job, and a seed that pretended
  //    otherwise would be a second source of truth for content this generator does not own.
  const seeded = tree.exists('CLAUDE.md') ? (tree.read('CLAUDE.md', 'utf8') ?? '') : render(tpl('CLAUDE.seed.md.tpl'));
  const pointer = render(tpl('pointer.md.tpl')).trim();
  const next = upsertPointer(seeded, pointer);
  if (!tree.exists('CLAUDE.md') || next !== tree.read('CLAUDE.md', 'utf8')) tree.write('CLAUDE.md', next);

  // 3b) Retire the FROZEN pre-0.5.0 house sections now inline in CLAUDE.md, if any remain.
  //
  //     ORDER IS THE WHOLE REASON THIS IS HERE. The retirement may only delete once a generated HOUSE.md
  //     exists — otherwise the inline copy is the only copy of that guidance. HOUSE.md is written a few
  //     lines above, so the precondition now holds by construction. A migration could never satisfy it: the
  //     ladder runs BEFORE the generators, so `retire-inline-house-sections` (0.25.0) could only ever refuse
  //     on a project that had no HOUSE.md yet — and by the time this generator gave it one, that migration
  //     was already below the project's floor and would never be collected again. The cleanup would have
  //     been stranded permanently, one release after the file it needed appeared.
  //
  //     That matters more now that this generator is no longer gated on the `agent` layer: every project
  //     gets HOUSE.rules.md imported into its CLAUDE.md, so any project still carrying the inline copy would
  //     otherwise hold the same directives in two voices, with nothing to say which is live.
  retireInlineHouseSections(tree);

  // 4) Keep the hook's SNOOZE file out of git. It records "this developer declined the sync for version
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
function renderTemplate(src: string, flags: Record<string, boolean>, tokens: Record<string, string>): string {
  // Collapse the blank-line runs a removed conditional block leaves behind — the same tidy the devcontainer
  // renderer does, and for the same reason: HOUSE.md is READ, by humans and by the agent, and a document
  // full of gaps where Angular or Firebase sections used to be reads as damaged rather than as tailored.
  //
  // Tokens are `{{UPPER_SNAKE}}`; block flags are `{{#lower-kebab}}`, so the two can never be confused. An
  // unknown token is left verbatim — visible in the rendered doc, and therefore fixable.
  return collapseBlankRuns(
    expandBlocks(src, flags).replace(/\{\{([A-Z_]+)\}\}/g, (match, token: string) => tokens[token] ?? match),
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
 *   - both markers present, OUTSIDE any foreign region → replace the entire old block (START…END) in place.
 *   - otherwise (absent, or sitting inside a foreign region from an earlier sync) → insert it right before the
 *     first `## ` heading that is outside every foreign region (prominent, deterministic), falling back to
 *     appending at the end.
 * `pointer` is the full rendered block, including both markers.
 *
 * A FOREIGN REGION is a block another tool owns and rewrites wholesale, delimited the same way this one is:
 * `<!-- <name> start -->` … `<!-- <name> end -->` — Nx's `<!-- nx configuration start-->` block in a
 * create-nx-workspace CLAUDE.md is the one met in practice. Its first `## ` heading sits INSIDE it, so "before
 * the first heading" put the pointer inside Nx's block, and `nx configure-ai-agents` (which the house tells
 * people to run) then deleted it — and with it the `@HOUSE.rules.md` import — until the next sync.
 */
function upsertPointer(source: string, pointer: string): string {
  const startIdx = source.indexOf(START);
  const endMarkerIdx = source.indexOf(END);
  if (startIdx !== -1 && endMarkerIdx !== -1 && endMarkerIdx > startIdx) {
    const before = source.slice(0, startIdx);
    const after = source.slice(endMarkerIdx + END.length);
    if (!insideForeignRegion(source, startIdx)) return `${before}${pointer}${after}`;
    // Inside someone else's block: take it out, then place it as if it were new.
    source = `${before.replace(/\n+$/, '\n')}${after.replace(/^\n+/, '\n')}`;
  }
  const heading = [...source.matchAll(/^## /gm)].find((match) => !insideForeignRegion(source, match.index!));
  if (heading) {
    return `${source.slice(0, heading.index)}${pointer}\n\n${source.slice(heading.index)}`;
  }
  return `${source.trimEnd()}\n\n${pointer}\n`;
}

/** Is `index` inside a region another tool owns (`<!-- X start -->` … `<!-- X end -->`)? */
function insideForeignRegion(source: string, index: number): boolean {
  for (const open of source.matchAll(/<!--\s*([^>]*?)\s*start\s*-->/gi)) {
    const name = open[1];
    if (name.startsWith('@bespunky/')) continue;
    const from = open.index! + open[0].length;
    const close = new RegExp(`<!--\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*end\\s*-->`, 'i').exec(source.slice(from));
    const to = close ? from + close.index + close[0].length : source.length;
    if (index >= open.index! && index < to) return true;
  }
  return false;
}

/** Squeeze runs of 3+ newlines (i.e. two or more consecutive blank lines) down to a single blank line. */
function collapseBlankRuns(markdown: string): string {
  return markdown.replace(/\n[ \t]*(\n[ \t]*){2,}/g, '\n\n');
}
