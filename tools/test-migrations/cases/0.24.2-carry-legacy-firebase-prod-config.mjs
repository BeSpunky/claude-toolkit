// 0.24.2 — the live production Firebase credentials a pre-environment-files project kept inline in
// firebase.config.ts are carried into environment.prod.ts before the generator rewrites the config.
//
// Where no environment.prod.ts exists, the rung renders the generator's CURRENT template — so it must fill that
// template's placeholders the way the generator does, the skill pointers included: the pointer only where the project
// enables bespunky-house, and never a `{{token}}` left verbatim.
const RUNG = '0.24.2/carry-legacy-firebase-prod-config';
const ENV = 'apps/web/src/environments/environment.prod.ts';

function legacyProject(tree, { house }) {
  tree.write('firebase.json', '{}');
  tree.write('apps/web/project.json', JSON.stringify({ name: 'web', root: 'apps/web', projectType: 'application' }));
  tree.write(
    'apps/web/src/app/firebase.config.ts',
    "export const productionFirebaseConfig = { projectId: 'live-id', apiKey: 'live-key', appId: 'live-app', authDomain: 'live.example.com' };\n",
  );
  const plugins = house ? { 'bespunky-house@claude-toolkit': true } : { 'bespunky@claude-toolkit': true };
  tree.write('.claude/settings.json', JSON.stringify({ enabledPlugins: plugins }));
}

const rendered = (house) => ({
  name: `no environment.prod.ts, bespunky-house ${house ? 'enabled' : 'not enabled'}: rendered from the template, values carried`,
  setup: (tree) => legacyProject(tree, { house }),
  expect: (tree, t) => {
    t.has(ENV, "projectId: 'live-id'");
    t.has(ENV, "authDomain: 'live.example.com'");
    t.has(ENV, 'and moving accounts — ask Claude');
    (house ? t.has : t.hasNot)(ENV, 'bespunky-house:firebase-app-hosting');
    t.ok(!/\{\{\w+\}\}/.test(t.read(ENV)), `no placeholder left verbatim: ${t.read(ENV).match(/\{\{\w+\}\}/)?.[0]}`);
  },
});

export default {
  name: '0.24.2 · carry-legacy-firebase-prod-config',
  ladder: [RUNG],
  cases: [rendered(true), rendered(false)],
};
