// House generator: write .claude/settings.json (marketplaces + autoUpdate + enabled plugins),
// ensure the .claude/data mount source exists, and keep Claude local state out of git.
import { type Tree } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function claudeSettingsGenerator(tree: Tree): Promise<void> {
  const settings = readFileSync(join(__dirname, 'settings.json.tpl'), 'utf8');
  tree.write('.claude/settings.json', settings);

  // Ensure the devcontainer bind-mount source (.claude/data) exists locally after scaffolding.
  if (!tree.exists('.claude/data/.gitkeep')) {
    tree.write('.claude/data/.gitkeep', '');
  }

  // Keep Claude Code local state out of git.
  const gitignore = tree.exists('.gitignore') ? (tree.read('.gitignore', 'utf8') ?? '') : '';
  if (!gitignore.includes('.claude/data/')) {
    const sep = gitignore === '' || gitignore.endsWith('\n') ? '' : '\n';
    tree.write('.gitignore', `${gitignore}${sep}\n# Claude Code local state\n.claude/data/\n`);
  }
}
