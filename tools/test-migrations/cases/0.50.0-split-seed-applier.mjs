// 0.50.0 — the seed applier leaves the project-owned tools/seed/world.mjs for the generator-owned apply.mjs.
//
// The shapes it meets: the stock 0.49 world (kept verbatim beside this case in `0.50.0-stock-0.49/` — the
// migration recognises the applier by its tokens, so an invented fixture would test nothing), the same world after a
// formatter (quotes, semicolons, trailing commas, comments), a stock applier under the project's own worlds and
// header, a world that reads one of the stock host constants, a customised applier (left exactly, reported — and
// still the one build.mjs runs), an already-split world, CRLF line endings, and no seed tooling at all.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAYLOAD, requireFromRepo } from '../../test-support/payload.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORLD = 'tools/seed/world.mjs';
const stock = readFileSync(join(HERE, '0.50.0-stock-0.49', 'world.mjs.tpl'), 'utf8').replaceAll('{{workspaceName}}', 'acme');
const current = readFileSync(join(PAYLOAD, 'src/generators/firebase-emulators/seed-world.mjs.tpl'), 'utf8').replaceAll('{{workspaceName}}', 'acme');
const BANNER = '// ── The applier (generic; never needs touching to add data)';

/** Records the migration's warnings for the case that asserts a report (the harness captures, but keeps them). */
const warnings = [];
function recordWarnings() {
  warnings.splice(0);
  const logger = requireFromRepo('@nx/devkit').logger;
  const previous = logger.warn;
  logger.warn = (...args) => {
    warnings.push(args.join(' '));
    previous(...args);
  };
}

