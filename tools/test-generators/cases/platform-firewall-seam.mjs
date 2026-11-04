// THE PLATFORM FIREWALL IS NEUTRAL — any capability that brings a second platform may ask for it, and a stack with no
// Firebase port still classifies. Firebase's own use of the seam is covered by cases/platform.mjs.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace, SCOPE } from '../workspaces.mjs';

const { writeJson, getProjects, readJson } = requireFromRepo('@nx/devkit');

const ESLINT = `import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  {
    files: ['**/*.ts'],
    rules: {
      '@nx/enforce-module-boundaries': ['error', { depConstraints: [{ sourceTag: '*', onlyDependOnLibsWithTags: ['*'] }] }],
    },
  },
];
`;
const WHO = 'a-server-capability';
const lib = (tree, root, text) => {
  writeJson(tree, `${root}/project.json`, { name: root.split('/').pop(), root, projectType: 'library' });
  tree.write(`${root}/src/index.ts`, text);
};
const tags = (tree, name) => getProjects(tree).get(name)?.tags ?? [];
const seam = (ctx) => ctx.load('platform/index');
/** The ban lists the config declares, read back the way the classifier reads them. */
const bans = (tree, ctx) => ctx.load('platform/firewall').readDeclaredBans(tree.read('eslint.config.mjs', 'utf8'), 'eslint.config.mjs');

const DRIVERS = ['pg', 'pg-native', 'pg-pool', 'pg-cursor', 'pg-query-stream', 'pg-promise', 'postgres', 'slonik'];
// Each of these runs in a browser, or a shared schema honestly imports it: banning one would be a false fact.
const BROWSER_CAPABLE = ['@supabase/supabase-js', '@electric-sql/pglite', '@prisma/client', 'knex', 'kysely', 'drizzle-orm', '@neondatabase/serverless'];

// The table as 0.51.3 released it: what every existing firewall was written from.
const RELEASED_SERVER = ['firebase-admin', 'firebase-admin/*', 'firebase-functions', 'firebase-functions/*', 'firebase-functions-test', 'firebase-functions-test/*', '@google-cloud/*', 'express', 'express/*'];
const RELEASED_WEB = ['firebase', 'firebase/*', '@firebase/*', 'rxfire', 'rxfire/*'];
// Each stack's own list as released. A firewall meets a stack once, so a list that moves reaches no existing firewall without a rung.
const RELEASED_STACK_BANS = { angular: ['@angular/*'], js: [] };
// Each rung that adds to an existing firewall, with what it adds. An addition to the table owes one.
const BAN_RUNGS = ['migrations/0.52.0/ban-postgres-drivers-from-web'];
/** A workspace that gained a firewall before it wore Angular, and the same one wearing it now. */
const firewallBeforeAngular = (ctx, tree, edit = (source) => source) => {
  tree.write('eslint.config.mjs', ESLINT);
  seam(ctx).ensurePlatformFirewall(tree, WHO);
  tree.write('eslint.config.mjs', edit(tree.read('eslint.config.mjs', 'utf8')));
  writeJson(tree, 'package.json', { ...readJson(tree, 'package.json'), devDependencies: { ...readJson(tree, 'package.json').devDependencies, '@nx/angular': '23.1.0' } });
};
const STOCK_FIREWALL = join(dirname(fileURLToPath(import.meta.url)), '../../test-migrations/cases/0.52.0-stock-firewall/eslint.config.mjs');

