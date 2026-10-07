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
          t.ok(/tools: targets\.reap\.options\.command still runs tools\/reap-emulators\.sh/.test(text), `the target is reported: ${text}`);
          t.ok(/package\.json: scripts\.clean still runs/.test(text), 'the script is reported');
        }
      },
    },
    {
      name: 'nothing to retire: a workspace without the reaper is untouched',
      setup: (tree) => tree.write('tools/emulators.sh', '#!/usr/bin/env bash\n'),
      expect: (tree, t) => t.ok(tree.exists('tools/emulators.sh') && !tree.exists('tools/reap-emulators.sh'), 'unchanged'),
    },
  ],
};
