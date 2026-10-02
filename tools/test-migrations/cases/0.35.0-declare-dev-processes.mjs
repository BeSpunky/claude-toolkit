// 0.35.0 — `nx serve` becomes a wrapper over the stack-free engine; the declaration reproduces 0.34.x.
//
// The rung writes into someone's repo the ONLY description of what their dev loop runs. Wrong here is silent:
// a missing emulators process just means `nx serve` stops starting the suite, a wrong port means the worktree
// offset lands somewhere else. So the fixtures pin the exact 0.34.x behaviour, plus the edges: an app that is
// already declared, a non-Angular leaf in a Firebase workspace, the wrapper host, and a foreign `serve`.
import { createRequire } from 'node:module';

const { addProjectConfiguration, readProjectConfiguration, writeJson, readJson } = createRequire(import.meta.url)('@nx/devkit');

const SERVE = { executor: '@bespunky/nx-tools:serve', options: { buildTarget: 'web:build', host: '0.0.0.0' } };
const LEAF = { executor: '@angular/build:dev-server', options: { buildTarget: 'web:build', host: '0.0.0.0' } };

const app = (tree, name = 'web', targets = {}) =>
  addProjectConfiguration(tree, name, {
    root: `apps/${name}`,
    projectType: 'application',
    targets: { serve: { ...SERVE, options: { buildTarget: `${name}:build`, host: '0.0.0.0' } }, 'dev-server': LEAF, ...targets },
  });

const firebase = (tree, emulators = { auth: { port: 9099 }, firestore: { port: 8080 }, storage: { port: 9199 }, functions: { port: 5001 }, ui: { enabled: true, port: 4000 }, singleProjectMode: true }) => {
  writeJson(tree, 'firebase.json', { emulators });
  addProjectConfiguration(tree, 'firebase', { root: '.', targets: { emulators: { executor: 'nx:run-commands', options: { command: 'bash tools/emulators.sh' } } } });
};

const decl = (tree) => readJson(tree, '.bespunky/dev.json');

