// House generator: keep what the active layers' tooling creates out of git.
//
// A FLOOR CONCERN, run on every sync as the `nx` layer's workspace step. Each layer names the machine-local or
// generated paths its tooling makes necessary (`descriptor.gitignore`): Nx's caches and the upgrade's lock (`nx`),
// `node_modules` (`node`), `dist` (`js`, `firebase`), Claude Code's state (`agent`). Those blocks used to be
// written by `claude-settings` — the agent layer's generator — so an Nx app synced WITHOUT the agent layer never
// ignored `dist` or `.nx/workspace-data`, and its first build left an untracked tree behind. A layer's ignores
// belong to the layer, and the step that writes them belongs to the floor every run stands on.
//
// Additive and idempotent: an entry already mentioned is left alone, so a project that ignores these its own way
// is untouched.
import type { Tree } from '@nx/devkit';
import { activeLayers, gitignoreBlocks } from '../_utils/layer-contributions';

interface GitignoreSchema {
  /** The layers this run applies. Default: DETECTED from the workspace. */
  layers?: string[] | string;
}

export default async function gitignoreGenerator(tree: Tree, options: GitignoreSchema = {}): Promise<void> {
  for (const block of gitignoreBlocks(activeLayers(tree, options.layers))) {
    ensureIgnored(tree, `# ${block.heading}`, [...block.entries]);
  }
}

/**
 * Append any of `entries` that aren't already mentioned in `.gitignore`, under a single heading.
 *
 * Substring matching is deliberate and sufficient here: these are distinctive paths, and the question being
 * asked is "does this repo already deal with this?", not "is there an exactly-equal line". A repo that
 * ignores `.nx/` wholesale already covers `.nx/cache`, and re-adding it would be noise.
 */
function ensureIgnored(tree: Tree, heading: string, entries: string[]): void {
  const current = tree.exists('.gitignore') ? (tree.read('.gitignore', 'utf8') ?? '') : '';
  const missing = entries.filter((entry) => !current.includes(entry));

  const appended =
    missing.length === 0
      ? current
      : `${current}${current === '' || current.endsWith('\n') ? '' : '\n'}\n${heading}\n${missing.join('\n')}\n`;

  // Tidy the whole file, even on a run that appends NOTHING.
  //
  // `.gitignore` is written by several hands — `nx init` appends its own block with leading newlines, and
  // so does every generator that owns a rule here — and the result accumulates runs of blank lines that no
  // single author is responsible for. This layer owns .gitignore hygiene, so it normalises the file it
  // touches rather than only the lines it contributed; anything else leaves the mess for a human to notice.
  // Idempotent by construction: collapsing is a fixed point, so a second run rewrites nothing.
  const tidied = appended.replace(/\n{3,}/g, '\n\n');
  if (tidied !== current) tree.write('.gitignore', tidied);
}
