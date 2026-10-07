# Firebase App Hosting configuration for this workspace.
# Reference: https://firebase.google.com/docs/app-hosting/configure
#
# All top-level keys are optional — App Hosting infers sensible defaults for Angular
# (framework-aware build/run commands, Cloud Run service sizing). Uncomment and override
# only what you need to. The starter file below ships intentionally empty so a fresh
# scaffold has no opinions you have to undo.
#
# WHERE THIS FILE IS READ FROM. App Hosting starts at the backend's Root Directory (for an Nx app:
# <appsDir>/<app>) and walks UP to the first directory holding any apphosting*.yaml — so this file
# applies to every backend rooted in or below its directory. apphosting.<env>.yaml overrides are
# read BESIDE it. Any apphosting*.yaml nearer to an app SHADOWS this one (and its overrides)
# for that app's backend; the house upgrade warns when it finds one.
#
# Deploying: ask Claude, or see the bespunky-house:firebase-app-hosting skill — create the backend
# with its Root Directory set to the app (an Nx build fails without it), then deploy either from
# GitHub (rollouts on push to the live branch) or from local source (firebase deploy).

# runConfig:
#   cpu: 1
#   memoryMiB: 512
#   minInstances: 0
#   maxInstances: 100
#   concurrency: 80

# env:
#   - variable: PUBLIC_VAR
#     value: "some-value"
#   # Secret Manager-backed secret (created via `firebase apphosting:secrets:set`):
#   - variable: SECRET_VAR
#     secret: my-secret

# scripts:
#   buildCommand: npm run build
#   runCommand: npm run start

# outputFiles:
#   serverApp:
#     include: ["dist", "package.json"]
