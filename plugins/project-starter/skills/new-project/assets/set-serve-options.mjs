// Merge house dev-server options into an Angular app's serve target.
// host 0.0.0.0 -> reachable from outside the devcontainer; poll 1000 -> reliable file-watching over WSL/Docker mounts.
// Runs inside the typescript-node base image (Node 24). Usage: node set-serve-options.mjs <path-to-project.json>
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node set-serve-options.mjs <path-to-project.json>');
  process.exit(1);
}

const pj = JSON.parse(readFileSync(path, 'utf8'));
pj.targets ??= {};
pj.targets.serve ??= {};
pj.targets.serve.options ??= {};
pj.targets.serve.options.host = '0.0.0.0';
pj.targets.serve.options.poll = 1000;

writeFileSync(path, JSON.stringify(pj, null, 2) + '\n');
console.log('Set serve options (host=0.0.0.0, poll=1000) in', path);
