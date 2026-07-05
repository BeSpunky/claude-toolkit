# Local secret values for Cloud Functions params (firebase-functions/params `defineSecret`).
# Copy this file to `.secret.local` (gitignored) and fill in real values — one KEY=VALUE per line.
#
#   • LOCAL (emulator): tools/emulators.sh places `.secret.local` beside the built bundle at
#     start-up, where the Functions emulator reads it. Deliberately NOT a build asset, so the
#     secret never enters build outputs or the Nx cache.
#   • PRODUCTION: never deploy secrets from a file — push them to Google Secret Manager with
#     `yarn nx run functions:push-secrets` (tools/push-secrets.sh), which sets each KEY below as
#     a `firebase functions:secrets:set KEY` on the deploy project.
#
# Lines starting with `#`, and unfilled `PASTE_*` values, are skipped by push-secrets. Add a real
# entry when your functions call `defineSecret('MY_API_KEY')` — for example:
# MY_API_KEY=PASTE_MY_API_KEY_HERE
