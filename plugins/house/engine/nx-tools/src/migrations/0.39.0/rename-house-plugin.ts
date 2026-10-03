// 0.39.0 — the `bespunky-project-starter` plugin is now `bespunky-house`: carry the project's enablement over.
//
// WHY. The plugin that ships these generators was renamed (it manages the HOUSE standard; "project-starter"
// named only its first job). A project enables it by key in `.claude/settings.json` `enabledPlugins`, and the
// `claude-settings` generator now contributes `bespunky-house@claude-toolkit` — but its merge PRESERVES every key
// it does not declare. So without this rung every existing project would keep `bespunky-project-starter` enabled
// forever beside the new one: two plugins, the old one a stub that only relays the rename.
//
// HOW. The KEY is renamed IN PLACE — its value (true, or a `false` the project chose) and its position, the
// file's formatting and anything else in it are kept: only the key string's own characters change. Where the
// new key already exists (a sync, or a hand-enable, got there first) the old entry is removed and the new one's
// value wins; if the two disagreed, that is said, because it means the project's earlier answer for the old
// plugin is not the one now in force.
//
// BOTH SETTINGS FILES. `.claude/settings.local.json` can carry the old key too (a developer enabled the plugin
// for themselves). It is gitignored and machine-local, so that half lands on this machine only — reported as
// such, the same caveat `0.30.2/namespace-seeded-output-style` states.
//
// WHAT IT LEAVES, AND SAYS SO. A settings file that cannot be parsed is left untouched and named. Machine state
// this rung cannot see — the plugin as installed in Claude Code's own registry, `~/.claude/settings.json` — is
// not the project's and is not touched (the post-create pre-install, regenerated from the layers, installs the
// new name on the next rebuild). The CLAUDE.md
// seed comment (`Seeded by … (project-starter <v>)`) is historical provenance in a file the project owns and
// is deliberately left as written.
import { type Tree, logger } from '@nx/devkit';
import { type ParseError, applyEdits, findNodeAtLocation, getNodeValue, modify, parseTree } from 'jsonc-parser';

const TAG = '[0.39.0 rename-house-plugin]';

const OLD_KEY = 'bespunky-project-starter@claude-toolkit';
const NEW_KEY = 'bespunky-house@claude-toolkit';

const SETTINGS = ['.claude/settings.json', '.claude/settings.local.json'];
const LOCAL = '.claude/settings.local.json';

const PARSE_OPTIONS = { allowTrailingComma: true, disallowComments: false };
const FORMAT = { insertSpaces: true, tabSize: 2, eol: '\n' };

export default async function renameHousePlugin(tree: Tree): Promise<void> {
  for (const path of SETTINGS) renameIn(tree, path);
}

function renameIn(tree: Tree, path: string): void {
  if (!tree.exists(path)) return;
  const text = tree.read(path, 'utf8') ?? '';
  // Cheap gate, and the idempotence: once renamed, the old key's spelling is nowhere in the file.
  if (!text.includes(OLD_KEY)) return;

  // jsonc-parser is fault-tolerant — it returns a tree for a truncated file — so its ERRORS decide, not the tree.
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, PARSE_OPTIONS);
  if (!root || root.type !== 'object' || errors.length > 0) {
    logger.warn(
      `${TAG} Left ${path} untouched — it could not be parsed, so its "${OLD_KEY}" was not renamed. ` +
        `Rename that enabledPlugins key to "${NEW_KEY}" by hand.`,
    );
    return;
  }

  const oldNode = findNodeAtLocation(root, ['enabledPlugins', OLD_KEY]);
  // The spelling appears, but not as an enabledPlugins key (a comment, a permission rule, some other setting):
  // not the shape this rung carries — say so rather than guess.
  if (!oldNode) {
    logger.info(
      `${TAG} ${path} mentions "${OLD_KEY}" outside enabledPlugins — left as is. The plugin is now "${NEW_KEY}"; ` +
        `update that reference if it is meant to name it.`,
    );
    return;
  }

  const newNode = findNodeAtLocation(root, ['enabledPlugins', NEW_KEY]);
  const local = path === LOCAL ? ' (machine-local and gitignored: this lands on this machine only)' : '';

  if (!newNode) {
    // The property node's first child is its key: rewrite exactly those characters.
    const keyNode = oldNode.parent!.children![0];
    tree.write(path, text.slice(0, keyNode.offset) + JSON.stringify(NEW_KEY) + text.slice(keyNode.offset + keyNode.length));
    logger.info(`${TAG} Renamed enabledPlugins "${OLD_KEY}" -> "${NEW_KEY}" in ${path}, value kept${local}.`);
    return;
  }

  const oldValue = getNodeValue(oldNode) as unknown;
  const newValue = getNodeValue(newNode) as unknown;
  tree.write(path, applyEdits(text, modify(text, ['enabledPlugins', OLD_KEY], undefined, { formattingOptions: FORMAT })));
  logger.info(
    `${TAG} Removed enabledPlugins "${OLD_KEY}" from ${path} — "${NEW_KEY}" was already there and its value ` +
      `(${JSON.stringify(newValue)}) stays${local}.` +
      (JSON.stringify(oldValue) !== JSON.stringify(newValue)
        ? ` Note: the old entry said ${JSON.stringify(oldValue)}; set "${NEW_KEY}" to that if it was the intended answer.`
        : ''),
  );
}
