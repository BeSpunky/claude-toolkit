# Firebase App Hosting — STAGING backend overrides.
# Merged OVER apphosting.yaml for the backend assigned the `staging` environment.
# https://firebase.google.com/docs/app-hosting/configure#environment-specific
#
# One-time binding (so this applies to the right backend): give the staging backend the
# environment name `staging` — at create time:
#   firebase apphosting:backends:create ... --environment staging
# or set the backend's environment to `staging` in the Firebase console.
#
# Why override the build: staging must swap in environment.staging.ts (which can target a
# `staging` Firestore database), so it can't use the framework-default (production) build.
# This runs the Angular `staging` build configuration (see the app's project.json); App
# Hosting's Angular adapter picks up its output exactly as it does the prod build.
scripts:
  buildCommand: npx nx build {{projectName}} --configuration=staging
