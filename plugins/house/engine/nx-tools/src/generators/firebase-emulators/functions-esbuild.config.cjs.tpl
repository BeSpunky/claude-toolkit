// The {{functionsProject}} build's esbuild options — GENERATOR-OWNED (rewritten on every upgrade); never edit it.
// Named by the build target's `esbuildConfig` ({{functionsRoot}}/project.json).
//
// It exists for one plugin: every build writes the Functions emulator's INERT `.secret.local` beside the bundle
// (tools/emulator-secrets.cjs), so a rebuild mid-session — or a raw `firebase emulators:start` — never leaves a
// declared secret for the emulator to fetch from Secret Manager. The file holds no secret: safe in the Nx cache, and
// firebase.json's `functions.ignore` (`*.local`) keeps it out of a deploy.
//
// Your own esbuild options: write a config of your own that spreads this one —
//   const house = require('<path to>/tools/functions-esbuild.config.cjs');
//   module.exports = { ...house, plugins: [...house.plugins, myPlugin], define: { … } };
// — and point the build target's `esbuildConfig` at it.
const path = require('node:path');
const { inertSecretsPlugin } = require('./emulator-secrets.cjs');

module.exports = {
  outExtension: { '.js': '.js' },
  plugins: [inertSecretsPlugin({ source: path.join(__dirname, '..', '{{functionsRoot}}') })],
};
