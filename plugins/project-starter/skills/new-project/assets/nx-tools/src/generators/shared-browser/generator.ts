// House generator: install the always-on shared, co-driven browser tooling into the workspace.
//
// The workspace-level sibling of firebase-emulators' tooling. It writes the shared-browser CLI +
// its Node (CDP) helpers into tools/shared-browser/, and registers them as a workspace Nx project
// (`shared-browser`) exposing the lifecycle verbs as targets (up|down|status|restart|clean|url|logs).
//
// The shared browser is ONE headed Chromium on a virtual display (Xvfb), co-driven by a human over
// noVNC (:6080 — the only forwarded port) and by an agent over CDP (:9223, loopback), so a change
// can be verified live in the same browser both watch. Full design: docs/shared-browser-DESIGN.md.
//
// Why workspace-level (not per-app): the shared browser is a single workspace-wide resource, not an
// app concern — every app's `serve-with-shared-browser` target (wired per-app by the `app` generator)
// drives this same browser. So it is generated ONCE per workspace, from scaffold.sh's
// WORKSPACE_GEN_BLOCK (unconditional in both the scaffold and the --repair path — it's always-on).
//
// Idempotent + --repair-safe: every generator-owned file is rewritten on each run (the CLI, the three
// helpers, and project.json carry no user values), so a fresh run and a --repair run converge to the
// same tree — exactly like firebase-emulators re-asserts its always-owned tools/*.sh scripts.
// formatFiles polishes the result at the end.
import { type Tree, formatFiles } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Workspace-level: no inputs today. Kept as a named type for parity with the sibling generators
// (and a place to grow options into) without tripping the no-empty-interface lint rule.
type SharedBrowserSchema = Record<string, never>;

export default async function sharedBrowserGenerator(
  tree: Tree,
  _options: SharedBrowserSchema = {}
): Promise<void> {
  // Load a .tpl sibling of this generator. The scaffold copies the whole nx-tools tree into
  // node_modules before compiling the .ts → .js, so the .tpl files travel alongside the compiled
  // generator and __dirname resolves to the dir that contains them (same idiom as firebase-emulators).
  const template = (name: string) => readFileSync(join(__dirname, name), 'utf8');
  const root = 'tools/shared-browser';

  // The CLI (bash) — the single entry point for up|down|status|restart|clean|url|logs|navigate.
  // Invoked as `bash tools/shared-browser/shared-browser <verb>` (so the exec bit isn't strictly
  // required), but set 0o755 anyway so `./shared-browser` works directly from a shell too. It has no
  // file extension, so formatFiles/prettier leaves it (and its mode bit) untouched.
  tree.write(`${root}/shared-browser`, template('shared-browser.tpl'), { mode: 0o755 });

  // The Node ESM helpers the CLI + agents import over CDP: attach/detach lifecycle, the live-verify
  // toolkit, and the long-lived event recorder. Authored by their own .tpl files (not this generator).
  tree.write(`${root}/attach.mjs`, template('attach.mjs.tpl'));
  tree.write(`${root}/verify.mjs`, template('verify.mjs.tpl'));
  tree.write(`${root}/recorder.mjs`, template('recorder.mjs.tpl'));

  // The workspace Nx project that surfaces the lifecycle verbs as targets (each runs the CLI verb).
  tree.write(`${root}/project.json`, template('project.json.tpl'));

  // Gitignore the runtime dir. By default SB_RUNTIME lives under ${XDG_RUNTIME_DIR:-/tmp} (outside
  // the repo) so nothing lands here — but the capability documents relocating SB_RUNTIME into a
  // workspace volume to persist a signed-in profile, at which point profile/logs/screenshots become
  // committable (and events.jsonl's redaction is best-effort). Ignore that path up front. Idempotent.
  const IGNORE_MARK = '/.shared-browser';
  const existing = tree.exists('.gitignore') ? tree.read('.gitignore', 'utf8') ?? '' : '';
  if (!existing.includes(IGNORE_MARK)) {
    tree.write(
      '.gitignore',
      `${existing.trimEnd()}\n\n# shared-browser runtime (profile / logs / screenshots) when SB_RUNTIME is relocated into the workspace\n/.shared-browser\n`
    );
  }

  await formatFiles(tree);
}
