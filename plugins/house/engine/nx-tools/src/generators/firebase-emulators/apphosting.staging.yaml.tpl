# Firebase App Hosting — STAGING backend overrides.
# Merged OVER apphosting.yaml for the backend assigned the `staging` environment.
# https://firebase.google.com/docs/app-hosting/configure#environment-specific
#
# One-time binding (so this applies to the right backend): set the staging backend's Environment
# name to `staging` — Firebase console → App Hosting → the backend → Settings → Environment.
# There is no CLI flag for it (backends:create has none). Until it is set, the backend reads only
# apphosting.yaml and staging silently builds PRODUCTION's config. This file must sit beside the
# apphosting.yaml that backend reads (see that file's header).
#
# Why override the build: staging must swap in environment.staging.ts (which can target a
# `staging` Firestore database), so it can't use the framework-default (production) build.
# This runs the Angular `staging` build configuration (see the app's project.json); App
# Hosting's Angular adapter picks up its output exactly as it does the prod build.
scripts:
  buildCommand: npx nx build {{projectName}} --configuration=staging
