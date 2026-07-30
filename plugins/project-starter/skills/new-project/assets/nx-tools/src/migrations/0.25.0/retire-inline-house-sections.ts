// MIGRATION 0.25.0 — delete the house sections that 0.5.0 copied out of CLAUDE.md and never removed, and
// retarget the references that 0.25.0's split just invalidated.
//
// THE ONE-WAY CHANGE THAT SHIPPED WITHOUT ITS CLEANUP. `5f51507` ("repairable HOUSE.md + bounded CLAUDE.md
// pointer") moved every toolkit-owned section — the architecture directives, the branch/release workflow,
// serving, Firebase, Nx, Playwright — out of the hand-owned CLAUDE.md and into a generated HOUSE.md. It wrote
// the new state. It did not remove the old one: `house-doc` upserts a marker-delimited pointer and touches
// nothing else in CLAUDE.md, by design. So every project scaffolded before that release still carries a full,
// FROZEN copy of the house guidance inline, sitting beside a HOUSE.md that supersedes it and is regenerated on
// every sync. Two sources of truth, one of which no longer moves.
//
// The plugin knew: `new-project/SKILL.md` has carried a "One-time migration only … remove the now-duplicated
// house sections by hand" note ever since. That note is the admission that this was a migration all along —
// it just predated the migration ladder (which only arrived at 0.24.0), so the work was handed to a human who
// had to read a line in a SKILL.md to know it was owed. This is that migration.
//
// WHY IT MATTERS MORE AT 0.25.0 THAN IT DID BEFORE. 0.25.0 splits the DIRECTIVES into HOUSE.rules.md and has
// CLAUDE.md `@`-IMPORT them, so they are finally in context every session. A pre-split project would then load
// the imported, current directives AND the inline, frozen ones — the same rules in two voices, differing by
// however many releases have passed, with nothing to tell a reader which is live. Stale guidance that is
// merely unread is inert; stale guidance loaded next to its own replacement is actively misleading.
//
// IT REFUSES TO RUN WITHOUT THE REPLACEMENT PRESENT. The whole justification for deleting inline guidance is
// that a generated copy supersedes it — so the migration first checks that HOUSE.md is actually there. It is
// not a formality. `house-doc` only runs when the `agent` layer is active, and that layer is detected SOLELY
// by the presence of HOUSE.md (`src/layers/registry.ts`); a plain `--sync` ensures no layers. So a project
// scaffolded before 0.5.0 and never synced since — inline sections, no HOUSE.md, but an old `@bespunky/nx-tools`
// still resolvable in node_modules, which is exactly how that era shipped it — would have had the ladder
// collect this migration, delete all thirteen sections, and then skip `house-doc` entirely. That is the one
// outcome worse than the duplication: the guidance deleted and nothing written in its place. Detect and
// report; never delete guidance this project has no other copy of.
//
// DELETION IS FINGERPRINTED, NOT NAME-MATCHED. `## Stack`, `## Firebase` and `## Common Commands` are names a
// project may perfectly well have written for itself, and removing someone's own prose because it shares a
// heading with ours would be the worst possible outcome here. So a section is removed only when its heading is
// one of ours AND its body still carries one of several LONG verbatim phrases from the text we shipped. The
// phrases were computed by set-cover over all 28 historical revisions of `assets/CLAUDE.md.tmpl`, so each
// section matches in every release that ever shipped it; they exclude mustache markers, which are resolved
// away in a real project's file and would therefore never match. A heading that matches on name but not on
// content is LEFT ALONE and REPORTED — the reader can then decide, which is the honest split of labour when
// the alternative is a guess about authorship.
//
// SELF-CONTAINED by the migration contract: the marker strings below are copies, not imports. They must keep
// matching `house-doc/generator.ts`, and they are stable — the START marker's prefix has not changed since it
// was introduced.
import { type Tree, logger } from '@nx/devkit';

const CLAUDE_MD = 'CLAUDE.md';
const HOUSE_MD = 'HOUSE.md';
const HOUSE_RULES_MD = 'HOUSE.rules.md';

/** The pointer block's bounds — mirrored from house-doc/generator.ts. */
const POINTER_START = '<!-- @bespunky/house-tooling:start';
const POINTER_END = '<!-- @bespunky/house-tooling:end -->';

/**
 * The sections 0.5.0 moved out, each with LONG verbatim phrases from the versions that shipped inline.
 *
 * A section matches when its heading matches AND **any one** of its phrases is present. Any-of rather than
 * all-of because the text was edited across releases: requiring every phrase would silently skip the older
 * projects that need this most, and requiring one 100-character verbatim sentence is already far past the
 * point where a project's own prose could collide with it.
 *
 * `Project Overview / Intentions` and `Conventions` are deliberately ABSENT — those sections are the
 * project's. (`Conventions` did ship with house-authored bullets, which is why REFERENCE RETARGETING below
 * exists: the bullets stay, but the pointer inside them is corrected rather than deleted.)
 */
