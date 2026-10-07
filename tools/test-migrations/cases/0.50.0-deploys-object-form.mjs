// 0.50.0 — a branch model's `deploys` is an object only; every bare-string note becomes { "note": … }.
//
// The shapes it meets: a declaration with a string on every kind of holder (integration, stages, releases,
// hotfixes, tags — gitflow has them all), one mixing a structured binding, a null and a string, this repo's own
// declaration as it shipped (4f01d00), a tab-indented one, a file that is not JSON (left, reported), and no file.
// The ENGINE is the oracle: the result must be what `branches.mjs write` writes for the rewritten model, carry no
// outdated or invalid field (model.mjs `check`), and keep a projection the engine would compute unchanged.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, requireFromRepo } from '../../test-support/payload.mjs';

const { check, expand, project } = await import(
  pathToFileURL(join(REPO, 'plugins/workflow/skills/branch-and-release/scripts/lib/model.mjs')).href
);

const FILE = '.bespunky/branches.json';
const write = (m) => `${JSON.stringify(m, null, 2)}\n`;
const declared = (m) => ({ ...m, projection: project(m) });

/** gitflow with a string note on every holder — what a pre-0.50 engine wrote. */
function legacyGitflow() {
  const m = expand('gitflow', {});
  m.integration.deploys = 'preview channel';
  m.stages[0].deploys = 'production — "the" site';
  m.releases.deploys = 'release candidates';
  m.hotfixes.deploys = 'nothing; humans test';
  m.tags[0].deploys = 'npm publish';
  return declared(m);
}
const objectForm = (m) => {
  const o = structuredClone(m);
  for (const holder of [o.integration, ...o.stages, o.releases, o.hotfixes, ...o.tags]) {
    if (holder && typeof holder.deploys === 'string') holder.deploys = { note: holder.deploys };
  }
  return o;
};

// This repo's declaration exactly as it shipped at 4f01d00.
const SHIPPED = `{
  "schema": 1,
  "derivedFrom": "two-line",
  "remote": "origin",
  "integration": {
    "branch": "development",
    "baseline": "7af334125a239f5b117d0a2805dd95d12dd29d7a"
  },
  "stages": [
    {
      "branch": "main",
      "promote": "ff",
      "baseline": "7af334125a239f5b117d0a2805dd95d12dd29d7a",
      "deploys": "publish-nx-tools.yml publishes @bespunky/nx-tools to npm; origin's default branch — what marketplace consumers pull"
    }
  ],
  "releases": null,
  "hotfixes": null,
  "work": {
    "pattern": "{type}/{slug}",
    "types": [
      "feat",
      "fix",
      "chore",
      "docs",
      "refactor"
    ]
  },
  "fixFlow": null,
  "landing": {
    "via": "merge",
    "prStyle": null
  },
  "tags": [],
  "projection": {
    "schema": 1,
    "remote": "origin",
    "integration": "development",
    "production": [
      "main"
    ],
    "productionPatterns": [],
    "chain": [
      "development",
      "main"
    ],
    "protected": [
      "development",
      "main"
    ],
    "protectedPatterns": [],
    "workBase": "development",
    "summary": "development → main"
  }
}
`;

const said = [];
function record() {
  said.splice(0);
  const { logger } = requireFromRepo('@nx/devkit');
  for (const level of ['info', 'warn']) {
    const previous = logger[level];
    logger[level] = (...args) => (said.push(args.join(' ')), previous(...args));
  }
}

/** The engine's verdict on the result: valid, current, projection unchanged and still what the engine computes. */
function engineAccepts(t, before) {
  const after = t.json(FILE);
  const { errors, outdated } = check(after);
  t.ok(!errors.length && !outdated.length, `the engine still objects: ${[...errors, ...outdated].join('; ')}`);
  t.ok(JSON.stringify(after.projection) === JSON.stringify(before.projection), 'the projection changed');
  t.ok(JSON.stringify(project(after)) === JSON.stringify(after.projection), 'the projection no longer matches the model (verify, invariant 5)');
}

