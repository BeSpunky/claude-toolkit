# Description limits — decision

**What:** every plugin description cut to ≤ 500 characters and every skill description to ≤ 1024 with no `<` `>` — the limits Claude Desktop (claude.ai) enforces when it stores them; Claude Code reads the full text, which is why nothing here noticed (48 violations).

**How it stays fixed:**
- `tools/check-descriptions/check.mjs` (node builtins only), in CI (`release-invariants.yml`) and the pre-push hook.
- The marketplace entry's `description` is now **derived** from `plugin.json` by `nx release` (it used to be a separate, richer hand-written pitch — under the cap they became the same text, and two hand-kept copies of one string drift), and `check-release-invariants` fails if they disagree.

**How the triggers were rewritten:** lead with what the skill is and when it fires, keep neighbour boundaries, drop the how; anything the body did not already say was moved into it (When-to-use sections in window-identity, delegate-and-parallelize, feature-package, project-standing, design-system-first). An adversarial trigger review (research/trigger-review.md) found one real regression (typed-reactive-navigation lost navigation middleware), one blurred boundary (stage-the-vision's visual-system parts) and three minor losses — all restored.

**Released:** a patch of all 11 plugins.
