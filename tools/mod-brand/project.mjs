#!/usr/bin/env node
/**
 * Project the toolkit's MOD BRAND into every plugin that ships a mod — and keep the projections honest.
 *
 *   node tools/mod-brand/project.mjs           # check: every projection matches the source; exit 1 on drift
 *   node tools/mod-brand/project.mjs --write   # regenerate every projection, remove stale ones, then check
 *
 * ── WHY ────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Every toolkit mod must look like one family (tools/mod-brand/brand.tsx says what that means), but a plugin
 * cannot import another plugin's files: each one is installed, cached and loaded on its own. So the brand has
 * ONE source and each mod-shipping plugin carries a GENERATED copy at `hooks/_brand.tsx`, which its mods
 * import. A generated file that can drift is a second source of truth with extra steps; this is what stops
 * it drifting — the same arrangement as the layer registry and `assets/layers.sh`.
 *
 * WHICH PLUGINS. Derived, never listed: a plugin ships a mod exactly when its `hooks/hooks.json` names
 * `modules`. A plugin that stops shipping one has its projection removed by --write (and flagged by the
 * check), so no orphan copy lingers to be imported by mistake.
 *
 * ONE MARK. The check also refuses the brand glyph typed into any mod source outside its projection: a mod
 * that re-types the mark has forked the brand, whatever the projection says.
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '../..');
export const SOURCE = 'tools/mod-brand/brand.tsx';
export const PROJECTION = 'hooks/_brand.tsx';
const GLYPH = '✦';
const MOD_SOURCE = /\.(ts|tsx|mts|js|mjs)$/;

/** The projection's text: the source verbatim under a header naming where it comes from. */
export function projectionOf(source) {
  return (
    `// GENERATED from ${SOURCE} by \`node tools/mod-brand/project.mjs --write\` — DO NOT EDIT.\n` +
    `// Change the brand at its source; CI fails when this copy drifts from it.\n\n` +
    source
  );
}

/** Plugins under `root/plugins` whose hooks.json names modules, by directory name. */
export function modPlugins(root) {
  const plugins = join(root, 'plugins');
  if (!existsSync(plugins)) return [];

  return readdirSync(plugins, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(name => {
      const hooks = join(plugins, name, 'hooks/hooks.json');
      if (!existsSync(hooks)) return false;
      try {
        const modules = JSON.parse(readFileSync(hooks, 'utf8')).modules;
        return Array.isArray(modules) && modules.length > 0;
      } catch {
        // An unparsable hooks.json is another checker's finding; here it ships no mod we can reason about.
        return false;
      }
    })
    .sort();
}

/** Every disagreement between the source and the plugins under `root`; empty when all is in order. */
export function problems(root) {
  const found = [];
  const sourcePath = join(root, SOURCE);
  if (!existsSync(sourcePath)) return [`${SOURCE} is missing`];
  const want = projectionOf(readFileSync(sourcePath, 'utf8'));
  const mods = new Set(modPlugins(root));
  const pluginsDir = join(root, 'plugins');
  const all = existsSync(pluginsDir) ? readdirSync(pluginsDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) : [];

  for (const name of all.sort()) {
    const projection = join(pluginsDir, name, PROJECTION);
    const rel = relative(root, projection);
    if (mods.has(name)) {
      if (!existsSync(projection)) found.push(`${rel} is missing`);
      else if (readFileSync(projection, 'utf8') !== want) found.push(`${rel} has drifted from ${SOURCE}`);
      for (const file of hookSources(join(pluginsDir, name, 'hooks'))) {
        if (file !== projection && readFileSync(file, 'utf8').includes(GLYPH)) {
          found.push(`${relative(root, file)} types the brand glyph itself — import it from ./_brand.tsx`);
        }
      }
    } else if (existsSync(projection)) {
      found.push(`${rel} is stale: plugins/${name} ships no mod`);
    }
  }

  return found;
}

/** Regenerates every projection under `root` and removes the stale ones; returns the files it touched. */
export function write(root) {
  const want = projectionOf(readFileSync(join(root, SOURCE), 'utf8'));
  const mods = new Set(modPlugins(root));
  const touched = [];
  const pluginsDir = join(root, 'plugins');

  for (const d of readdirSync(pluginsDir, { withFileTypes: true }).filter(d => d.isDirectory())) {
    const projection = join(pluginsDir, d.name, PROJECTION);
    if (mods.has(d.name)) {
      if (!existsSync(projection) || readFileSync(projection, 'utf8') !== want) {
        writeFileSync(projection, want);
        touched.push(`wrote ${relative(root, projection)}`);
      }
    } else if (existsSync(projection)) {
      rmSync(projection);
      touched.push(`removed ${relative(root, projection)}`);
    }
  }

  return touched;
}

function hookSources(dir) {
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? hookSources(join(dir, d.name)) : MOD_SOURCE.test(d.name) ? [join(dir, d.name)] : [],
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg > 0 ? resolve(process.argv[rootArg + 1]) : REPO;
  if (process.argv.includes('--write')) {
    for (const line of write(root)) console.log(line);
  }
  const found = problems(root);
  if (found.length > 0) {
    console.error(`mod brand: ${found.length} problem(s)\n${found.map(p => `  ✗ ${p}`).join('\n')}`);
    console.error('\nRegenerate with: node tools/mod-brand/project.mjs --write');
    process.exit(1);
  }
  console.log(`mod brand: ${modPlugins(root).length} projection(s) match ${SOURCE}`);
}
