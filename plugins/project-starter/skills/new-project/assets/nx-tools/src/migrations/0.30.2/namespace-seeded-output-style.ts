// 0.30.2 — repoint the seeded `outputStyle` at the style's real id, `bespunky-communication:Pitch to the
// listener`. Until now the seed wrote the bare name, which resolves to NOTHING.
//
// WHY THE BARE NAME IS DEAD, not merely imprecise. Claude Code builds one registry of output styles keyed by
// id and then looks the setting up by exact key — there is no fall-back match on a style's display name. A
// style that arrives from a PLUGIN is registered under `${plugin}:${name}`; only the built-ins and a project's
// or user's own `output-styles/` files are keyed by their bare name. `Pitch to the listener` ships inside the
// `bespunky-communication` plugin, so its only id is the namespaced one, and a settings file asking for the
// bare name matches nothing and silently falls back to no style at all.
//
// That is why this is a migration and not just a corrected seed. `outputStyle` is a SEEDED key (see the
// claude-settings generator): written only where the project has no value of its own, and never re-asserted,
// precisely so a consumer who picked a different style is never overruled by a sync. Correct — and it also
// means the broken value can never heal on its own. Every project scaffolded or synced since 0.28.0 holds a
// dead `outputStyle` that no later sync will ever touch.
//
// SCOPED TO THE EXACT OLD VALUE, which is what keeps this from overruling anybody. The only string rewritten
// is the literal the seed wrote; any other value — another style, a custom one, an empty string — is the
// project's own answer and is left untouched. And the rewrite is not a change of preference: it names the same
// style the project already asked for, at the id that actually resolves.
//
// WHERE THE REWRITE WOULD BE A GUESS, IT REPORTS INSTEAD. A project that has its own
// `.claude/output-styles/` file named `Pitch to the listener` — a copy taken to edit, say — is a project for
// which the bare name is CORRECT and resolves to that local file. Repointing it at the plugin would silently
// swap the style out from under them, so those are left alone and named in the log. The same caveat cannot be
// checked for a style installed at `~/.claude/output-styles/`, which is machine state this migration cannot
// see; that possibility is stated in the report rather than guessed at.
//
// BOTH SETTINGS FILES, because both can carry the dead value and neither heals. `.claude/settings.local.json`
// is machine-local and gitignored, so a fix there lands on this machine only and shows up in no diff — which
// is exactly why it is reported explicitly instead of being quietly corrected.
import { type Tree, logger } from '@nx/devkit';

/** The literal the 0.28.0–0.30.1 seed wrote. Nothing else is rewritten. */
const DEAD_VALUE = 'Pitch to the listener';

/** The style's real id: plugin name, then the `name:` from its frontmatter. */
const REAL_ID = 'bespunky-communication:Pitch to the listener';

const SETTINGS = ['.claude/settings.json', '.claude/settings.local.json'];
const LOCAL_STYLES = '.claude/output-styles';

type Json = Record<string, unknown>;

export default async function namespaceSeededOutputStyle(tree: Tree): Promise<void> {
  const carriers = SETTINGS.filter((path) => readJson(tree, path)?.['outputStyle'] === DEAD_VALUE);

  // Nothing asks for the dead value — a project below 0.28.0 (never seeded), one already repointed, or one
  // that chose its own style. Idempotent: re-running the ladder finds nothing a second time.
  if (carriers.length === 0) return;

  // A local style of the same name makes the bare value CORRECT. Not ours to repoint — report and stop.
  if (hasLocalStyleNamed(tree, DEAD_VALUE)) {
    logger.info(
      `[namespace-seeded-output-style] Left '${DEAD_VALUE}' alone in ${carriers.join(', ')} — this project ` +
        `has its own ${LOCAL_STYLES}/ style by that name, which the bare value correctly resolves to. To use ` +
        `the plugin's copy instead, set outputStyle to '${REAL_ID}'.`,
    );
    return;
  }

  for (const path of carriers) {
    const settings = readJson(tree, path) as Json;
    tree.write(path, `${JSON.stringify({ ...settings, outputStyle: REAL_ID }, null, 2)}\n`);
  }

  const local = carriers.includes('.claude/settings.local.json');

  logger.info(
    `[namespace-seeded-output-style] Repointed outputStyle '${DEAD_VALUE}' -> '${REAL_ID}' in ` +
      `${carriers.join(', ')}. The bare name matched no registered style, so the house output style was ` +
      `never actually active; it applies from the next session.` +
      (local
        ? ` Note: .claude/settings.local.json is gitignored and machine-local — that half of the fix lands on ` +
          `this machine only, and each other machine picks it up when it runs this migration.`
        : '') +
      ` If a style named '${DEAD_VALUE}' is installed at ~/.claude/output-styles/, this repoints away from it;` +
      ` set outputStyle back to the bare name to keep it.`,
  );
}

/** Does the project ship its own output style whose effective name is `name`? */
function hasLocalStyleNamed(tree: Tree, name: string): boolean {
  if (!tree.exists(LOCAL_STYLES)) return false;

  return tree
    .children(LOCAL_STYLES)
    .filter((child) => child.endsWith('.md'))
    .some((child) => styleName(tree, `${LOCAL_STYLES}/${child}`) === name);
}

/**
 * A style file's effective name: its frontmatter `name:`, else its basename — the same rule Claude Code
 * applies when it registers one.
 */
function styleName(tree: Tree, path: string): string {
  const text = tree.read(path, 'utf8') ?? '';
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  const declared = /^name:[ \t]*(.+?)[ \t]*$/m.exec(frontmatter)?.[1];

  return declared ?? path.slice(path.lastIndexOf('/') + 1, -'.md'.length);
}

/** Parse a settings file; missing or unparseable yields `undefined` — nothing this migration can act on. */
function readJson(tree: Tree, path: string): Json | undefined {
  if (!tree.exists(path)) return undefined;

  try {
    const parsed: unknown = JSON.parse(tree.read(path, 'utf8') ?? '');
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
