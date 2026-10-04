// 0.43.0 — the claude-code devcontainer feature goes from EVERY house devcontainer, owned or not.
//
// WHY. 0.40.0 (retire-claude-code-feature) removed `ghcr.io/devcontainers-extra/features/claude-code` only from a
// devcontainer the house OWNS, and reported it in an adopted one: "the project may since have come to rely on
// it". That was the wrong test. The rule against deleting a project's line exists because something may still
// DEPEND on it — and nothing can depend on this one any more: the agent layer installs the same Claude Code
// natively in post-create and puts it first on PATH. The feature's only remaining effect is a stale second copy
// behind the real one — the very copy that caused the frozen-version bug. So it is SUPERSEDED by a capability the
// house guarantees, not a guess about the project's intent, and it goes regardless of who wrote the line (in this
// toolkit's own repo a human did, before the house adopted the file).
//
// THE GUARANTEE IS THE CONDITION. Only where the agent layer is present — the layer whose post-create installs
// Claude Code natively — is the feature superseded. Without it, the feature may be the project's only Claude
// Code, and it stays.
//
// WHAT IT TAKES WITH IT: the member, its comma, and the `//` lines directly above it (they explain a line that is
// gone) — and the feature's pin in devcontainer-lock.json (through the shared `removeFeature`; the first release of
// this rung forgot the lock, and 0.44.0 prunes what that left). Everything else is untouched.
import { type Tree, logger } from '@nx/devkit';
import { parseJsoncStrict } from '../../generators/_utils/jsonc-strict';
import { isPresent } from '../../layers/registry';
import { removeFeature } from '../../generators/_utils/devcontainer-feature';

const TAG = '[0.43.0 remove-superseded-claude-code-feature]';
const DEVCONTAINER = '.devcontainer/devcontainer.json';
const FEATURE = 'ghcr.io/devcontainers-extra/features/claude-code';

export default async function removeSupersededClaudeCodeFeature(tree: Tree): Promise<void> {
  if (!tree.exists(DEVCONTAINER)) return;
  const original = tree.read(DEVCONTAINER, 'utf8') ?? '';
  if (!original.includes(FEATURE)) return;

  if (!isPresent(tree, 'agent')) {
    logger.info(
      `${TAG} Left in place — ${DEVCONTAINER} declares "${FEATURE}", but this workspace does not wear the agent layer, ` +
        `so nothing else installs Claude Code here: the feature may be its only copy.`,
    );
    return;
  }

  const root = parseJsoncStrict(original);
  if (!root) {
    logger.warn(
      `${TAG} Left in place — ${DEVCONTAINER} could not be parsed as JSONC. Remove its "${FEATURE}" feature by hand: the ` +
        `house post-create installs Claude Code natively, and the feature only adds a stale second copy.`,
    );
    return;
  }
  const removed = removeFeature(tree, FEATURE);
  if (!removed.declaration && !removed.lock) return;
  logger.info(
    `${TAG} removed the "${FEATURE}" feature from ${[removed.declaration && DEVCONTAINER, removed.lock && '.devcontainer/devcontainer-lock.json'].filter(Boolean).join(' and ')} — ` +
      `superseded by the native Claude Code the house post-create installs (first on PATH); it only added a stale ` +
      `second copy in /usr/local/bin. Rebuild the container.`,
  );
}
