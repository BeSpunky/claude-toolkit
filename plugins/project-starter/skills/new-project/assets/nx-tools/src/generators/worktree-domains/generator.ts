// House generator: install the worktree-domains proxy + route registry into the workspace.
//
// The workspace-level sibling of the shared-browser tooling. It writes the worktree-domains CLI + its
// self-contained Node reverse proxy into tools/worktree-domains/, and registers them as a workspace Nx
// project (`worktree-domains`) exposing the housekeeping verbs as targets (list|reconcile|status|logs|stop).
//
// One tiny reverse proxy on 127.0.0.1:80 fronts every worktree's dev-server: a browser hitting
// `http://<slug>.localhost/` (Chromium auto-resolves any *.localhost to loopback — no DNS, no hosts file)
// lands on the proxy, which forwards to 127.0.0.1:<port> per the slug→port registry. So the main tree and
// each git worktree get a stable, human-readable domain instead of a shifted port that isn't forwarded.
// The proxy uses ONLY Node built-ins (http + net) and proxies WebSocket upgrades too, so HMR survives.
//
// Why workspace-level (not per-app): the proxy is a single workspace-wide resource shared by every app's
// serve. So it is generated ONCE per workspace, from scaffold.sh's WORKSPACE_GEN_BLOCK (always-on). The
// serve executor drives it per-serve via `bash tools/worktree-domains/worktree-domains register|unregister`.
//
// Idempotent + --repair-safe: every generator-owned file is rewritten on each run (the CLI, the proxy,
// and project.json carry no user values), so a fresh run and a --repair run converge to the same tree —
// exactly like the shared-browser generator re-asserts its always-owned tools/shared-browser/* files.
// formatFiles polishes the result at the end.
import { type Tree, formatFiles } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Workspace-level: no inputs today. Kept as a named type for parity with the sibling generators
// (and a place to grow options into) without tripping the no-empty-interface lint rule.
type WorktreeDomainsSchema = Record<string, never>;

export default async function worktreeDomainsGenerator(
  tree: Tree,
  _options: WorktreeDomainsSchema = {}
): Promise<void> {
  // Load a .tpl sibling of this generator (same idiom as the shared-browser / firebase-emulators
  // generators — the scaffold copies the whole nx-tools tree into node_modules before compiling the
  // .ts → .js, so the .tpl files travel alongside the compiled generator and __dirname resolves here).
  const template = (name: string) => readFileSync(join(__dirname, name), 'utf8');
  const root = 'tools/worktree-domains';

  // The CLI (bash) — the single entry point for register|unregister|list|reconcile|status|logs|stop.
  // Invoked as `bash tools/worktree-domains/worktree-domains <verb>` (so the exec bit isn't strictly
  // required), but set 0o755 anyway so `./worktree-domains` works directly from a shell too. It has no
  // file extension, so formatFiles/prettier leaves it (and its mode bit) untouched.
  tree.write(`${root}/worktree-domains`, template('worktree-domains.tpl'), { mode: 0o755 });

  // The self-contained Node reverse proxy the CLI spawns (Node built-ins only — no npm/apt dependency).
  tree.write(`${root}/proxy.mjs`, template('proxy.mjs.tpl'));

  // The workspace Nx project that surfaces the housekeeping verbs as targets (each runs the CLI verb).
  tree.write(`${root}/project.json`, template('project.json.tpl'));

  // Gitignore the runtime dir. By default WD_RUNTIME lives under ${XDG_RUNTIME_DIR:-/tmp} (outside the
  // repo) so nothing lands here — but a relocated WD_RUNTIME (e.g. into a workspace volume) would put
  // routes.json + logs under the repo. Ignore that path up front. Idempotent.
  const IGNORE_MARK = '/.worktree-domains';
  const existing = tree.exists('.gitignore') ? tree.read('.gitignore', 'utf8') ?? '' : '';
  if (!existing.includes(IGNORE_MARK)) {
    tree.write(
      '.gitignore',
      `${existing.trimEnd()}\n\n# worktree-domains runtime (routes.json / logs) when WD_RUNTIME is relocated into the workspace\n/.worktree-domains\n`
    );
  }

  await formatFiles(tree);
}
