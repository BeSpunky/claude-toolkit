// 0.50.0 — tools/reap-emulators.sh is retired: every emulator suite claims its ports through the dev engine.
//
// The file was generator-owned, so it goes whatever it holds; a project's own caller is reported, not rewritten (it
// would fail on the missing file — silently wrong in the other direction would be to leave the file and let it keep
// killing by `PPID == 1`). Input: the reaper as 0.49.2 shipped it (4f01d00), head only — the rung keys on the path.
import { createRequire } from 'node:module';

const { addProjectConfiguration } = createRequire(import.meta.url)('@nx/devkit');

const REAPER_0_49_2 = '#!/usr/bin/env bash\n# Reap stale Firebase emulator processes before a fresh `firebase emulators:start`.\n';

export default {
  name: '0.50.0 · retire-reap-emulators',
  ladder: ['0.50.0/retire-reap-emulators'],
  cases: [
    {
      name: 'the owned reaper is removed; a project target and a package.json script that still run it are reported',
      setup: (tree) => {
        tree.write('tools/reap-emulators.sh', REAPER_0_49_2);
        tree.write('package.json', JSON.stringify({ name: 'ws', scripts: { clean: 'bash tools/reap-emulators.sh' } }));
        addProjectConfiguration(tree, 'tools', {
          root: 'tools',
          targets: { reap: { executor: 'nx:run-commands', options: { command: 'bash tools/reap-emulators.sh' } } },
        });
      },
      expect: (tree, t, logs) => {
        t.ok(!tree.exists('tools/reap-emulators.sh'), 'tools/reap-emulators.sh is gone');
        t.ok(tree.read('package.json', 'utf8').includes('reap-emulators.sh'), 'the project\'s own script is not rewritten');
        if (logs) {
          const text = logs.join('\n');
          t.ok(/tools\/project\.json:\d+ still names tools\/reap-emulators\.sh/.test(text), `the target is reported: ${text}`);
          t.ok(/\] package\.json:1 still names/.test(text), `the script is reported: ${text}`);
        }
      },
    },
    {
      name: 'the reaper already gone, a caller left behind: still reported — the scan never depends on the file',
      setup: (tree) => {
        tree.write('firebase.json', '{}');
        tree.write('tools/reset.sh', '#!/usr/bin/env bash\nset -e\nbash tools/reap-emulators.sh\n');
      },
      expect: (tree, t, logs) => {
        const text = logs.join('\n');
        t.ok(/tools\/reset\.sh:3 still names tools\/reap-emulators\.sh/.test(text), `the script is reported with its line: ${text}`);
        t.ok(!/removed tools\/reap-emulators\.sh/.test(text), 'nothing claims a removal');
        t.ok(/not known to the dev engine/.test(text), 'the legacy-orphan note is given');
      },
    },
    {
      name: 'callers anywhere in the workspace text: a nested package.json, a workflow, a .vscode task, a shell script, a doc',
      setup: (tree) => {
        tree.write('tools/reap-emulators.sh', REAPER_0_49_2);
        tree.write('.gitignore', 'node_modules\n/ignored\n');
        tree.write('apps/web/package.json', JSON.stringify({ name: 'web', scripts: { pre: 'bash ../../tools/reap-emulators.sh' } }, null, 2));
        tree.write('.github/workflows/ci.yml', 'jobs:\n  e2e:\n    steps:\n      - run: bash tools/reap-emulators.sh\n');
        tree.write('.vscode/tasks.json', '{ "tasks": [{ "label": "reap", "command": "bash tools/reap-emulators.sh" }] }\n');
        tree.write('scripts/e2e.sh', '#!/usr/bin/env bash\n# frees the ports\ntools/reap-emulators.sh --all\nnpx playwright test\n');
        tree.write('docs/dev.md', 'Run `tools/reap-emulators.sh` when a port is stuck.\n');
        // Never reported: what is not the project's text (installs, ignored files, binaries) and the house's own 0.49
        // callers, which the workspace generators rewrite later in the same upgrade.
        tree.write('node_modules/x/run.sh', 'bash tools/reap-emulators.sh\n');
        tree.write('ignored/run.sh', 'bash tools/reap-emulators.sh\n');
        tree.write('assets/blob.bin', Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('tools/reap-emulators.sh')]));
        tree.write('tools/emulators.sh', '#!/usr/bin/env bash\nbash "$ROOT/tools/reap-emulators.sh" "${REAP_ARGS[@]}"\n');
        tree.write('tools/seed/build-seeds.sh', '#!/usr/bin/env bash\nbash "$ROOT/tools/reap-emulators.sh"\n');
      },
      expect: (tree, t, logs) => {
        const text = logs.join('\n');
        t.ok(!tree.exists('tools/reap-emulators.sh'), 'tools/reap-emulators.sh is gone');
        for (const at of ['apps/web/package.json:4', '.github/workflows/ci.yml:4', '.vscode/tasks.json:1', 'scripts/e2e.sh:3', 'docs/dev.md:1']) {
          t.ok(text.includes(`${at} still names`), `${at} is reported: ${text}`);
        }
        for (const path of ['node_modules/', 'ignored/', 'assets/blob.bin', 'tools/emulators.sh', 'tools/seed/build-seeds.sh']) {
          t.ok(!text.includes(`] ${path}`), `${path} is not reported`);
        }
        t.equal((text.match(/still names/g) ?? []).length, 5, 'exactly the five callers');
      },
    },
    {
      name: 'nothing to retire: a workspace without the reaper is untouched',
      setup: (tree) => tree.write('tools/emulators.sh', '#!/usr/bin/env bash\n'),
      expect: (tree, t, logs) => {
        t.ok(tree.exists('tools/emulators.sh') && !tree.exists('tools/reap-emulators.sh'), 'unchanged');
        t.equal(logs, [], 'not a Firebase workspace: nothing to say');
      },
    },
  ],
};