/** Import the migrated world with node itself — the proof a project's seed:build still loads it. */
function worldsLoad(tree) {
  const dir = mkdtempSync(join(tmpdir(), 'seed-split-'));
  try {
    mkdirSync(join(dir, 'tools/seed'), { recursive: true });
    for (const f of ['world.mjs', 'apply.mjs', 'build.mjs']) writeFileSync(join(dir, 'tools/seed', f), tree.read(`tools/seed/${f}`, 'utf8'));
    return execFileSync(process.execPath, ['--input-type=module', '-e',
      `import { WORLDS } from './tools/seed/world.mjs'; import { ref } from './tools/seed/apply.mjs';
       const id = WORLDS.default.docs[0].id; console.log(JSON.stringify(id) === JSON.stringify(ref('demo')) ? 'ok' : 'bad:' + JSON.stringify(id));`],
      { cwd: dir, encoding: 'utf8' }).trim();
  } catch (error) {
    return `threw: ${error.stderr || error.message}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** With the house's build.mjs + apply.mjs beside `world`, run `build.mjs default` with no emulator env: which applier ran? */
function whichApplierRuns(world) {
  const dir = mkdtempSync(join(tmpdir(), 'seed-own-'));
  try {
    mkdirSync(join(dir, 'tools/seed'), { recursive: true });
    writeFileSync(join(dir, 'tools/seed/world.mjs'), world);
    for (const [f, tpl] of [['build.mjs', 'seed-build.mjs.tpl'], ['apply.mjs', 'seed-apply.mjs.tpl']]) {
      writeFileSync(join(dir, 'tools/seed', f), readFileSync(join(PAYLOAD, 'src/generators/firebase-emulators', tpl), 'utf8'));
    }
    const env = { ...process.env };
    for (const k of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'GCLOUD_PROJECT']) delete env[k];
    // Port 1 refuses at once: the world's own applier (localhost fallbacks) fails on fetch; the house's refuses first.
    env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:1';
    try {
      execFileSync(process.execPath, ['tools/seed/build.mjs', 'default'], { cwd: dir, env, encoding: 'utf8', stdio: 'pipe' });
      return 'no';
    } catch (error) {
      return String(error.stderr).includes('refusing to guess') ? 'house' : 'world';
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export default {
  name: '0.50.0 · split-seed-applier',
  ladder: ['0.50.0/split-seed-applier'],
  cases: [
    {
      name: 'stock 0.49 world: becomes exactly the 0.50 seeded world.mjs; apply.mjs + build.mjs written; it loads',
      setup: (tree) => tree.write(WORLD, stock),
      // The template shipped two shapes before 0.50 (0d09453 first, 5a05026 → 8ec2259 → 0.49 the stock fixture); the
      // applier section, the header and the markers the rung keys on are byte-identical in both. They differ in one
      // worlds-section comment line the rung does not own, which is the project's from then on.
      historicalShapes: [
        {
          // git show 0d09453:plugins/project-starter/skills/new-project/assets/nx-tools/src/generators/firebase-emulators/seed-world.mjs.tpl
          name: 'first release of the template (0d09453)',
          diverges: 'its worlds-section comment still names `firebase/project.json` (changed by 5a05026); the rung never touches the worlds',
          setup: (tree) =>
            tree.write(WORLD, stock.replace(
              '//                                    to it, a `reset:<name>` target on the `firebase` project.',
              '//                                    to it, a `reset:<name>` target in firebase/project.json.',
            )),
          expect: (tree, t) => {
            t.ok(t.read(WORLD) === current.replace('target on the `firebase` project.', 'target in firebase/project.json.'),
              `the 0d09453 world did not land on the 0.50 seed (modulo its own comment):\n${t.read(WORLD)}`);
            t.ok(worldsLoad(tree) === 'ok', 'the migrated 0d09453 world does not load');
          },
        },
      ],
      expect: (tree, t) => {
        t.ok(t.read(WORLD) === current, 'the migrated stock world differs from what 0.50 seeds');
        t.hasNot(WORLD, BANNER);
        t.hasNot(WORLD, 'async function');
        t.hasNot(WORLD, 'localhost:8080');
        t.hasNot(WORLD, 'export const ref');
        t.hasNot(WORLD, "talks to the emulators' REST APIs");
        t.occurrences(WORLD, "import { ref, at } from './apply.mjs';", 1);
        t.has(WORLD, "demo: { email: 'demo@demo.test', name: 'Demo' }");
        t.has(WORLD, "const CREATED_AT = '2026-01-01T00:00:00.000Z';");
        t.has('tools/seed/apply.mjs', 'export async function applyWorld');
        t.has('tools/seed/apply.mjs', "!project && 'GCLOUD_PROJECT'");
        t.has('tools/seed/build.mjs', "from './apply.mjs'");
        t.ok(!/\n\n\n/.test(t.read(WORLD)), 'left a run of blank lines behind');
        const loaded = worldsLoad(tree);
        t.ok(loaded === 'ok', `the migrated world does not load: ${loaded}`);
      },
    },
    {
      name: 'a formatter-rewritten stock world (no semicolons, no trailing commas, double quotes, a comment): still stock',
      setup: (tree) =>
        tree.write(
          WORLD,
          stock
            .replace(/;$/gm, '')
            .replace(/,(\n\s*[)\]}])/g, '$1')
            .replaceAll("'Content-Type': 'application/json'", '"Content-Type": "application/json"')
            .replace("if (value === null) return { nullValue: null }", "// nulls first\n  if (value === null) return { nullValue: null }"),
        ),
      expect: (tree, t) => {
        t.hasNot(WORLD, BANNER);
        t.hasNot(WORLD, 'const AUTH_HOST');
        t.hasNot(WORLD, 'const FS_HOST');
        t.hasNot(WORLD, 'const PROJECT');
        t.hasNot(WORLD, 'export const ref');
        t.occurrences(WORLD, "import { ref, at } from './apply.mjs';", 1);
        const loaded = worldsLoad(tree);
        t.ok(loaded === 'ok', `the migrated world does not load: ${loaded}`);
      },
    },
    {
      name: "the project's own worlds and header around a stock applier: only the applier side changes",
      setup: (tree) =>
        tree.write(
          WORLD,
          stock
            .replace(/^\/\/ The seed worlds[\s\S]*?\n\/\/\n/, '// Our worlds — mirrors the coaching schema.\n//\n')
            .replace("demo: { email: 'demo@demo.test', name: 'Demo' },", "coach: { email: 'shir@coach.test', name: 'Shir' },\n      demo: { email: 'demo@demo.test', name: 'Demo' },"),
        ),
      expect: (tree, t) => {
        t.has(WORLD, '// Our worlds — mirrors the coaching schema.');
        t.has(WORLD, "coach: { email: 'shir@coach.test', name: 'Shir' }");
        t.hasNot(WORLD, BANNER);
        t.occurrences(WORLD, "from './apply.mjs'", 1);
      },
    },
    {
      name: 'a world that reads PROJECT keeps it (reported); the unused hosts still go',
      setup: (tree) => {
        recordWarnings();
        tree.write(WORLD, stock.replace("fields: { displayName: 'Demo',", "fields: { displayName: 'Demo', project: PROJECT,"));
      },
      expect: (tree, t) => {
        t.has(WORLD, "const PROJECT = process.env.GCLOUD_PROJECT || 'demo-acme';");
        t.hasNot(WORLD, 'const AUTH_HOST');
        t.hasNot(WORLD, 'const FS_HOST');
        t.ok(warnings.some((w) => w.includes('kept PROJECT')), `no report of the kept constant: ${warnings.join(' | ')}`);
      },
    },
    {
      name: 'customised applier: left byte-identical, reported',
      setup: (tree) => {
        recordWarnings();
        tree.write(WORLD, stock.replace("if (value === null) return { nullValue: null };", "if (value === null) return { nullValue: null };\n  if (value instanceof Date) return { timestampValue: value.toISOString() };"));
      },
      expect: (tree, t) => {
        t.has(WORLD, 'value instanceof Date');
        t.has(WORLD, BANNER);
        t.missing('tools/seed/apply.mjs');
        t.ok(warnings.some((w) => w.includes('customised seed applier') && w.includes('keeps running')), `no report: ${warnings.join(' | ')}`);
        // The generator then writes the house build.mjs + apply.mjs: build.mjs must run the world's OWN applier.
        const ran = whichApplierRuns(t.read(WORLD));
        t.ok(ran === 'world', `build.mjs ran the ${ran} applier, not the world's own`);
      },
    },
    {
      name: 'already split: untouched',
      setup: (tree) => tree.write(WORLD, "import { ref } from './apply.mjs';\nexport const WORLDS = { default: { accounts: {}, docs: [] } };\n"),
      expect: (tree, t) => {
        t.ok(t.read(WORLD) === "import { ref } from './apply.mjs';\nexport const WORLDS = { default: { accounts: {}, docs: [] } };\n", 'changed');
        t.missing('tools/seed/apply.mjs');
      },
    },
    {
      name: 'CRLF line endings: recognised, and kept',
      setup: (tree) => tree.write(WORLD, stock.replace(/\n/g, '\r\n')),
      expect: (tree, t) => {
        t.hasNot(WORLD, BANNER);
        t.has(WORLD, "import { ref, at } from './apply.mjs';\r\n");
        t.ok(!/[^\r]\n/.test(t.read(WORLD)), 'mixed line endings');
      },
    },
    {
      name: 'no seed tooling: nothing written',
      setup: () => {},
      expect: (tree, t) => {
        t.missing(WORLD);
        t.missing('tools/seed/apply.mjs');
      },
    },
  ],
};