const HOUSE_SECTIONS: ReadonlyArray<{ heading: string; phrases: readonly string[] }> = [
  {
    heading: 'Architect mentality',
    phrases: [
      'Approach every decision — at any scale, from a single function to the whole workspace — as a software architect.',
      'For the full mindset, think with the',
    ],
  },
  {
    heading: 'Architecture-first (non-negotiable)',
    phrases: [
      'if a correct redesign is genuinely large, surface it and its cost rather than patching silently.',
      'Coupling, duplication, and special-casing must never grow.',
    ],
  },
  {
    heading: 'Redesign means rethink',
    phrases: [
      'The existing implementation has **zero design authority**:',
      "do **not** read it to inform the new design, and don't even look at it before conceiving the new one.",
    ],
  },
  { heading: 'Stack', phrases: ['`.claude` is persisted across container rebuilds.'] },
  {
    heading: 'Serving the app',
    phrases: [
      "It auto-derives a **port offset** from the tree you're in",
      '- the **app dev-server** (the `dev-server` target → `@angular/build:dev-server`, host `0.0.0.0`), and',
    ],
  },
  {
    heading: 'Firebase',
    phrases: [
      '`firebase use --add` — picks a project from their account and writes `.firebaserc`.',
      '**Never fabricate `.firebaserc` or the production config**',
    ],
  },
  {
    heading: 'Branch & release workflow (non-negotiable)',
    phrases: [
      'This classification is a precondition for touching files, never a cleanup step;',
      '**The four branches** — work flows one way, `feature` → `development` → `staging` → `main`, each a strict ancestor of the next:',
    ],
  },
  {
    heading: 'Generator-first, manual last',
    phrases: [
      'never hand-create and fill files.** Before hand-writing anything structural, check what exists:',
      'For anything Nx can generate - apps, libraries, components, services, project config -',
    ],
  },
  { heading: 'Common Commands', phrases: ['yarn nx g @nx/angular:library libs/<lib-name>'] },
  {
    heading: 'Working with Nx',
    phrases: [
      '- For scaffolding (apps, libs, structure), invoke the `nx-generate` skill FIRST before exploring or calling MCP tools.',
      '- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`',
    ],
  },
  {
    heading: 'Angular AI tooling (MCP + agent skills)',
    phrases: [
      "The server's *experimental* exec tools (`build`, `devserver.*`, `test`, `e2e`) are deliberately **not** enabled:",
      '`get_best_practices`, `search_documentation`, `find_examples`, `ai_tutor`, and `onpush_zoneless_migration`.',
    ],
  },
  {
    heading: 'Playwright (available out of the box)',
    phrases: [
      'You can drive a real browser from a Bash script today — no `playwright install`, no apt step, no `sudo`.',
      'Use Playwright whenever you need to **observe** or **drive** the running app instead of reasoning about source:',
    ],
  },
  {
    heading: 'Local servers — never clobber a running server (non-negotiable)',
    phrases: [
      'Then open the app at the printed `?portOffset=N` URL.',
      '`tools/emulators.sh` **reaps existing emulator processes** on launch',
    ],
  },
];

/**
 * Sections that 0.25.0 moved from HOUSE.md into HOUSE.rules.md.
 *
 * The toolkit itself wrote `See \`HOUSE.md\` → **Design-system-first**.` into the hand-owned `## Conventions`
 * of every project scaffolded since `c1e8c33` — a file no generator regenerates. After the split that names a
 * section which is no longer in the file it names. "Retarget every reference to anything it moved" is the
 * repo's own rule, and a reference the toolkit authored is unambiguously the toolkit's to fix.
 */
const MOVED_TO_RULES = [
  'Architect mentality',
  'Architecture-first',
  'Redesign means rethink',
  'Design-system-first',
  'Branch & release workflow',
  'A feature is a package',
  'Generator-first',
  'Local servers',
];

