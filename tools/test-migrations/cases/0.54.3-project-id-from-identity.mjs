// 0.54.3 — only the id 0.54.2 seeded under create-nx-workspace's package name moves.
const CONFIG = 'supabase/config.toml';
const config = (id) => `# mine\nproject_id = "${id}"\n\n[db]\nmajor_version = 17\n`;
const shaped = (tree, id, name) => {
  tree.write(CONFIG, config(id));
  if (name) tree.write('package.json', JSON.stringify({ name }));
};
const left = (id) => (tree, t) => t.ok(t.read(CONFIG) === config(id), `byte-identical:\n${t.read(CONFIG)}`);

export default {
  name: '0.54.3 · project-id-from-identity',
  ladder: ['0.54.3/project-id-from-identity'],
  cases: [
    {
      name: 'the seeded `source` under `@x/source` becomes the identity, and only that line moves',
      setup: (tree) => shaped(tree, 'source', '@visi/source'),
      expect: (tree, t, logs) => {
        const id = /^project_id = "(.*)"$/m.exec(t.read(CONFIG))?.[1];
        t.ok(id && id !== 'source', `renamed: ${id}`);
        t.ok(t.read(CONFIG) === config(id), `only that line:\n${t.read(CONFIG)}`);
        t.ok(logs.some((l) => l.includes('project_id') && l.includes(id)), `named in the log: ${logs.join(' | ')}`);
      },
    },
    { name: 'an id someone chose stays', setup: (tree) => shaped(tree, 'visi', '@visi/source'), expect: left('visi') },
    { name: 'a package really called source stays', setup: (tree) => shaped(tree, 'source', 'source'), expect: left('source') },
    { name: 'another scoped package stays', setup: (tree) => shaped(tree, 'source', '@visi/app'), expect: left('source') },
    { name: 'no package.json stays', setup: (tree) => { shaped(tree, 'source'); tree.delete('package.json'); }, expect: left('source') },
    { name: 'no Supabase: nothing', setup: (tree) => tree.write('package.json', JSON.stringify({ name: '@visi/source' })), expect: (tree, t) => t.ok(!tree.exists(CONFIG), 'nothing written') },
  ],
};
