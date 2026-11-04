// GITIGNORE — the floor's blocks. `.pnpm-store/` is there because of a mount, not a package manager choice: the repo
// and $HOME are separate mounts in a house container, so ANY `pnpm install` from a subfolder of the repo (a worktree
// under .claude/worktrees included) puts pnpm's store at the top of the repo, yarn and npm projects included.
import { workspace } from '../workspaces.mjs';

export default {
  name: 'gitignore · the floor ignores what its tooling leaves behind',
  cases: ((run) => [
    {
      name: 'the Nx floor alone ignores the pnpm store',
      setup: () => workspace(),
      run,
      expect: (tree, t) => t.has('.gitignore', '\n.pnpm-store\n'),
    },
    {
      name: 'a project already ignoring the pnpm store is left alone',
      setup: () => {
        const tree = workspace();
        tree.write('.gitignore', '/.pnpm-store\n');
        return tree;
      },
      run,
      expect: (tree, t) => {
        const lines = t.read('.gitignore').split('\n');
        t.equal(lines.filter((l) => l.includes('.pnpm-store')), ['/.pnpm-store'], 'the existing line stands, unrepeated');
      },
    },
  ])(async (tree, ctx) => {
    await ctx.load('generators/gitignore/generator').default(tree, { layers: 'nx' });
  }),
};
