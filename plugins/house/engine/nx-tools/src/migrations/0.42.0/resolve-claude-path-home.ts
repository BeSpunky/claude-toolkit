// 0.42.0 — the native Claude Code PATH entry names the home directory itself, not `${containerEnv:HOME}`.
//
// WHY. 0.40.0 put `${containerEnv:HOME}/.local/bin` first in `remoteEnv.PATH` (the generator from 0.40.0, and the
// 0.40.0 rung retire-claude-code-feature), so the copy of Claude Code that `claude update` keeps current would
// win. But a container's environment carries no HOME — it is set per user at login — so the variable resolved
// EMPTY and the entry came out as `/.local/bin`: a directory that does not exist, and the build-time copy in
// /usr/local/bin kept winning. Found on the first rebuild of a container that carried it.
//
// WHY A MIGRATION. The generator now writes the resolved home (`{{home}}/.local/bin` → `/home/<user>/.local/bin`)
// and re-asserts it in an OWNED devcontainer — but an ADOPTED one keeps the project's value for a key both
// declare, so the broken entry would stay there forever.
//
// WHAT IT DOES. Only a PATH whose first entry is literally `${containerEnv:HOME}/.local/bin` is touched — no
// project writes that; the house did, in 0.40.0 and 0.41.0 — and only that entry is rewritten, in place, to
// `<home>/.local/bin` for the user the devcontainer declares (`remoteUser`, else `containerUser`). A
// devcontainer that declares neither gives no user to resolve: reported, left as is.
import { type Tree, logger } from '@nx/devkit';
import { parseJsoncStrict } from '../../generators/_utils/jsonc-strict';
import { applyEdits, findNodeAtLocation, getNodeValue, modify } from 'jsonc-parser';
import { homeOf } from '../../generators/devcontainer/compose';

const TAG = '[0.42.0 resolve-claude-path-home]';
const DEVCONTAINER = '.devcontainer/devcontainer.json';
const BROKEN = '${containerEnv:HOME}/.local/bin';

const FORMAT = { insertSpaces: true, tabSize: 2, eol: '\n' };

export default async function resolveClaudePathHome(tree: Tree): Promise<void> {
  if (!tree.exists(DEVCONTAINER)) return;
  const original = tree.read(DEVCONTAINER, 'utf8') ?? '';
  if (!original.includes(BROKEN)) return;

  const root = parseJsoncStrict(original);
  if (!root) {
    logger.warn(
      `${TAG} Left in place — ${DEVCONTAINER} mentions "${BROKEN}" but could not be parsed as JSONC. If remoteEnv.PATH ` +
        `starts with it, replace it with "/home/<user>/.local/bin" (or "/root/.local/bin") for the user the container runs as.`,
    );
    return;
  }
  const pathNode = findNodeAtLocation(root, ['remoteEnv', 'PATH']);
  const value = pathNode ? (getNodeValue(pathNode) as unknown) : undefined;
  // Compared as a PREFIX, never by splitting on `:` — the broken entry carries a colon of its own
  // (`${containerEnv:HOME}`), and so does every `${…}` variable after it.
  if (typeof value !== 'string' || !(value === BROKEN || value.startsWith(`${BROKEN}:`))) return;

  const declared = ['remoteUser', 'containerUser']
    .map((key) => (findNodeAtLocation(root, [key]) ? getNodeValue(findNodeAtLocation(root, [key])!) : undefined))
    .find((user): user is string => typeof user === 'string' && user.length > 0);
  if (!declared) {
    logger.warn(
      `${TAG} Left in place — ${DEVCONTAINER} remoteEnv.PATH starts with "${BROKEN}", which resolves to "/.local/bin" ` +
        `(a container's environment has no HOME), but the file declares no remoteUser or containerUser to resolve ` +
        `the home from. Replace it with "/home/<user>/.local/bin" (or "/root/.local/bin") for the user the container runs as.`,
    );
    return;
  }

  const fixed = `${homeOf(declared)}/.local/bin${value.slice(BROKEN.length)}`;
  tree.write(DEVCONTAINER, applyEdits(original, modify(original, ['remoteEnv', 'PATH'], fixed, { formattingOptions: FORMAT })));
  logger.info(
    `${TAG} ${DEVCONTAINER}: remoteEnv.PATH now starts with ${homeOf(declared)}/.local/bin — "${BROKEN}" resolved ` +
      `to "/.local/bin", so the native Claude Code never came first. Rebuild the container to apply it.`,
  );
}
