// AN UPGRADE'S DIFF IS ITS MEANING — the in-place writers (_utils/jsonc-insert.ts, _utils/json-edits.ts) change only
// the members whose value changed, in the file's own style. The dogfood that asked for them: a one-line
// `forwardPorts` came back as nine lines for one added port, and a rung that removed `continuous` moved every
// firebase target's `options` below its `dependsOn`.
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace } from '../workspaces.mjs';

const pure = (name, run, expect) => ({
  name,
  once: 'it asserts a pure function — there is no tree operation to repeat',
  setup: () => workspace(),
  run: (tree, ctx) => (ctx.result = run(ctx)),
  expect: (tree, t, ctx) => expect(t, ctx.result),
});

const DEVCONTAINER = `{
  // Forwarded ports.
  "forwardPorts": [80, 4200, 9099],
  "portsAttributes": {
    "80": { "label": "Origin" },
    "9099": { "label": "Auth Emulator" } // the last one
  },
  "mounts": [
    "a",
    "b" // why b
  ]
}
`;

const PROJECT = `{
  "name": "firebase",
  "tags": ["platform:shared"],
  "targets": {
    "emulators": {
      "continuous": true,
      "executor": "nx:run-commands",
      "options": { "command": "bash tools/emulators.sh", "cwd": "{workspaceRoot}" },
      "dependsOn": [{ "projects": ["functions"], "target": "build" }]
    }
  }
}
`;

const MANIFEST = `{
  "name": "@acme/source",
  "workspaces": ["apps/*"],
  "dependencies": { "rxjs": "7.8.0" },
  "devDependencies": {
    "eslint": "9.0.0",
    "vitest": "3.0.0"
  }
}
`;

const COMPACT = `{
  "name": "web-e2e",
  "projectType": "application",
  "targets": {
    "e2e": { "executor": "@nx/playwright:playwright", "options": { "config": "apps/web-e2e/playwright.config.ts" } },
    "lint": { "executor": "@nx/eslint:lint" }
  },
  "implicitDependencies": ["web"]
}
`;

export default {
  name: 'in-place JSON edits · the file keeps its form',
  cases: [
    pure(
      'a one-line array gains a member on its line; a one-line object member stays one line; a trailing comment keeps its member',
      (ctx) => {
        const { insertJsoncMember } = ctx.load('generators/_utils/jsonc-insert');
        let text = insertJsoncMember(DEVCONTAINER, ['forwardPorts', 3], 4500);
        text = insertJsoncMember(text, ['portsAttributes', '4500'], { label: 'Emulator Logs', onAutoForward: 'silent' });
        return insertJsoncMember(text, ['mounts', 2], 'c');
      },
      (t, text) => {
        t.ok(text.includes('"forwardPorts": [80, 4200, 9099, 4500],'), `forwardPorts:\n${text}`);
        t.ok(text.includes('"9099": { "label": "Auth Emulator" }, // the last one\n    "4500": { "label": "Emulator Logs", "onAutoForward": "silent" }\n'), `portsAttributes:\n${text}`);
        t.ok(text.includes('"b", // why b\n    "c"\n'), `mounts:\n${text}`);
      },
    ),
    pure(
      'a value equal but for key order writes nothing; a removed member takes its line and nothing else moves',
      (ctx) => {
        const { applyJsonChanges } = ctx.load('generators/_utils/json-edits');
        const before = JSON.parse(PROJECT);
        const reordered = { targets: before.targets, tags: before.tags, name: before.name };
        const noop = applyJsonChanges(PROJECT, before, reordered);
        const after = JSON.parse(PROJECT);
        delete after.targets.emulators.continuous;
        return { noop, removed: applyJsonChanges(PROJECT, before, after) };
      },
      (t, { noop, removed }) => {
        t.ok(noop === PROJECT, 'a reorder alone is no change');
        t.ok(removed === PROJECT.replace('      "continuous": true,\n', ''), `only the member went:\n${removed}`);
      },
    ),
    pure(
      'a new member lands at its place in the new value (a sorted block stays sorted); a one-line value stays one line',
      (ctx) => {
        const { applyJsonChanges } = ctx.load('generators/_utils/json-edits');
        const { placeDependency } = ctx.load('generators/_utils/dependencies');
        const before = JSON.parse(MANIFEST);
        const after = JSON.parse(MANIFEST);
        after.devDependencies = placeDependency(after.devDependencies, 'firebase-tools', '15.32.1');
        after.dependencies = placeDependency(after.dependencies, '@angular/core', '~21.0.0');
        after.workspaces = ['apps/*', 'tools/*'];
        return applyJsonChanges(MANIFEST, before, after);
      },
      (t, text) => {
        t.ok(text.includes('"eslint": "9.0.0",\n    "firebase-tools": "15.32.1",\n    "vitest": "3.0.0"'), `sorted place:\n${text}`);
        t.ok(text.includes('"dependencies": { "@angular/core": "~21.0.0", "rxjs": "7.8.0" }'), `one-line block, first place:\n${text}`);
        t.ok(text.includes('"workspaces": ["apps/*", "tools/*"],'), `a replaced one-line array stays one line:\n${text}`);
      },
    ),
    {
      name: 'a compact project.json: the in-place devkit replacement writes only the member that changed',
      setup: () => {
        const tree = workspace();
        tree.write('apps/web-e2e/project.json', COMPACT);
        return tree;
      },
      run: (tree, ctx) => {
        const { readProjectConfiguration } = requireFromRepo('@nx/devkit');
        const { updateProjectConfigurationInPlace } = ctx.load('generators/_utils/project-files');
        const config = readProjectConfiguration(tree, 'web-e2e');
        config.tags = [...new Set([...(config.tags ?? []), 'platform:shared'])];
        updateProjectConfigurationInPlace(tree, 'web-e2e', config);
      },
      expect: (tree, t) =>
        t.equal(tree.read('apps/web-e2e/project.json', 'utf8'), COMPACT.replace('  "implicitDependencies"', '  "tags": ["platform:shared"],\n  "implicitDependencies"'), 'only the tag (at its place in what devkit reads)'),
    },
    {
      name: 'a house project already current: ensureHouseProject leaves a prettier-formatted project.json byte-identical',
      setup: () => {
        const tree = workspace();
        tree.write('firebase/project.json', PROJECT.replace('      "continuous": true,\n', ''));
        return tree;
      },
      run: (tree, ctx) => {
        const P = ctx.load('generators/_utils/project-files');
        const owned = JSON.parse(PROJECT.replace('      "continuous": true,\n', ''));
        // The house declares the same target with its keys in another order — equal in meaning.
        const { emulators } = owned.targets;
        P.ensureHouseProject(tree, 'test', P.houseProjectHome(tree, 'firebase', 'firebase'), {
          tags: ['platform:shared'],
          targets: { emulators: { dependsOn: emulators.dependsOn, options: emulators.options, executor: emulators.executor } },
        });
      },
      expect: (tree, t) =>
        t.ok(tree.read('firebase/project.json', 'utf8') === PROJECT.replace('      "continuous": true,\n', ''), `project.json:\n${tree.read('firebase/project.json', 'utf8')}`),
    },
  ],
};
