{
  "name": "functions",
  "description": "Cloud Functions deploy manifest. The source here has no node_modules of its own — local build/lint/emulate resolve from the workspace root. `nx build functions` (@nx/esbuild:esbuild) bundles src/main.ts into dist/apps/functions, emits a package.json there (merging these deps + the built `main` entry); Firebase deploys that dist output (firebase.json `functions.source`) and installs these dependencies in the cloud. Keep the firebase-admin/firebase-functions versions here aligned with the workspace root's.",
  "main": "main.js",
  "engines": {
    "node": "22"
  },
  "dependencies": {
    "firebase-admin": "^13.6.0",
    "firebase-functions": "^7.0.0"
  },
  "private": true
}
