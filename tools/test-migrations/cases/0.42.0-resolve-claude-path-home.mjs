// 0.42.0 — `${containerEnv:HOME}/.local/bin` (empty HOME → `/.local/bin`) becomes the declared user's home.
//
// The shapes it meets: the node-layer PATH 0.40.0 wrote (owned, remoteUser node), the agent-only PATH (vscode),
// an adopted devcontainer on its own image declaring containerUser root, one declaring no user (reported), and
// a PATH of the project's own that merely mentions the variable later on (not the house's — untouched).
const DC = '.devcontainer/devcontainer.json';
const BROKEN = '${containerEnv:HOME}/.local/bin';
const NODE_TAIL = '${containerWorkspaceFolder}/node_modules/.bin:${containerEnv:PATH}';

const file = (user, path) => `{
  // Comment kept.
  "image": "x",
${user}  "remoteEnv": {
    "PATH": "${path}",
    "CHOKIDAR_USEPOLLING": "true"
  }
}
`;

const BROKEN_FILE = `{ "remoteUser": "node", "remoteEnv": { "PATH": "${BROKEN}:\${containerEnv:PATH}" `;

export default {
  name: '0.42.0 · resolve-claude-path-home',
  ladder: ['0.42.0/resolve-claude-path-home'],
  cases: [
    {
      name: 'node layer, remoteUser node: the first entry becomes /home/node/.local/bin, the rest kept',
      setup: (tree) => tree.write(DC, file('  "remoteUser": "node",\n', `${BROKEN}:${NODE_TAIL}`)),
      expect: (tree, t) => {
        t.has(DC, `"/home/node/.local/bin:${NODE_TAIL}"`);
        t.hasNot(DC, 'containerEnv:HOME');
        t.has(DC, '// Comment kept.');
        t.has(DC, '"CHOKIDAR_USEPOLLING": "true"');
      },
    },
    {
      name: 'agent only, remoteUser vscode',
      setup: (tree) => tree.write(DC, file('  "remoteUser": "vscode",\n', `${BROKEN}:\${containerEnv:PATH}`)),
      expect: (tree, t) => t.has(DC, '"/home/vscode/.local/bin:${containerEnv:PATH}"'),
    },
    {
      name: 'containerUser root (no remoteUser): /root/.local/bin',
      setup: (tree) => tree.write(DC, file('  "containerUser": "root",\n', `${BROKEN}:\${containerEnv:PATH}`)),
      expect: (tree, t) => t.has(DC, '"/root/.local/bin:${containerEnv:PATH}"'),
    },
    {
      name: 'no user declared: left in place (and reported)',
      setup: (tree) => tree.write(DC, file('', `${BROKEN}:\${containerEnv:PATH}`)),
      expect: (tree, t) => t.has(DC, `"${BROKEN}:\${containerEnv:PATH}"`),
    },
    {
      name: "the project's own PATH that mentions the variable later is not the house's: untouched",
      setup: (tree) => tree.write(DC, file('  "remoteUser": "node",\n', `/opt/ours/bin:${BROKEN}:\${containerEnv:PATH}`)),
      expect: (tree, t) => t.has(DC, `"/opt/ours/bin:${BROKEN}:\${containerEnv:PATH}"`),
    },
    {
      name: 'unparseable devcontainer.json: left exactly as it is (and reported)',
      setup: (tree) => {
        tree.write(DC, BROKEN_FILE);
        
      },
      expect: (tree, t) => t.ok(tree.read(DC, 'utf8') === BROKEN_FILE, 'a file that does not parse was edited'),
    },
    {
      name: 'no devcontainer: nothing to do',
      setup: () => {},
      expect: (tree, t) => t.missing(DC),
    },
  ],
};