export default function retireInlineHouseSections(tree: Tree): void {
  // No CLAUDE.md — nothing to clean. (`house-doc` seeds one later in this sync when the `agent` layer is
  // active; there is nothing for a migration to do about a file that does not exist yet.)
  if (!tree.exists(CLAUDE_MD)) return;

  const original = tree.read(CLAUDE_MD, 'utf8') ?? '';

  // The generated pointer block is masked out before anything else looks at the document. It contains its own
  // `## ` heading, the `@HOUSE.rules.md` import this whole release exists to install, and a legitimate
  // reference to HOUSE.md that the retargeting below must not rewrite.
  const { masked, restore, token } = maskPointerBlock(original);

  const sections = splitSections(masked);
  const removed: string[] = [];
  const keptButSuspicious: string[] = [];

  const surviving = sections.filter((section) => {
    const known = HOUSE_SECTIONS.find((entry) => entry.heading === section.heading);
    if (!known) return true;

    if (known.phrases.some((phrase) => section.body.includes(phrase))) {
      removed.push(section.heading);
      return false;
    }

    keptButSuspicious.push(section.heading);
    return true;
  });

  // REFUSE TO DELETE WITHOUT THE REPLACEMENT. See the header note: `house-doc` is gated on the `agent` layer,
  // which is detected by HOUSE.md alone, so "the generated copy supersedes this" is an assumption that has to
  // be checked rather than assumed. Reported, not silent — a project in this state genuinely needs a sync.
  if (removed.length > 0 && !tree.exists(HOUSE_MD)) {
    logger.warn(
      `[migrate 0.25.0] \`${CLAUDE_MD}\` still carries ${removed.length} inline house section(s) from before ` +
        `0.5.0, but this workspace has no \`${HOUSE_MD}\` — so they are the ONLY copy of that guidance and were ` +
        `LEFT IN PLACE. Run \`scaffold.sh --sync --ensure=agent .\` to generate \`${HOUSE_RULES_MD}\` + ` +
        `\`${HOUSE_MD}\`; re-running this migration afterwards will retire the inline copy.`
    );
    return;
  }

  let next = restore(surviving.map((section) => section.text).join(''));

  // If the pointer block sat INSIDE a section that was just removed, its mask token went with it and `restore`
  // was a no-op. Losing the block would strip the `@HOUSE.rules.md` import — the one thing this release
  // installs — so put it back rather than relying on `house-doc` to re-add it (which only happens when the
  // agent layer is active, and never on a bare `nx migrate --run-migrations`).
  const pointerBlock = extractPointerBlock(original);
  if (pointerBlock && !next.includes(POINTER_START)) {
    next = `${next.trimEnd()}\n\n${pointerBlock}\n`;
    logger.warn(
      `[migrate 0.25.0] The generated house pointer block sat inside an inline house section in ` +
        `\`${CLAUDE_MD}\`; the section was retired and the block re-appended at the end of the file. ` +
        `The next \`scaffold.sh --sync\` will move it back to its usual place above the first heading.`
    );
  }

  const retargeted = retargetMovedReferences(next, token);
  const didRetarget = retargeted !== next;
  next = retargeted;

  if (next !== original) tree.write(CLAUDE_MD, next);

  if (removed.length > 0) {
    logger.info(
      `[migrate 0.25.0] Removed ${removed.length} frozen house section(s) from \`${CLAUDE_MD}\` — ` +
        `${removed.map((h) => `"${h}"`).join(', ')}. They were copied there before 0.5.0 moved the house ` +
        `guidance into the generated \`${HOUSE_RULES_MD}\`/\`${HOUSE_MD}\`, and nothing has updated them ` +
        `since. Your own sections were left untouched.`
    );
  }

  if (didRetarget) {
    logger.info(
      `[migrate 0.25.0] Retargeted reference(s) in \`${CLAUDE_MD}\` from \`${HOUSE_MD}\` to ` +
        `\`${HOUSE_RULES_MD}\` — the directive sections they name moved there in 0.25.0, so that CLAUDE.md ` +
        `can import them into every session.`
    );
  }

  // Report, never guess. A heading of ours whose body no longer looks like ours is either a project's own
  // section that happens to share the name, or a house section someone rewrote — and those two need opposite
  // treatment. Naming it is the most useful thing that can be said without knowing which.
  if (keptButSuspicious.length > 0) {
    logger.warn(
      `[migrate 0.25.0] \`${CLAUDE_MD}\` has ${keptButSuspicious.length} section(s) whose heading matches a ` +
        `house section but whose text does not — ${keptButSuspicious.map((h) => `"${h}"`).join(', ')}. They ` +
        `were LEFT IN PLACE, because a section that has been rewritten is indistinguishable from one you ` +
        `wrote yourself. If it is a leftover copy of house guidance, delete it: the live versions are the ` +
        `generated \`${HOUSE_RULES_MD}\` (imported into context) and \`${HOUSE_MD}\`.`
    );
  }
}

/** The whole pointer block (markers included), or null when the document has none. */
function extractPointerBlock(source: string): string | null {
  const start = source.indexOf(POINTER_START);
  const end = source.indexOf(POINTER_END);
  if (start === -1 || end === -1 || end < start) return null;
  return source.slice(start, end + POINTER_END.length);
}