export default {
  name: '0.50.0 · deploys-object-form',
  ladder: ['0.50.0/deploys-object-form'],
  cases: [
    {
      name: 'a string on every holder (gitflow): each becomes { note }, byte-identical to what `write` writes, each reported',
      setup: (tree) => {
        record();
        tree.write(FILE, write(legacyGitflow()));
      },
      expect: (tree, t) => {
        t.ok(t.read(FILE) === write(objectForm(legacyGitflow())), `got:\n${t.read(FILE)}`);
        engineAccepts(t, legacyGitflow());
        const report = said.find((line) => line.includes('deploys-object-form'));
        for (const f of ['integration.deploys', 'stages[0].deploys', 'releases.deploys', 'hotfixes.deploys', 'tags[0].deploys']) {
          t.ok(report?.includes(f), `the report names ${f}: ${report}`);
        }
      },
    },
    {
      name: 'mixed: a structured binding and a null are untouched, only the string moves',
      setup: (tree) => {
        const m = expand('three-line', {});
        m.integration.deploys = null;
        m.stages[0].deploys = { note: 'staging', ci: { environment: 'staging', providers: { firebase: 'staging' } } };
        m.stages[1].deploys = 'App Hosting auto-rollout';
        tree.write(FILE, write(declared(m)));
      },
      expect: (tree, t) => {
        const m = t.json(FILE);
        t.ok(m.integration.deploys === null, 'the null changed');
        t.ok(m.stages[0].deploys.ci.environment === 'staging' && m.stages[0].deploys.note === 'staging', 'the binding changed');
        t.ok(JSON.stringify(m.stages[1].deploys) === '{"note":"App Hosting auto-rollout"}', `got ${JSON.stringify(m.stages[1].deploys)}`);
        t.ok(m.projection.deploys.length === 1, 'the projection lost its binding');
        const { errors, outdated } = check(m);
        t.ok(!errors.length && !outdated.length, [...errors, ...outdated].join('; '));
      },
    },
    {
      name: "this repo's own declaration as shipped (4f01d00): the note moves, every other byte stays",
      setup: (tree) => tree.write(FILE, SHIPPED),
      expect: (tree, t) => {
        const before = JSON.parse(SHIPPED);
        t.ok(t.read(FILE) === write(objectForm(before)), `got:\n${t.read(FILE)}`);
        engineAccepts(t, before);
      },
    },
    {
      name: 'tab-indented: rewritten in tabs, nothing else touched',
      setup: (tree) => tree.write(FILE, JSON.stringify(JSON.parse(SHIPPED), null, '\t') + '\n'),
      expect: (tree, t) => {
        t.ok(t.read(FILE) === JSON.stringify(objectForm(JSON.parse(SHIPPED)), null, '\t') + '\n', `got:\n${t.read(FILE)}`);
      },
    },
    {
      name: 'already object-only: nothing written, nothing said',
      setup: (tree) => {
        record();
        tree.write(FILE, write(objectForm(legacyGitflow())));
      },
      expect: (tree, t) => {
        t.ok(t.read(FILE) === write(objectForm(legacyGitflow())), 'the file changed');
        t.ok(!said.some((line) => line.includes('deploys-object-form')), `said: ${said}`);
      },
    },
    {
      name: 'not JSON: left exactly as it is, and reported',
      setup: (tree) => {
        record();
        tree.write(FILE, '{ "schema": 1, oops');
      },
      expect: (tree, t) => {
        t.ok(t.read(FILE) === '{ "schema": 1, oops', 'an unreadable declaration was rewritten');
        t.ok(said.some((line) => /not a JSON object.*unreadable/.test(line)), `said: ${said}`);
      },
    },
    {
      name: 'no declaration: nothing written',
      setup: () => {},
      expect: (tree, t) => t.missing(FILE),
    },
  ],
};
