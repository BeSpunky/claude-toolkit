#!/usr/bin/env node
// =============================================================================
//  extract-tool — the cross-workspace step of reusable-tool extraction.
//
//  Runs on the HOST (where both the source project and the shared @bespunky
//  workspace are visible). It is deliberately NOT an Nx generator: an Nx
//  generator operates on a single workspace's Tree, but ~/projects is a flat
//  set of isolated workspaces with nothing spanning them, so the move
//  "read one workspace, write another" cannot be a generator (see
//  docs/reusable-tool-extraction.md §2.1).
//
//  It DOES invoke the shared workspace's own Nx generator (as a subprocess,
//  cwd = shared workspace) to scaffold the publishable package shell — then
//  copies the source in and sets the package.json. Publishing itself stays the
//  shared workspace's existing `nx release` (run by a human afterwards).
//
//  Usage:
//    node extract-tool.mjs --from <project-path> [--into <shared-ws>] [--lib <name>]
//                          [--scope @bespunky] [--dry-run] [--no-scaffold] [--force]
//
//  Produces a DRAFT package for human review. After running it:
//    1. review the package in the shared workspace (esp. peerDependencies + version),
//    2. `nx release` in the shared workspace to publish to npm,
//    3. `nx g @bespunky/nx-tools:adopt-extracted` back in the project.
// =============================================================================
import { existsSync, readFileSync, writeFileSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { execSync } from 'node:child_process';

// ---- args ----
function parseArgs(argv) {
  const a = { into: `${process.env.HOME}/projects/bespunky`, scope: '@bespunky' };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--dry-run') a.dryRun = true;
    else if (t === '--no-scaffold') a.noScaffold = true;
    else if (t === '--force') a.force = true;
    else if (t.startsWith('--')) a[t.slice(2)] = argv[++i];
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const log = (...m) => console.log(...m);
const die = (m) => { console.error('✖ ' + m); process.exit(1); };

if (!args.from) die('--from <project-path> is required.');
const projectRoot = args.from.replace(/\/+$/, '');
const sharedRoot = args.into.replace(/\/+$/, '');
if (!existsSync(projectRoot)) die(`source project not found: ${projectRoot}`);
if (!existsSync(sharedRoot)) die(`shared workspace not found: ${sharedRoot}`);

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

// ---- discover candidates: every extraction.json with status 'candidate' ----
function findMarkers(dir, found = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git' || name === '.nx') continue;
    const full = join(dir, name);
    let s; try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) findMarkers(full, found);
    else if (name === 'extraction.json') found.push(full);
  }
  return found;
}

const markerPaths = findMarkers(projectRoot)
  .map((p) => ({ path: p, marker: readJson(p) }))
  .filter(({ marker }) => (args.force ? true : marker.status === 'candidate'))
  .filter(({ marker }) => (args.lib ? marker.sourceLib === args.lib : true));

if (markerPaths.length === 0) die('no extraction candidates found (status "candidate"). Nothing to do.');

log(`Found ${markerPaths.length} candidate(s) in ${basename(projectRoot)}:\n`);

// ---- versioning (decision #2) ----
const majorOf = (range) => {
  const m = String(range || '').match(/(\d+)\./);
  return m ? m[1] : null;
};
function initialVersion(marker) {
  // Framework-coupled (Angular libs) track the framework major: 0.<ngMajor>.0
  // (mirrors the existing @bespunky/angular-google-maps@0.<ng>.0 convention).
  const ngMajor = majorOf(marker.frameworkVersions?.['@angular/core']);
  if (marker.kind === 'angular' && ngMajor) return `0.${ngMajor}.0`;
  return '0.0.1'; // non-framework libs: plain semver from the start
}
function pinPeerDeps(marker) {
  // Best-effort: declared peers + framework peers pinned to the installed MAJOR.
  // ALWAYS review by hand before release — source-derived deps are approximate.
  const out = { ...(marker.declaredDeps?.peerDependencies ?? {}) };
  for (const [dep, range] of Object.entries(marker.frameworkVersions ?? {})) {
    const major = majorOf(range);
    const relevant = marker.kind === 'angular' && /^(@angular\/|rxjs$|tslib$|zone\.js$)/.test(dep);
    if (major && (relevant || dep in out)) out[dep] = `^${major}.0.0`;
  }
  return out;
}

