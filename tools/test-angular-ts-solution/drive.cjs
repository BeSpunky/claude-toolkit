// The tripwire's generator half (see run.sh): drive the COMPILED house Angular adapter against the real workspace at
// cwd, through Nx's own FsTree — exactly how the house generators reach @nx/angular — then flush to disk.
//
//   node drive.cjs <compiled-payload-dir>
//
// It asserts what can only be true if the opt-out still works AND is still scoped: the workspace is detected as
// `workspaces`-linked, both projects are created, and NX_IGNORE_UNSUPPORTED_TS_SETUP is exactly as it was before.
'use strict';
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');

const payload = process.argv[2];
if (!payload) throw new Error('usage: node drive.cjs <compiled-payload-dir>');

// Resolved from the WORKSPACE (cwd), never from this repo: these are the versions under test.
const fromWorkspace = (id) => require(require.resolve(id, { paths: [process.cwd()] }));
const { FsTree, flushChanges } = fromWorkspace('nx/src/generators/tree');
const { readJson, getProjects } = fromWorkspace('@nx/devkit');
const { angular } = require(join(payload, 'src/adapters/angular'));
const { detectLinking, workspaceLinking } = require(join(payload, 'src/generators/_utils/linking'));

const APP_ROOT = 'apps/shop';
const LIB_ROOT = 'packages/ui';

(async () => {
  const tree = new FsTree(process.cwd(), false);
  assert.equal(detectLinking(tree), 'workspaces', 'create-nx-workspace --preset=ts no longer produces what detectLinking calls a TS-solution workspace');

  const scope = readJson(tree, 'package.json').name.replace(/^@/, '').split('/')[0];
  const importPath = `@${scope}/ui`;
  const envBefore = process.env.NX_IGNORE_UNSUPPORTED_TS_SETUP;

  const app = await angular.apps.create(tree, { directory: APP_ROOT, style: 'scss' });
  await angular.libs.create(tree, { name: 'ui', directory: LIB_ROOT, importPath, publishable: true, prefix: 'bs', style: 'scss' });
  angular.libs.normalizePackaging?.(tree, LIB_ROOT);
  assert.equal(process.env.NX_IGNORE_UNSUPPORTED_TS_SETUP, envBefore, 'the opt-out leaked out of the adapter call');

  // The app consumes the library the workspace's way (what design-system-styles does for the design system).
  workspaceLinking(tree).link(tree, { importPath, libRoot: LIB_ROOT, consumerRoot: APP_ROOT });

  // A real import across the link, reachable from the app's entry — so typecheck AND the bundler must resolve it.
  tree.write(`${LIB_ROOT}/src/lib/greeting.ts`, "export const GREETING = 'hello across the workspace link';\n");
  tree.write(`${LIB_ROOT}/src/index.ts`, `${tree.read(`${LIB_ROOT}/src/index.ts`, 'utf8') ?? ''}export * from './lib/greeting';\n`);
  tree.write(`${APP_ROOT}/src/main.ts`, `import { GREETING } from '${importPath}';\nconsole.log(GREETING);\n${tree.read(`${APP_ROOT}/src/main.ts`, 'utf8')}`);

  const roots = [...getProjects(tree).values()].map((p) => p.root);
  assert.ok(roots.includes(APP_ROOT) && roots.includes(LIB_ROOT), `projects not created: ${roots.join(', ')}`);

  flushChanges(process.cwd(), tree.listChanges());
  writeFileSync('.tripwire-app-root', APP_ROOT);
  console.log(`created app ${app.project} (${APP_ROOT}) and library ${importPath} (${LIB_ROOT}), linked`);
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