export default {
  name: '0.35.0 · declare-dev-processes',
  ladder: ['0.35.0/declare-dev-processes'],
  cases: [
    {
      name: 'an Angular app: the app process exactly as 0.34.x ran it, and the install step',
      setup: (tree) => {
        tree.write('yarn.lock', '');
        app(tree);
      },
      expect: (tree, t) => {
        const d = decl(tree);
        const [p] = d.apps.web.processes;
        t.ok(d.apps.web.processes.length === 1, `one process, got ${d.apps.web.processes.map((x) => x.id)}`);
        t.ok(JSON.stringify(p.cmd) === JSON.stringify(['node_modules/.bin/nx', 'run', 'web:dev-server', '--port=${PORT:app}']), `cmd ${JSON.stringify(p.cmd)}`);
        t.ok(p.ports.app === 4200 && p.primary === true, `ports/primary ${JSON.stringify(p)}`);
        t.ok(p.env.NX_DAEMON === 'false' && p.env.NX_WORKSPACE_ROOT_PATH === '${TREE}', `env ${JSON.stringify(p.env)}`);
        t.ok(JSON.stringify(d.install) === JSON.stringify({ cmd: ['yarn', 'install'], creates: 'node_modules' }), `install ${JSON.stringify(d.install)}`);
        t.ok(readProjectConfiguration(tree, 'web').targets.serve.executor === '@bespunky/nx-tools:serve', 'the serve target is unchanged');
      },
    },
    {
      // Only a hand edit between an interrupted sync and its re-run gets a declaration into this state — and it
      // must neither abort the whole ladder (JSON.parse threw) nor be overwritten: it is the project's file.
      name: 'a malformed existing .bespunky/dev.json: reported, left byte-for-byte, the ladder goes on',
      setup: (tree) => {
        app(tree);
        firebase(tree);
        tree.write('apps/web/proxy.conf.mjs', 'export default {};\n');
        tree.write('.bespunky/dev.json', '{ "apps": { "web": { "processes": [ \n');
      },
      expect: (tree, t) => {
        t.ok(tree.read('.bespunky/dev.json', 'utf8') === '{ "apps": { "web": { "processes": [ \n', 'the malformed declaration was rewritten');
        // The part that does not touch the declaration still happens.
        t.ok(readProjectConfiguration(tree, 'web').targets['dev-server'].options.proxyConfig, 'the proxy did not move onto the leaf');
      },
    },
    {
      name: 'a declaration with the wrong shape (processes not a list): reported, left alone',
      setup: (tree) => {
        app(tree);
        writeJson(tree, '.bespunky/dev.json', { apps: { web: { processes: 'npm start' } } });
      },
      expect: (tree, t) => {
        t.ok(decl(tree).apps.web.processes === 'npm start', 'the declaration was rewritten');
      },
    },
    {
      name: 'a Firebase workspace: the emulators process, its ports, URL switches and advice; the proxy moves onto the leaf',
      setup: (tree) => {
        app(tree);
        firebase(tree);
        tree.write('apps/web/proxy.conf.mjs', 'export default {};\n');
      },
      expect: (tree, t) => {
        const [, emu] = decl(tree).apps.web.processes;
        t.ok(emu?.id === 'emulators', `second process ${emu?.id}`);
        t.ok(JSON.stringify(emu.cmd) === JSON.stringify(['node_modules/.bin/nx', 'run', 'firebase:emulators']), `cmd ${JSON.stringify(emu.cmd)}`);
        const ports = Object.values(emu.ports);
        t.ok(Math.min(...ports) === 4000 && Math.max(...ports) === 9199, `ports span ${JSON.stringify(emu.ports)} (keeps the 6000 block)`);
        t.ok(emu.ports.hub === 4400 && emu.ports.logging === 4500, 'hub/logging, which emulators.sh pins, are declared');
        t.ok(!('singleProjectMode' in emu.ports), 'settings are not ports');
        t.ok(emu.url.some((u) => u.param === 'portOffset' && u.when === 'offset'), '?portOffset on a shifted stack');
        t.ok(emu.url.some((u) => u.param === 'emulate' && u.value === 'none' && u.when === 'skipped'), '?emulate=none when skipped');
        t.ok(emu.advice?.[0]?.when === 'contended', 'the OAuth-origin advice');
        t.ok(!emu.primary, 'the emulators are not the primary');
        t.ok(readProjectConfiguration(tree, 'web').targets['dev-server'].options.proxyConfig === 'apps/web/proxy.conf.mjs', 'proxyConfig on the leaf');
      },
    },
    {
      name: 'an app already declared keeps its processes; only the missing ones are added',
      setup: (tree) => {
        app(tree);
        firebase(tree);
        writeJson(tree, '.bespunky/dev.json', {
          apps: { web: { processes: [{ id: 'app', cmd: 'my own command ${PORT:app}', ports: { app: 4300 }, primary: true }] } },
        });
      },
      expect: (tree, t) => {
        const ps = decl(tree).apps.web.processes;
        t.ok(ps[0].cmd === 'my own command ${PORT:app}' && ps[0].ports.app === 4300, 'the hand-written process is untouched');
        t.ok(ps.map((p) => p.id).join() === 'app,emulators', `ids ${ps.map((p) => p.id)}`);
      },
    },
    {
      name: 'a non-Angular leaf in a Firebase workspace: proxy not wired, reported',
      setup: (tree) => {
        app(tree, 'web', { 'dev-server': { executor: '@nx/vite:dev-server', options: {} } });
        firebase(tree);
        tree.write('apps/web/proxy.conf.mjs', 'export default {};\n');
      },
      expect: (tree, t) => {
        t.ok(!readProjectConfiguration(tree, 'web').targets['dev-server'].options?.proxyConfig, 'no proxyConfig on a Vite leaf');
        t.ok(decl(tree).apps.web.processes.length === 2, 'still declared');
      },
    },
    {
      name: 'the wrapper host (no package.json): ./nx, and no install step',
      setup: (tree) => {
        tree.delete('package.json');
        app(tree);
      },
      expect: (tree, t) => {
        const d = decl(tree);
        t.ok(d.apps.web.processes[0].cmd[0] === './nx', `bin ${d.apps.web.processes[0].cmd[0]}`);
        t.ok(!d.install, 'no install step');
      },
    },
    {
      name: "a project's own serve (not the house composer): nothing declared",
      setup: (tree) =>
        addProjectConfiguration(tree, 'api', { root: 'services/api', targets: { serve: { executor: 'nx:run-commands', options: { command: 'uvicorn app:api' } } } }),
      expect: (tree, t) => t.missing('.bespunky/dev.json'),
    },
    {
      name: 'two served apps in a Firebase workspace: each declares its own process set',
      setup: (tree) => {
        app(tree, 'web');
        app(tree, 'admin');
        firebase(tree);
      },
      expect: (tree, t) => {
        const d = decl(tree);
        t.ok(d.apps.admin.processes[0].cmd.includes('admin:dev-server'), 'admin runs its own leaf');
        t.ok(d.apps.web.processes.length === 2 && d.apps.admin.processes.length === 2, 'both carry the suite');
      },
    },
  ],
};
