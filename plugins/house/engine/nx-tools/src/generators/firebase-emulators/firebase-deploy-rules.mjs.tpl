#!/usr/bin/env node
// `nx run firebase:deploy` — deploy the Firestore rules, Firestore indexes and Storage rules this project's
// firebase.json declares, and nothing it does not. Generator-owned (@bespunky/nx-tools firebase-emulators):
// rewritten on every upgrade — change what ships by changing firebase.json, never this file.
//
//   nx run firebase:deploy -P <alias>                              by hand (`nx run` takes --project itself)
//   nx run-many -t deploy -c ci-<environment>                      CI — the configuration's args reach the Firebase CLI
//
// What ships is read from firebase.json WHEN THIS RUNS, so rules declared later ship without an upgrade:
//   firestore.rules     → firestore:rules
//   firestore.indexes   → firestore:indexes
//   storage.rules       → storage
// (each key an object, or an array of them — one per database / bucket). A declared file that is missing fails the
// deploy before anything ships. A rules file still carrying the `{{seedMarker}}` line is the house's deny-all
// placeholder, which nobody has reviewed: its service is SKIPPED, loudly — delete the line once the rules are yours.
// The deploy itself (and, when it fails, the road to a first deploy) is tools/firebase-deploy.mjs.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deploy } from './firebase-deploy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = '{{seedMarker}}';
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
  say('    npx firebase init firestore storage -P <alias>');
  say('It downloads the current rules and indexes from the console, so the first deploy changes nothing, and declares');
  say('them in firebase.json.');
  process.exit(0);
}

const missing = declared.filter(([, path]) => !existsSync(join(ROOT, path)));
if (missing.length) {
  fail(`firebase.json declares ${missing.map(([, path]) => path).join(', ')}, which do not exist — nothing was deployed.`);
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
