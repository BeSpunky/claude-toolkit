// Nx inferred-targets plugin: gives every Nx project that owns at least one suite in tools/test-suites/suites.json a `test`
// target. The list is the only source: no project.json declares a test target, and nothing here names a project or a suite.
// The target runs the root runner for that project, so needs, skips and failures behave exactly as in `yarn test`.
//
// Registered in nx.json `plugins`. Option `suites` (default: the real list, relative to the workspace root) points at
// another list; the plugin's own test uses it with fixtures.
const { readFileSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');

const DEFAULT_LIST = 'tools/test-suites/suites.json';

/** The Nx projects a list gives suites to, in list order, without repeats. */
function owningProjects(list) {
  return [...new Set(list.suites.map((s) => s.project))];
}

function readList(workspaceRoot, options) {
  return JSON.parse(readFileSync(resolve(workspaceRoot, options?.suites ?? DEFAULT_LIST), 'utf8'));
}

/** The one definition of the inferred target. cache:false because the suites observe the machine (network, docker), not just files. */
function testTarget(project) {
  return {
    executor: 'nx:run-commands',
    cache: false,
    // The suites are not safe side by side (test-voice, test-scaffold), so Nx must not run two projects' targets at once.
    parallelism: false,
    options: { command: `node tools/test-suites/run.mjs --project=${project}` },
    metadata: { description: `Runs the suites suites.json declares for ${project}, through the root runner` },
  };
}

const createNodesV2 = [
  '**/project.json',
  (projectFiles, options, context) => {
    const owners = new Set(owningProjects(readList(context.workspaceRoot, options)));
    return projectFiles.map((file) => {
      const root = dirname(file);
      const name = JSON.parse(readFileSync(join(context.workspaceRoot, file), 'utf8')).name;
      const targets = owners.has(name) ? { test: testTarget(name) } : {};
      return [file, { projects: { [root]: { targets } } }];
    });
  },
];

module.exports = { createNodesV2, owningProjects, testTarget };
