// Build bootstrap (TypeScript ESM): transpile @bespunky/nx-tools' TypeScript generators to JS so Nx can
// load them - Node refuses to strip types for files under node_modules, so a copied raw-TS plugin won't run.
// Transpile-only via the workspace's own TypeScript: no type-check, no extra dependencies — but a file that does not
// PARSE fails the build. transpileModule emits best-effort JS for broken syntax and says nothing unless asked, so a
// syntax error in a branch no test reaches (an error message, a refusal) used to ship silently.
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

// Resolve the workspace's TypeScript (cwd is the workspace root when invoked from house.sh).
const require = createRequire(join(process.cwd(), 'noop.js'));
const ts = require('typescript');

const syntaxErrors: string[] = [];

function compileDir(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      compileDir(p);
    } else if (p.endsWith('.ts')) {
      const { outputText, diagnostics = [] } = ts.transpileModule(readFileSync(p, 'utf8'), {
        reportDiagnostics: true, // syntactic only — transpileModule never type-checks
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
      });
      for (const d of diagnostics) {
        const at = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
        syntaxErrors.push(`${p}${at ? `:${at.line + 1}:${at.character + 1}` : ''} — ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
      }
      writeFileSync(p.replace(/\.ts$/, '.js'), outputText);
      rmSync(p); // leave only JS under node_modules so Nx never tries to strip types
    }
  }
}

compileDir(join(pluginDir, 'src'));
if (syntaxErrors.length) {
  console.error(`@bespunky/nx-tools does not parse:\n${syntaxErrors.join('\n')}`);
  process.exit(1);
}
console.log('Compiled @bespunky/nx-tools TypeScript generators to JS.');
