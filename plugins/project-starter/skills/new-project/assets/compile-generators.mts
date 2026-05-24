// Build bootstrap (TypeScript ESM): transpile @bespunky/nx-tools' TypeScript generators to JS so Nx can
// load them - Node refuses to strip types for files under node_modules, so a copied raw-TS plugin won't run.
// Transpile-only via the workspace's own TypeScript: no type-check, no extra dependencies.
// This file runs through Node's built-in type-stripping (it lives outside node_modules, where that is allowed).
// Usage (cwd = the Nx workspace root): node compile-generators.mts <plugin-dir>
import { readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const pluginDir: string | undefined = process.argv[2];
if (!pluginDir) {
  console.error('Usage: node compile-generators.mts <plugin-dir>');
  process.exit(1);
}

// Resolve the workspace's TypeScript (cwd is the workspace root when invoked from scaffold.sh).
const require = createRequire(join(process.cwd(), 'noop.js'));
const ts = require('typescript');

function compileDir(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      compileDir(p);
    } else if (p.endsWith('.ts')) {
      const { outputText } = ts.transpileModule(readFileSync(p, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
      });
      writeFileSync(p.replace(/\.ts$/, '.js'), outputText);
      rmSync(p); // leave only JS under node_modules so Nx never tries to strip types
    }
  }
}

compileDir(join(pluginDir, 'src'));
console.log('Compiled @bespunky/nx-tools TypeScript generators to JS.');