export default {
  name: 'platform firewall · a neutral seam',
  cases: [
    {
      name: 'an ESLint config under another name: no firewall, and the log says so, with what to paste',
      setup: () => workspace(),
      run: (tree, ctx) => {
        tree.write('eslint.config.js', ESLINT);
        seam(ctx).ensurePlatformFirewall(tree, WHO);
      },
      expect: (tree, t, ctx) => {
        t.ok(tree.read('eslint.config.js', 'utf8') === ESLINT, 'left as it is');
        t.ok(ctx.logs.some((l) => l.includes(`[${WHO}] No platform firewall`) && l.includes('eslint.config.js') && l.includes('platformConstraints')), `said so: ${ctx.logs.join(' | ')}`);
      },
    },
    {
      name: 'no ESLint config at all: nothing to write into, and nothing said',
      setup: () => workspace(),
      run: (tree, ctx) => seam(ctx).ensurePlatformFirewall(tree, WHO),
      expect: (tree, t, ctx) => t.ok(!ctx.logs.some((l) => l.includes('No platform firewall')), 'silent'),
    },
    {
      // The firewall is project state, so the table reaches only a workspace gaining one. An edit to it with no rung
      // leaves every existing project behind, silently, and each rung freezes its own list, so nothing else compares them.
      name: 'the table is what was released plus what the rungs add: a table that moves without a rung is red',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        tree.write('eslint.config.mjs', readFileSync(STOCK_FIREWALL, 'utf8'));
        for (const rung of BAN_RUNGS) await ctx.load(rung).default(tree);
      },
      expect: (tree, t, ctx) => {
        const table = ctx.load('platform/externals').tableExternals([]);
        const added = BAN_RUNGS.flatMap((rung) => ctx.load(rung).DRIVER_BANS);
        const message = 'the table moved: existing firewalls need a rung (src/migrations) carrying the change; add it to BAN_RUNGS';
        t.equal([...table.server], [...RELEASED_SERVER, ...added], message);
        t.equal([...table.web], RELEASED_WEB, message);
        // …and a migrated firewall bans exactly what a new one does, in the same order.
        const fw = ctx.load('platform/firewall');
        const fresh = fw.readDeclaredBans(fw.insertPlatformFirewall(ESLINT, 'eslint.config.mjs', ctx.load('platform/externals').tableExternals(['@angular/*']), 'yarn nx').source, 'eslint.config.mjs');
        t.equal(bans(tree, ctx), fresh, 'a migrated firewall and a new one agree');
      },
    },
    {
      name: 'a stack\'s own list that moves without a rung is red',
      once: 'compares two constants',
      setup: () => workspace(),
      run: () => {},
      expect: (tree, t, ctx) => {
        const lists = Object.fromEntries(ctx.load('adapters/registry').ADAPTERS.map((stack) => [stack.id, [...stack.webOnlyImports]]));
        t.equal(lists, RELEASED_STACK_BANS, 'a stack moved its webOnlyImports: existing firewalls need a rung carrying the change. A new stack: add it here');
      },
    },
    {
      name: 'an existing firewall meets a later stack: its bans join server and shared, once, and what the project added stays',
      once: 'two generator runs across a stack arriving',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        firewallBeforeAngular(ctx, tree, (source) => source.replace("'rxfire/*',", "'rxfire/*',\n      'my-native-thing',"));
        ctx.before = tree.read('eslint.config.mjs', 'utf8');
        ctx.mark = ctx.logs.length;
        seam(ctx).ensurePlatformFirewall(tree, WHO);
        ctx.once = tree.read('eslint.config.mjs', 'utf8');
        seam(ctx).ensurePlatformFirewall(tree, WHO);
      },
      expect: (tree, t, ctx) => {
        t.ok(!/@angular/.test(ctx.before), 'the fixture starts without it');
        const after = tree.read('eslint.config.mjs', 'utf8');
        t.equal(after, ctx.once, 'a second run changes nothing');
        const declared = bans(tree, ctx);
        t.ok(declared.server.includes('@angular/*') && declared.shared.includes('@angular/*'), 'server and shared ban it');
        t.ok(!declared.web.includes('@angular/*'), 'web does not');
        t.ok(declared.server.includes('my-native-thing'), "the project's addition stays");
        t.equal(after.replace(/^.*@angular.*\n/gm, '').replace(/^\/\/ House: this firewall.*\n/m, ''), ctx.before, 'and nothing else moved');
        t.ok(ctx.logs.slice(ctx.mark).some((l) => l.includes(`[${WHO}]`) && l.includes('@angular/*')), 'the log says what was added');
      },
    },
    {
      name: 'a ban the project removes after meeting a stack stays removed',
      once: 'three runs across a project edit',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        firewallBeforeAngular(ctx, tree);
        seam(ctx).ensurePlatformFirewall(tree, WHO);
        tree.write('eslint.config.mjs', tree.read('eslint.config.mjs', 'utf8').replace(/^.*'@angular\/\*'.*\n/gm, ''));
        seam(ctx).ensurePlatformFirewall(tree, WHO);
      },
      expect: (tree, t) => t.ok(!tree.read('eslint.config.mjs', 'utf8').includes("'@angular/*'"), 'not put back'),
    },
    {
      name: 'a wider pattern of the project\'s already covers a stack\'s ban, and the stack still counts as met',
      once: 'two runs across a stack arriving',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        firewallBeforeAngular(ctx, tree, (source) => source.replaceAll("'rxfire/*',", "'rxfire/*',\n      '@angular*',"));
        seam(ctx).ensurePlatformFirewall(tree, WHO);
      },
      expect: (tree, t, ctx) => {
        t.ok(!tree.read('eslint.config.mjs', 'utf8').includes("'@angular/*'"), 'nothing added');
        t.equal(ctx.load('platform/firewall').recordedStacks(tree.read('eslint.config.mjs', 'utf8')), ['angular']);
      },
    },
    {
      name: 'a firewall arriving with a stack already worn starts having met it, so asking again changes nothing',
      setup: () => {
        const tree = workspace();
        tree.write('eslint.config.mjs', ESLINT);
        writeJson(tree, 'package.json', { ...readJson(tree, 'package.json'), devDependencies: { ...readJson(tree, 'package.json').devDependencies, '@nx/angular': '23.1.0' } });
        return tree;
      },
      run: (tree, ctx) => seam(ctx).ensurePlatformFirewall(tree, WHO),
      expect: (tree, t, ctx) => {
        const source = tree.read('eslint.config.mjs', 'utf8');
        t.equal(ctx.load('platform/firewall').recordedStacks(source), ['angular']);
        t.ok(/House: this firewall.*\nconst platformConstraints/.test(source), 'recorded directly above the constraints');
      },
    },
    {
      name: 'a stack with nothing to ban leaves an existing firewall alone, byte for byte',
      once: 'two runs across a stack arriving',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        tree.write('eslint.config.mjs', ESLINT);
        seam(ctx).ensurePlatformFirewall(tree, WHO);
        ctx.before = tree.read('eslint.config.mjs', 'utf8');
        writeJson(tree, 'package.json', { ...readJson(tree, 'package.json'), devDependencies: { ...readJson(tree, 'package.json').devDependencies, '@nx/js': '23.1.0' } });
        seam(ctx).ensurePlatformFirewall(tree, WHO);
      },
      expect: (tree, t, ctx) => t.equal(tree.read('eslint.config.mjs', 'utf8'), ctx.before),
    },
    {
      name: 'a firewall whose lists are computed is left, and told what to ban by hand on every run until it is met',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        firewallBeforeAngular(ctx, tree, () => "const platformConstraints = build();\nexport default [];\n");
        seam(ctx).ensurePlatformFirewall(tree, WHO);
      },
      expect: (tree, t, ctx) => {
        t.equal(tree.read('eslint.config.mjs', 'utf8'), "const platformConstraints = build();\nexport default [];\n");
        t.ok(ctx.logs.some((l) => /was left as it is/.test(l) && l.includes('@angular/*') && l.includes('platform:server')), ctx.logs.join(' | '));
      },
    },
    {
      name: 'a capability that is not Firebase gets the whole firewall: drivers banned from web and shared, projects classified, sync registered',
      setup: () => {
        const tree = workspace();
        tree.write('eslint.config.mjs', ESLINT);
        lib(tree, 'packages/db', "import { Pool } from 'pg';\nexport const pool = new Pool();\n");
        lib(tree, 'packages/rows', "import postgres from 'postgres/cf/src/index.js';\nexport const sql = postgres();\n");
        lib(tree, 'packages/blank', 'export const x = 1;\n');
        return tree;
      },
      run: async (tree, ctx) => seam(ctx).ensurePlatformFirewall(tree, WHO),
      expect: (tree, t, ctx) => {
        t.ok(seam(ctx).hasPlatformFirewall(tree.read('eslint.config.mjs', 'utf8')), 'the firewall is in the config');
        const declared = bans(tree, ctx);
        for (const driver of DRIVERS) {
          t.ok(declared.web.includes(driver) && declared.web.includes(`${driver}/*`), `web bans ${driver} and its subpaths`);
          t.ok(declared.shared.includes(driver), `shared bans ${driver}`);
          t.ok(!declared.server.includes(driver), `server may use ${driver}`);
        }
        t.equal(tags(tree, 'db'), ['platform:server'], 'pg is server evidence');
        t.equal(tags(tree, 'rows'), ['platform:server'], 'a postgres subpath is server evidence');
        t.equal(tags(tree, 'blank'), [], 'a project with no evidence is left for a human');
        t.ok(readJson(tree, 'nx.json').sync?.globalGenerators?.includes('@bespunky/nx-tools:platform-sync'), 'the sync generator is registered');
        t.ok(!tree.exists('firebase.json'), 'nothing of Firebase arrived with it');
        t.ok(!/Cloud Functions/.test(tree.read('eslint.config.mjs', 'utf8')), 'the generated comment names no vendor');
        t.ok(ctx.logs.some((line) => line.includes(`[${WHO}]`)), `the log says who asked:\n${ctx.logs.join('\n')}`);
      },
    },
    {
      name: 'HOUSE.md describes the firewall wherever the config carries one, Firebase or not, and promises none where it does not',
      setup: () => {
        const tree = workspace();
        tree.write('eslint.config.mjs', ESLINT);
        return tree;
      },
      run: async (tree, ctx) => {
        const doc = () => ctx.load('generators/house-doc/generator').default(tree, { layers: ['nx', 'agent'], nxToolsVersion: '9.9.9', pluginVersion: '9.9.9' });
        await doc();
        ctx.before ??= tree.read('HOUSE.md', 'utf8'); // the harness runs this twice: the first one is the no-firewall doc
        seam(ctx).ensurePlatformFirewall(tree, WHO);
        await doc();
      },
      expect: (tree, t, ctx) => {
        t.ok(!ctx.before.includes('Platform firewall'), 'no firewall in the config, none in the doc');
        const after = tree.read('HOUSE.md', 'utf8');
        t.ok(after.includes('**Platform firewall (ESLint-enforced, fail-closed):**'), 'a capability that is not Firebase gets the section');
        t.ok(!after.includes('{{'), 'nothing left unrendered');
      },
    },
    {
      name: 'a package that runs in a browser is not banned: the table states facts about packages',
      setup: () => {
        const tree = workspace();
        tree.write('eslint.config.mjs', ESLINT);
        return tree;
      },
      run: async (tree, ctx) => seam(ctx).ensurePlatformFirewall(tree, WHO),
      expect: (tree, t, ctx) => {
        const declared = bans(tree, ctx);
        for (const pkg of BROWSER_CAPABLE) t.ok(![...declared.web, ...declared.server, ...declared.shared].includes(pkg), `${pkg} is bound to no platform`);
      },
    },
    {
      name: 'a second capability asking changes nothing, and an existing firewall is project state',
      setup: () => {
        const tree = workspace();
        tree.write('eslint.config.mjs', ESLINT);
        return tree;
      },
      run: async (tree, ctx) => {
        seam(ctx).ensurePlatformFirewall(tree, WHO);
        // The project narrows its own firewall; another capability arrives; Firebase's generator asks too.
        const before = tree.read('eslint.config.mjs', 'utf8');
        const owned = before.includes('acme-own-ban') ? before : before.replace("'pg-promise',", "'pg-promise', 'acme-own-ban',");
        tree.write('eslint.config.mjs', owned);
        seam(ctx).ensurePlatformFirewall(tree, 'another-capability');
        await ctx.load('generators/firebase-emulators/generator').default(tree, { workspaceName: SCOPE });
        ctx.owned = owned;
      },
      expect: (tree, t, ctx) => t.equal(tree.read('eslint.config.mjs', 'utf8'), ctx.owned, 'neither asker touched it'),
    },
    {
      name: 'no root flat config: nothing happens, and nothing is classified',
      setup: () => {
        const tree = workspace();
        lib(tree, 'packages/db', "import { Pool } from 'pg';\n");
        return tree;
      },
      run: async (tree, ctx) => seam(ctx).ensurePlatformFirewall(tree, WHO),
      expect: (tree, t) => {
        t.ok(!tree.exists('eslint.config.mjs'), 'no config is invented');
        t.equal(tags(tree, 'db'), [], 'a classification nothing enforces is not written');
        t.ok(!readJson(tree, 'nx.json').sync, 'no sync generator');
      },
    },
    {
      name: 'a config it cannot edit: left alone, and the log carries the reason and the snippet',
      setup: () => {
        const tree = workspace();
        tree.write('eslint.config.mjs', 'export default makeConfig();\n');
        return tree;
      },
      run: async (tree, ctx) => seam(ctx).ensurePlatformFirewall(tree, WHO),
      expect: (tree, t, ctx) => {
        t.equal(tree.read('eslint.config.mjs', 'utf8'), 'export default makeConfig();\n', 'untouched');
        const warning = ctx.logs.join('\n');
        t.ok(warning.includes(`[${WHO}] Did not insert the platform firewall`) && warning.includes('platformConstraints'), `reason and snippet:\n${warning}`);
      },
    },
    {
      name: 'a stack with no Firebase port still classifies: its web-only imports are its own',
      setup: () => {
        const tree = workspace();
        tree.write('eslint.config.mjs', ESLINT);
        lib(tree, 'packages/view', "import { render } from 'acme-framework/dom';\nexport const r = render;\n");
        return tree;
      },
      run: async (tree, ctx) => {
        const { ADAPTERS } = ctx.load('adapters/registry');
        const stack = { id: 'acme', layer: 'nx', ownsProject: () => false, executors: [], platform: 'web', webOnlyImports: ['acme-framework', 'acme-framework/*'] };
        ADAPTERS.push(stack);
        try {
          seam(ctx).ensurePlatformFirewall(tree, WHO);
        } finally {
          ADAPTERS.pop();
        }
      },
      expect: (tree, t, ctx) => {
        t.equal(tags(tree, 'view'), ['platform:web'], "the stack's package is web evidence");
        t.ok(bans(tree, ctx).server.includes('acme-framework'), 'the firewall bans it from server code');
      },
    },
  ],
};
