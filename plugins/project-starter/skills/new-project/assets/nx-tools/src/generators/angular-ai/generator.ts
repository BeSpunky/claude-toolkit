// House generator: wire Angular's official AI tooling into the project.
//
// Two layers, by their nature:
//   1) The Angular CLI MCP server — declared in project-scoped `.mcp.json` at the
//      workspace root (committed, team-shared). Run via `npx -y @angular/cli mcp`, so
//      it is ALWAYS the latest CLI with zero version pinning to maintain. We enable
//      only the DEFAULT (knowledge) tools — get_best_practices, search_documentation,
//      find_examples, ai_tutor, onpush_zoneless_migration — which are workspace-agnostic
//      and always work. The experimental exec tools (build, devserver.*, test, e2e) are
//      deliberately NOT enabled: this is an integrated Nx workspace with no root
//      angular.json, so those tools (which read angular.json and shell out to `ng build`)
//      can't function and would only push agents away from Nx-owned targets. Build/serve/
//      test verification belongs to Nx + the Playwright skill, not the Angular CLI.
//   2) The Angular agent skills (angular-developer, angular-new-app) — NOT written here.
//      They are fetched FRESH from github.com/angular/skills into `.claude/skills/` on
//      every container build by .devcontainer/post-create.sh (auto-detected via
//      @angular/core), so they track upstream Angular with no vendored fork to resync.
//      This generator only keeps that fetched cache out of git.
//
// Idempotent and a good citizen: the `angular-cli` server key is generator-owned and
// merged into any existing `.mcp.json` so user-added MCP servers are preserved across
// re-runs (--repair).
import { type Tree } from '@nx/devkit';

const SERVER_KEY = 'angular-cli';
const ANGULAR_CLI_SERVER = {
  command: 'npx',
  // Default (knowledge) tools only. To add the experimental exec tools later you would
  // append e.g. `-E`, `build` — but see the note above: they don't fit an Nx workspace.
  args: ['-y', '@angular/cli', 'mcp'],
};

interface McpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

export default async function angularAiGenerator(tree: Tree): Promise<void> {
  // 1) Merge the angular-cli MCP server into project-scoped .mcp.json (preserve user servers).
  let config: McpConfig = {};
  if (tree.exists('.mcp.json')) {
    const raw = tree.read('.mcp.json', 'utf8') ?? '';
    if (raw.trim()) {
      try {
        config = JSON.parse(raw) as McpConfig;
      } catch {
        // Unparseable .mcp.json (hand-edited into invalid JSON) — start clean rather than
        // throw; the generator owns the angular-cli server and a fresh file is recoverable.
        config = {};
      }
    }
  }
  config.mcpServers ??= {};
  config.mcpServers[SERVER_KEY] = ANGULAR_CLI_SERVER;
  tree.write('.mcp.json', JSON.stringify(config, null, 2) + '\n');

  // 2) Keep the build-time-fetched Angular agent skills out of git (refreshable cache).
  const gitignore = tree.exists('.gitignore') ? (tree.read('.gitignore', 'utf8') ?? '') : '';
  if (!gitignore.includes('.claude/skills/')) {
    const sep = gitignore === '' || gitignore.endsWith('\n') ? '' : '\n';
    tree.write(
      '.gitignore',
      `${gitignore}${sep}\n# Angular agent skills — fetched fresh from upstream at container build\n.claude/skills/\n`
    );
  }
}
