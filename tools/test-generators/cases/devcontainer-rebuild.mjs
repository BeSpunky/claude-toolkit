// WHAT THE CONTAINER IS BUILT FROM (generators/devcontainer/container-inputs.ts) — the content comparison behind
// house.sh's `UPGRADE_NEXT: rebuild-container`. What would break silently:
//   - S2-8: a layer with no container share (`ci`) still moves the ownership marker's `layers` list and the layer
//     names in the composed files' header comments. Read off the file list, that is a rebuild of a container nothing
//     changed — a boundary that fires for nothing, which everyone then learns to ignore.
//   - the opposite, worse direction: a real change (a mount, a feature, a post-create step, a package of the
//     project's own) hidden by the reduction, so a needed rebuild is reported as nothing.
//   - the git plumbing reading the wrong coordinates in a project that is a subdirectory of its repository.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { snapshot } from '../../test-support/payload.mjs';
import { workspace } from '../workspaces.mjs';

const INPUTS = 'generators/devcontainer/container-inputs';
const devcontainerOf = (tree) =>
  Object.fromEntries(Object.entries(JSON.parse(snapshot(tree))).filter(([path]) => path.startsWith('.devcontainer/')));
const compose = (layers, extra = {}) => async (tree, ctx) => {
  const before = devcontainerOf(tree);
  await ctx.load('generators/devcontainer/generator').default(tree, { name: 'acme', layers, ...extra });
  return before;
};
const fixture = () => {
  const tree = workspace();
  tree.write('.nvmrc', '22\n');
  return tree;
};

/** A layer is added, then the container question is asked of the two states. */
const added = (name, base, after, expectDiffer) => ({
  name,
  setup: async (ctx) => {
    const tree = fixture();
    await compose(base)(tree, ctx);
    return tree;
  },
  run: async (tree, ctx) => {
    ctx.before ??= devcontainerOf(tree);
    await compose(after.layers, after.options)(tree, ctx);
  },
  expect: (tree, t, ctx) => {
    const { containerInputsDiffer } = ctx.load(INPUTS);
    const now = devcontainerOf(tree);
    const moved = Object.keys(now).filter((path) => ctx.before[path] !== now[path]);
    t.ok(moved.length > 0, 'the layer moved files under .devcontainer/ (what the file-list rule rebuilt for)');
    const differing = containerInputsDiffer(ctx.before, now);
    if (expectDiffer) t.ok(differing.length > 0, 'a real container change is reported as one');
    else t.equal(differing, [], 'only records and comments moved — the container is the same');
  },
});

const pure = (name, run) => ({
  name,
  once: 'it asserts a pure function — there is no tree operation to repeat',
  setup: () => workspace(),
  run: () => {},
  expect: (tree, t, ctx) => run(t, ctx.load(INPUTS)),
});

const D = '.devcontainer';

