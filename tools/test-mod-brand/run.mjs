#!/usr/bin/env node
/**
 * Test the MOD BRAND projection — that the drift check catches what it exists to catch — and run it on this repo.
 *
 *   node tools/test-mod-brand/run.mjs
 *
 * tools/mod-brand/project.mjs keeps every plugin's `hooks/_brand.tsx` a byte-for-byte copy of the one brand
 * source. A drift check that silently passes is worse than none, so this pins each refusal against throwaway
 * fixture repos: a hand-edited projection, a missing one, an orphan in a plugin that ships no mod, and a mod
 * that re-types the brand glyph instead of importing it — then checks the real repo. Node only, no install.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PROJECTION, REPO, SOURCE, modPlugins, problems, projectionOf, write } from '../mod-brand/project.mjs';

let passed = 0;
let failed = 0;
const check = (name, fn) => {
  const root = mkdtempSync(join(tmpdir(), 'mod-brand-'));
  try {
    fn(root);
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}\n      ${error.message}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const put = (root, path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const BRAND = "export const BRAND = { glyph: '✦' }\n";

/** A repo with the brand source, two mod plugins (a, b) and one plain plugin (c). */
function fixture(root) {
  put(root, SOURCE, BRAND);
  put(root, 'plugins/a/hooks/hooks.json', JSON.stringify({ modules: ['./mod.ts'] }));
  put(root, 'plugins/a/hooks/mod.ts', "import { BRAND } from './_brand.tsx'\n");
  put(root, 'plugins/b/hooks/hooks.json', JSON.stringify({ modules: ['./band.tsx'], hooks: {} }));
  put(root, 'plugins/b/hooks/band.tsx', "import { BRAND } from './_brand.tsx'\n");
  put(root, 'plugins/c/hooks/hooks.json', JSON.stringify({ hooks: { SessionStart: [] } }));
}

console.log('mod brand projection');

check('only plugins whose hooks.json names modules are mod plugins', root => {
  fixture(root);
  assert(JSON.stringify(modPlugins(root)) === '["a","b"]', `got ${JSON.stringify(modPlugins(root))}`);
});

check('--write projects the source with a generated header, and the check then passes', root => {
  fixture(root);
  write(root);
  const projected = readFileSync(join(root, 'plugins/a', PROJECTION), 'utf8');
  assert(projected === projectionOf(BRAND), 'projection is not the source under its header');
  assert(projected.startsWith('// GENERATED') && projected.includes('DO NOT EDIT'), 'no generated header');
  assert(problems(root).length === 0, problems(root).join('; '));
});

check('a missing projection is drift', root => {
  fixture(root);
  write(root);
  rmSync(join(root, 'plugins/b', PROJECTION));
  assert(problems(root).some(p => p.includes('plugins/b/hooks/_brand.tsx is missing')), problems(root).join('; '));
});

check('a hand-edited projection is drift', root => {
  fixture(root);
  write(root);
  put(root, `plugins/a/${PROJECTION}`, projectionOf(BRAND).replace('✦', '*'));
  assert(problems(root).some(p => p.includes('has drifted')), problems(root).join('; '));
});

check('a source change not yet projected is drift', root => {
  fixture(root);
  write(root);
  put(root, SOURCE, `${BRAND}export const MORE = 1\n`);
  assert(problems(root).filter(p => p.includes('has drifted')).length === 2, problems(root).join('; '));
});

check('a projection in a plugin with no mod is stale, and --write removes it', root => {
  fixture(root);
  write(root);
  put(root, `plugins/c/${PROJECTION}`, projectionOf(BRAND));
  assert(problems(root).some(p => p.includes('stale')), problems(root).join('; '));
  write(root);
  assert(problems(root).length === 0, problems(root).join('; '));
});

check('a mod that types the brand glyph itself is refused', root => {
  fixture(root);
  write(root);
  put(root, 'plugins/a/hooks/mod.ts', "$.ui.status('✦ my own mark')\n");
  assert(problems(root).some(p => p.includes('plugins/a/hooks/mod.ts types the brand glyph')), problems(root).join('; '));
});

console.log('this repo');
const real = problems(REPO);
if (real.length === 0) {
  passed++;
  console.log(`  ✓ ${modPlugins(REPO).length} projection(s) match ${SOURCE}`);
} else {
  failed++;
  console.log(`  ✗ drift:\n${real.map(p => `      ${p}`).join('\n')}\n    regenerate: node tools/mod-brand/project.mjs --write`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
