{
  "name": "functions",
  "description": "Cloud Functions deploy manifest. The source here has no node_modules of its own — local build/lint/emulate resolve from the workspace root. `nx build {{functionsProject}}` (@nx/esbuild:esbuild) bundles src/main.ts into {{functionsDist}}, emits a package.json there (merging these deps + the built `main` entry); Firebase deploys that dist output (firebase.json `functions.source`) and installs these dependencies in the cloud. Keep the firebase-admin/firebase-functions versions here aligned with the workspace root's, and engines.node with the project's .nvmrc (Cloud Functions' runtime — the house names any disagreement on every upgrade).",
  "main": "main.js",
  "engines": {
    "node": "{{functionsNodeMajor}}"
  },
  "dependencies": {
    "firebase-admin": "{{firebaseAdminVersion}}",
    "firebase-functions": "{{firebaseFunctionsVersion}}"
  },
  "private": true
}