function run(cmd, cwd) {
  log(`  $ (${relative(process.env.HOME || '/', cwd)}) ${cmd}`);
  if (args.dryRun) return;
  execSync(cmd, { cwd, stdio: 'inherit' });
}

// ---- ingest one candidate ----
function ingestOne({ path: markerPath, marker }) {
  const scope = (args.scope || '@bespunky').replace(/\/+$/, '');
  const pkgName = marker.proposedPackage || `${scope}/${basename(marker.sourceLibRoot)}`;
  const base = pkgName.replace(/^@[^/]+\//, '');
  const pkgDir = join(sharedRoot, 'packages', base);
  const srcLibSrc = join(projectRoot, marker.sourceLibRoot, 'src');
  const exists = existsSync(pkgDir);

  log(`── ${pkgName}  (${marker.kind}, ${exists ? 'UPDATE existing' : 'NEW'})`);
  if (!existsSync(srcLibSrc)) die(`  source not found: ${srcLibSrc}`);

  // 1. Scaffold the publishable package shell (NEW only) via the shared workspace's own generator.
  if (!exists && !args.noScaffold) {
    const gen = marker.kind === 'angular' ? '@nx/angular:library' : '@nx/js:lib';
    run(
      `yarn nx g ${gen} ${base} --directory=packages/${base} --publishable --importPath=${pkgName} --no-interactive`,
      sharedRoot
    );
  } else if (!exists) {
    die(`  --no-scaffold given but package dir does not exist: ${pkgDir}`);
  }

  // 2. Replace the package src with the real library source.
  const pkgSrc = join(pkgDir, 'src');
  log(`  copy ${relative(projectRoot, srcLibSrc)} → packages/${base}/src`);
  if (!args.dryRun) {
    if (existsSync(pkgSrc)) rmSync(pkgSrc, { recursive: true, force: true });
    cpSync(srcLibSrc, pkgSrc, { recursive: true });
  }

  // 3. Set package.json name / version / deps / peerDeps / publishConfig.
  const pkgJsonPath = join(pkgDir, 'package.json');
  log(`  set package.json (name, deps, peerDeps, publishConfig)${exists ? ' — version left to nx release' : ` — version ${initialVersion(marker)}`}`);
  if (!args.dryRun) {
    const pkg = existsSync(pkgJsonPath) ? readJson(pkgJsonPath) : {};
    pkg.name = pkgName;
    if (!exists) pkg.version = initialVersion(marker); // updates: let `nx release` bump
    pkg.dependencies = { ...(pkg.dependencies ?? {}), ...(marker.declaredDeps?.dependencies ?? {}) };
    pkg.peerDependencies = { ...(pkg.peerDependencies ?? {}), ...pinPeerDeps(marker) };
    pkg.publishConfig = { ...(pkg.publishConfig ?? {}), access: 'public' }; // decision #1: public npm
    writeJson(pkgJsonPath, pkg);
  }

  // 4. Write the lifecycle back into the project marker (status → ingested).
  log(`  mark source ${relative(process.env.HOME || '/', markerPath)} → ingested`);
  if (!args.dryRun) {
    marker.status = 'ingested';
    marker.ingestedPackage = { name: pkgName, version: exists ? '(nx release)' : initialVersion(marker) };
    writeJson(markerPath, marker);
  }
  log('');
}

for (const c of markerPaths) ingestOne(c);

log('Done.' + (args.dryRun ? ' (dry-run — nothing written)' : ''));
log('Next:');
log(`  1. REVIEW the package(s) in ${basename(sharedRoot)} — especially peerDependencies and version.`);
log(`  2. \`nx release\` in ${basename(sharedRoot)} to publish to npm.`);
log(`  3. Commit the project's updated extraction.json (status: ingested).`);
log(`  4. Back in the project: \`nx g @bespunky/nx-tools:adopt-extracted --package <pkg>\`.`);
