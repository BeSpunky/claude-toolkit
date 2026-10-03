// 0.39.0 — the `bespunky-project-starter` plugin is now `bespunky-house`.
//
// The shapes it meets: the house settings.json as the claude-settings generator wrote it (the old key among the
// other house plugins, the project's own keys around it), one where the project had DISABLED the plugin, one
// where an earlier run already added the new key beside the old, a machine-local settings.local.json, a file
// that does not parse, and a project that never had the plugin.
const S = '.claude/settings.json';
const L = '.claude/settings.local.json';
const OLD = 'bespunky-project-starter@claude-toolkit';
const NEW = 'bespunky-house@claude-toolkit';

const HOUSE = `{
  "extraKnownMarketplaces": {
    "claude-toolkit": {
      "source": {
        "source": "github",
        "repo": "BeSpunky/claude-toolkit"
      },
      "autoUpdate": true
    }
  },
  "enabledPlugins": {
    "bespunky@claude-toolkit": true,
    "${OLD}": true,
    "bespunky-engineering@claude-toolkit": true,
    "our-own@elsewhere": true
  },
  "hooks": {
    "Stop": []
  }
}
`;

const settingsOf = (tree, path) => JSON.parse(tree.read(path, 'utf8'));

export default {
  name: '0.39.0 · rename-house-plugin',
  ladder: ['0.39.0/rename-house-plugin'],
  cases: [
    {
      name: 'house settings.json: the key is renamed in place, everything else byte-identical',
      setup: (tree) => tree.write(S, HOUSE),
      expect: (tree, t) => {
        t.hasNot(S, OLD);
        t.ok(tree.read(S, 'utf8') === HOUSE.replace(`"${OLD}"`, `"${NEW}"`), 'only the key changed');
        const keys = Object.keys(settingsOf(tree, S).enabledPlugins);
        t.ok(keys.indexOf(NEW) === 1, `the new key keeps the old one's position: ${keys.join(', ')}`);
      },
    },
    {
      name: "a project that disabled the plugin keeps it disabled under the new name",
      setup: (tree) => tree.write(S, `{ "enabledPlugins": { "${OLD}": false } }\n`),
      expect: (tree, t) => {
        t.hasNot(S, OLD);
        t.ok(settingsOf(tree, S).enabledPlugins[NEW] === false, 'the value was not kept');
      },
    },
    {
      name: 'new key already present: the old one is removed, the new value wins, nothing duplicated',
      setup: (tree) =>
        tree.write(S, `{\n  "enabledPlugins": {\n    "${OLD}": false,\n    "${NEW}": true,\n    "x@y": true\n  }\n}\n`),
      expect: (tree, t) => {
        t.hasNot(S, OLD);
        t.occurrences(S, NEW, 1);
        const plugins = settingsOf(tree, S).enabledPlugins;
        t.ok(plugins[NEW] === true && plugins['x@y'] === true, `unexpected result: ${JSON.stringify(plugins)}`);
      },
    },
    {
      name: 'settings.local.json is renamed too',
      setup: (tree) => {
        tree.write(S, HOUSE);
        tree.write(L, `{\n  // mine\n  "enabledPlugins": { "${OLD}": true }\n}\n`);
      },
      expect: (tree, t) => {
        t.hasNot(S, OLD);
        t.hasNot(L, OLD);
        t.has(L, `"${NEW}": true`);
        t.has(L, '// mine');
      },
    },
    {
      name: 'an unparseable settings.json is left untouched (and reported)',
      setup: (tree) => tree.write(S, `{ "enabledPlugins": { "${OLD}": true `),
      expect: (tree, t) => t.has(S, OLD),
    },
    {
      name: 'the old name outside enabledPlugins is not ours to rewrite (reported)',
      setup: (tree) => tree.write(S, `{ "permissions": { "allow": ["Skill(${OLD})"] } }\n`),
      expect: (tree, t) => t.has(S, `Skill(${OLD})`),
    },
    {
      name: 'never had the plugin: nothing to do',
      setup: (tree) => tree.write(S, `{ "enabledPlugins": { "${NEW}": true } }\n`),
      expect: (tree, t) => {
        t.ok(tree.read(S, 'utf8') === `{ "enabledPlugins": { "${NEW}": true } }\n`, 'the file was changed');
        t.missing(L);
      },
    },
  ],
};