/**
 * Replace the generated pointer block with an opaque placeholder, and hand back the inverse.
 *
 * A placeholder rather than a split-and-rejoin so the block keeps its exact position in the document: it may
 * legitimately sit before, between, or after the sections being filtered, and a project that moved it is not
 * doing anything wrong.
 *
 * The token is wrapped in NUL characters — written as `\u0000` escapes so they are visible in this source and
 * survive a reformat — because markdown cannot contain a NUL, which makes the placeholder impossible for a
 * document to forge or contain by accident. The restore uses a replacer FUNCTION so that `$&`, `` $` `` and
 * friends inside the restored block are inserted literally rather than interpreted by `String.replace`.
 */
function maskPointerBlock(source: string): {
  masked: string;
  restore: (s: string) => string;
  token: string;
} {
  const token = '\u0000bespunky-house-pointer\u0000';
  const block = extractPointerBlock(source);
  if (block === null) return { masked: source, restore: (s) => s, token };

  const start = source.indexOf(POINTER_START);
  return {
    masked: `${source.slice(0, start)}${token}${source.slice(start + block.length)}`,
    restore: (s) => s.replace(token, () => block),
    token,
  };
}

/**
 * Point a toolkit-authored `HOUSE.md → **Section**` reference at HOUSE.rules.md, for the sections that moved.
 *
 * Deliberately narrow: only a filename immediately followed by an arrow and one of the moved section names is
 * rewritten. A bare mention of HOUSE.md stays — the file still exists and is still the right target for the
 * mechanical how-to, so a blanket rename would break more references than it fixed.
 */
function retargetMovedReferences(source: string, token: string): string {
  const names = MOVED_TO_RULES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`\`HOUSE\\.md\`(\\s*(?:→|->)\\s*\\*\\*(?:${names}))`, 'g');
  // Never touch the masked pointer block: it is regenerated wholesale and its HOUSE.md link is correct.
  return source
    .split(token)
    .map((part) => part.replace(pattern, '`HOUSE.rules.md`$1'))
    .join(token);
}

interface Section {
  /** The heading text, without the leading `## `. `''` for the preamble before the first heading. */
  heading: string;
  /** The section's content, excluding its heading line. */
  body: string;
  /** Heading line + body — what goes back into the document if the section survives. */
  text: string;
}

/**
 * Split a markdown document on its level-2 headings.
 *
 * FENCE-AWARE on purpose, and precisely so. The house sections are full of bash blocks, and a `#`-comment at
 * the start of a fenced line is not a heading — `## Common Commands` in particular is almost entirely fenced
 * shell. But naive fence tracking is worse than none: toggling on any line that merely STARTS with three
 * backticks flips parity on an ordinary inline code span at the start of a line (```` ```yarn nx serve``` ````),
 * after which every later `##` is invisible, the current section swallows the rest of the document, and
 * deleting it takes the project's own sections with it — while the log cheerfully reports that they were left
 * untouched. So this follows CommonMark: an opening fence's info string may not contain a backtick, and a
 * closing fence must be the same character, at least as long, and carry nothing else on the line.
 */
function splitSections(source: string): Section[] {
  const lines = source.split('\n');
  const sections: Section[] = [{ heading: '', body: '', text: '' }];
  let fence: { char: string; length: number } | null = null;

  for (const line of lines) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      const [, delimiter, info] = fenceMatch;
      const char = delimiter[0];
      if (fence === null) {
        // A backtick fence's info string may not contain a backtick — that is what makes `` ```code``` `` an
        // inline span rather than an opening fence.
        if (!(char === '`' && info.includes('`'))) fence = { char, length: delimiter.length };
      } else if (char === fence.char && delimiter.length >= fence.length && info.trim() === '') {
        fence = null;
      }
    }

    // `\r` joins the trailing-whitespace class so a CRLF checkout — ordinary on Windows — does not
    // capture headings as `Stack\r`, which matches nothing in HOUSE_SECTIONS and silently spares every
    // house section on those clones.
    const heading = fence === null ? /^##[ \t]+(.+?)[ \t\r]*$/.exec(line) : null;
    if (heading) {
      sections.push({ heading: heading[1], body: '', text: `${line}\n` });
      continue;
    }

    const current = sections[sections.length - 1];
    current.body += `${line}\n`;
    current.text += `${line}\n`;
  }

  // `split('\n')` on a trailing newline yields a final empty element, which the loop turns into an extra
  // "\n". Trimming it here keeps a rejoin from growing the file by a blank line on every run.
  const last = sections[sections.length - 1];
  if (last.text.endsWith('\n\n')) {
    last.text = last.text.slice(0, -1);
    last.body = last.body.slice(0, -1);
  }
  return sections;
}
