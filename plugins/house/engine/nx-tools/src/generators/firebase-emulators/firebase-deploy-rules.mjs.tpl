#!/usr/bin/env node
// `nx run firebase:deploy` — deploy the Firestore rules, Firestore indexes and Storage rules this project's
// firebase.json declares, and nothing it does not. Generator-owned (@bespunky/nx-tools firebase-emulators):
// rewritten on every upgrade — change what ships by changing firebase.json, never this file.
//
//   nx run firebase:deploy -P <alias>                              by hand (`nx run` takes --project itself)
//   nx run-many -t deploy -c ci-<environment>                      CI — the configuration's args reach the Firebase CLI
// (through a shell — Nx run-commands joins them into one command line, each double-quoted, so `$` and backticks are
// still expanded: escape them with a backslash).
//
// What ships is read from firebase.json WHEN THIS RUNS, so rules declared later ship without an upgrade:
//   firestore.rules     → firestore:rules
//   firestore.indexes   → firestore:indexes
//   storage.rules       → storage
// (each key an object, or an array of them — one per database / bucket). A declared file that is missing fails the
// deploy before anything ships. A rules file still carrying the `{{seedMarker}}` line is the house's deny-all
// placeholder, which nobody has reviewed: its service is SKIPPED, loudly — delete the line once the rules are yours.
// The house never seeds an indexes file, so one that is declared is the project's own (`firebase deploy --force`
// deletes every live index it does not list — that must only ever follow a file someone wrote or pulled).
//
// What ships must also be what `nx affected` WATCHES, or CI would deploy a rules file once and then never notice a
// change to it: a declared file outside the suite project (whose own files always mark it affected) must be one of
// this target's `{workspaceRoot}/…` inputs. The house upgrade adds every declared file; until then — a rules file
// declared since the last upgrade — the deploy REFUSES, naming the one-line fix, rather than ship what CI won't see.
// The deploy itself (and, when it fails, the road to a first deploy) is tools/firebase-deploy.mjs.
import { existsSync, readFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deploy } from './firebase-deploy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = '{{seedMarker}}';
// The suite project — its own files always mark it affected — and the target this runs as.
const SUITE = '{{suiteRoot}}';
const TARGET = process.env.NX_TASK_TARGET_TARGET || 'deploy';
const say = (line) => console.log(`[firebase:deploy] ${line}`);
const fail = (line) => {
  console.error(`[firebase:deploy] ${line}`);
  process.exit(1);
};

let config;
try {
  config = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
} catch (error) {
  fail(`cannot read firebase.json: ${error.message}`);
}
const entries = (key) => [].concat(config[key] ?? []).filter((entry) => entry && typeof entry === 'object');
const declared = [
  ...entries('firestore').flatMap((entry) => [['firestore:rules', entry.rules], ['firestore:indexes', entry.indexes]]),
  ...entries('storage').map((entry) => ['storage', entry.rules]),
].filter(([, path]) => typeof path === 'string' && path.length > 0);

if (!declared.length) {
  say('firebase.json declares no Firestore or Storage rules, so there is nothing to deploy — this project\'s rules live');
  say('only in the Firebase console. To keep them in the repo (reviewed, versioned, shipped by `nx affected -t deploy`),');
  say('pull the LIVE ones in once — a human, in a terminal (it asks where to put each file; answer firebase/<file>):');
  say('    npx firebase init firestore -P <alias>');
  say('    npx firebase init storage -P <alias>');
  say('(two commands: `firebase init` takes ONE feature, and drops any second one without a word).');
  say('It downloads the current rules and indexes from the console, so the first deploy changes nothing, and declares');
  say('them in firebase.json.');
  process.exit(0);
}

const missing = declared.filter(([, path]) => !existsSync(join(ROOT, path)));
if (missing.length) {
  fail(`firebase.json declares ${missing.map(([, path]) => path).join(', ')}, which do not exist — nothing was deployed.`);
}

const unwatched = unwatchedBy(watchedFiles(), declared.map(([, path]) => path));
if (unwatched.length) {
  const target = `${process.env.NX_TASK_TARGET_PROJECT || 'firebase'}:${TARGET}`;
  fail(
    `firebase.json declares ${unwatched.join(', ')}, which no input of ${target} watches — so \`nx affected -t deploy\` ` +
      '(CI) would never redeploy a change to it. Nothing was deployed. Run the house upgrade (/bespunky-house:upgrade — ' +
      `it watches every declared file), or add ${unwatched.map((path) => `"{workspaceRoot}/${path}"`).join(', ')} to ` +
      `${target}'s inputs yourself (house targets are yours to extend).`,
  );
}

const seeded = declared.filter(([, path]) => readFileSync(join(ROOT, path), 'utf8').includes(MARKER));
for (const [only, path] of seeded) {
  say(`SKIPPING ${only}: ${path} is the house's deny-all placeholder (it still carries the \`${MARKER}\` line). Write your`);
  say(`rules — or pull the live ones: \`npx firebase init ${only.split(':')[0]} -P <alias>\` — then delete that line.`);
}
const skipped = new Set(seeded.map(([only]) => only));
const only = [...new Set(declared.map(([service]) => service))].filter((service) => !skipped.has(service));
if (!only.length) {
  say('nothing left to deploy.');
  process.exit(0);
}

process.exit(deploy(only.join(','), process.argv.slice(2), 'firebase:deploy'));

/**
 * The workspace files this target's inputs name — `{workspaceRoot}/…` entries and filesets, through named inputs
 * (nx.json's and the project's), exactly as Nx collects them for `affected`. undefined: the target's configuration
 * could not be read (a project defined some other way) — then nothing is refused on a guess.
 */
function watchedFiles() {
  const read = (path) => {
    try {
      return JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
    } catch {
      return undefined;
    }
  };
  const at = SUITE === '.' ? '' : `${SUITE}/`;
  const project = read(`${at}project.json`) ?? read(`${at}package.json`)?.nx;
  const inputs = project?.targets?.[TARGET]?.inputs;
  if (!Array.isArray(inputs)) return undefined;
  const named = { ...(read('nx.json')?.namedInputs ?? {}), ...(project.namedInputs ?? {}) };
  const files = [];
  const collect = (list, seen) => {
    for (const input of list) {
      if (typeof input === 'string' && input in named && !seen.has(input)) collect(named[input] ?? [], new Set([...seen, input]));
      const glob = typeof input === 'string' ? input : input?.fileset;
      if (typeof glob === 'string' && glob.startsWith('{workspaceRoot}/')) files.push(glob.slice('{workspaceRoot}/'.length));
    }
  };
  collect(inputs, new Set());
  return files;
}

/** The declared files outside the suite project that no watched path or glob covers. */
function unwatchedBy(watched, paths) {
  if (!watched) return [];
  // path.matchesGlob is Node 22.5+; without it only exact paths count (no refusal is ever made on a glob it cannot read).
  const glob = typeof nodePath.matchesGlob === 'function' ? nodePath.matchesGlob : (_path, pattern) => /[*?{[]/.test(pattern);
  return [...new Set(paths.map((path) => normalize(path).replace(/^\.\//, '')))].filter((path) => {
    if (SUITE !== '.' && (path === SUITE || path.startsWith(`${SUITE}/`))) return false; // the project's own file
    return !watched.some((pattern) => path === pattern || glob(path, pattern));
  });
}