export default {
  name: 'devcontainer — what the container is built from (UPGRADE_NEXT rebuild-container)',
  cases: [
    added('S2-8: adding `ci` (no container share) is not a container change', ['nx', 'agent'], { layers: ['nx', 'agent', 'ci'] }, false),
    added('adding `web` (mounts, ports, packages) IS a container change', ['nx', 'agent'], { layers: ['nx', 'agent', 'web'] }, true),
    added('turning voice on IS a container change', ['nx', 'agent'], { layers: ['nx', 'agent'], options: { voice: true } }, true),

    pure('the reduction keeps everything a build reads, and drops only comments and records', (t, { containerInputsDiffer }) => {
      const same = (label, a, b) => t.equal(containerInputsDiffer(a, b), [], label);
      const differs = (label, a, b) => t.ok(containerInputsDiffer(a, b).length > 0, label);
      const sh = `${D}/post-create.sh`;
      same('a JSONC comment', { [`${D}/devcontainer.json`]: '{ "a": 1 }' }, { [`${D}/devcontainer.json`]: '// layers: x\n{\n  "a": 1, // why\n}' });
      differs('a JSON value', { [`${D}/devcontainer.json`]: '{ "mounts": [] }' }, { [`${D}/devcontainer.json`]: '{ "mounts": ["m"] }' });
      same('the ownership record', { [`${D}/.bespunky-devcontainer.json`]: '{"layers":["agent"]}' }, { [`${D}/.bespunky-devcontainer.json`]: '{"layers":["agent","ci"]}' });
      same('a shell comment and a blank line', { [sh]: '#!/bin/bash\n# layers: a\necho hi\n' }, { [sh]: '#!/bin/bash\n# layers: a, ci\n\necho hi\n' });
      differs('a shell command', { [sh]: 'echo hi\n' }, { [sh]: 'echo bye\n' });
      differs('a comment line INSIDE a heredoc (it is written somewhere)', { [sh]: 'cat > f <<EOF\n# a\nEOF\n' }, { [sh]: 'cat > f <<EOF\n# b\nEOF\n' });
      differs('a quoted, dashed heredoc too', { [sh]: "cat > f <<-'EOF'\n\t# a\n\tEOF\n" }, { [sh]: "cat > f <<-'EOF'\n\t# b\n\tEOF\n" });
      differs('a comment after a continuation (removing it would join two lines)', { [sh]: 'a \\\n# c\nb\n' }, { [sh]: 'a \\\nb\n' });
      same('a here-string is not a heredoc', { [sh]: 'x <<<"$y"\n# c\necho\n' }, { [sh]: 'x <<<"$y"\necho\n' });
      same('a Dockerfile comment', { [`${D}/house.Dockerfile`]: '# x\nFROM a\n' }, { [`${D}/house.Dockerfile`]: '# y\nFROM a\n' });
      differs('a Dockerfile instruction', { [`${D}/house.Dockerfile`]: 'FROM a\n' }, { [`${D}/house.Dockerfile`]: 'FROM b\n' });
      same('a comment in the package list', { [`${D}/os-packages.txt`]: '# mine\njq\n' }, { [`${D}/os-packages.txt`]: 'jq\n' });
      differs('a package of the project\'s own', { [`${D}/os-packages.txt`]: 'jq\n' }, { [`${D}/os-packages.txt`]: 'jq\nripgrep\n' });
      differs('an unknown file, byte for byte', { [`${D}/notes.md`]: '# a' }, { [`${D}/notes.md`]: '# b' });
      differs('a file that appears', {}, { [`${D}/post-create.local.sh`]: 'echo mine\n' });
      differs('a JSON file that does not parse is compared raw', { [`${D}/devcontainer.json`]: '{ "a": ' }, { [`${D}/devcontainer.json`]: '{  "a": ' });
      same('nothing outside .devcontainer/', { 'README.md': 'a' }, { 'README.md': 'b' });
    }),

    // The CLI's two snapshots — the committed base and the working tree — in a project that is a SUBDIRECTORY of its
    // repository, where git speaks repo-root paths unless asked not to.
    {
      name: 'the base and working-tree snapshots, in a subdirectory project',
      once: 'it drives a real git repository outside the tree',
      setup: () => workspace(),
      run: () => {},
      expect: (tree, t, ctx) => {
        const { snapshotAt, snapshotNow, containerInputsDiffer } = ctx.load(INPUTS);
        const repo = mkdtempSync(join(tmpdir(), 'container-inputs-'));
        const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        const write = (path, text) => {
          mkdirSync(dirname(join(repo, path)), { recursive: true });
          writeFileSync(join(repo, path), text);
        };
        try {
          git('init', '-q');
          write('web/.devcontainer/.bespunky-devcontainer.json', '{"layers":["agent"]}\n');
          write('web/.devcontainer/post-create.sh', '# layers: agent\necho hi\n');
          write('web/.devcontainer/devcontainer.json', '{ "a": 1 }\n');
          git('add', '-A');
          git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
          const base = git('rev-parse', 'HEAD');
          const project = join(repo, 'web');
          t.equal(Object.keys(snapshotAt(base, project)).sort(), Object.keys(snapshotNow(project)).sort(), 'both snapshots name the same project-relative paths');
          write('web/.devcontainer/.bespunky-devcontainer.json', '{"layers":["agent","ci"]}\n');
          write('web/.devcontainer/post-create.sh', '# layers: agent, ci\necho hi\n');
          t.equal(containerInputsDiffer(snapshotAt(base, project), snapshotNow(project)), [], 'records and comments: same');
          write('web/.devcontainer/os-packages.txt', 'jq\n');
          t.equal(containerInputsDiffer(snapshotAt(base, project), snapshotNow(project)), ['.devcontainer/os-packages.txt'], 'an UNTRACKED package list: changed');
          const empty = git('hash-object', '-t', 'tree', '/dev/null');
          t.ok(containerInputsDiffer(snapshotAt(empty, project), snapshotNow(project)).length > 0, 'against the empty tree (no commits yet): changed');
        } finally {
          rmSync(repo, { recursive: true, force: true });
        }
      },
    },
  ],
};
