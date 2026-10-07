# Firebase App Hosting configuration for this workspace.
# Reference: https://firebase.google.com/docs/app-hosting/configure
#
# All top-level keys are optional — App Hosting infers sensible defaults for Angular
# (framework-aware build/run commands, Cloud Run service sizing). Uncomment and override
# only what you need to. The starter file below ships intentionally empty so a fresh
# scaffold has no opinions you have to undo.
#
# Deploy flow (after `firebase login` + `firebase use --add`):
#   firebase apphosting:backends:create --project <projectId>     # one-time: creates the backend
# After that, App Hosting deploys are GitHub-driven (push to the configured branch).
# See the SKILL.md "Connect a real Firebase project" recipe in the project-starter
# new-project skill for the full flow.

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
