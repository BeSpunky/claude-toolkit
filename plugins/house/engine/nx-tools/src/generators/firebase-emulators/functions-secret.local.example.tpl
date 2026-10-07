# The Cloud Functions secrets this project declares (firebase-functions/params `defineSecret`) —
# committed, so every tree and teammate knows WHICH secrets exist. One KEY=VALUE per line.
#
#   • PRODUCTION: copy this file to `.secret.local` (gitignored) and fill in the real values. Push
#     them to Google Secret Manager with `yarn nx run {{functionsProject}}:push-secrets`
#     (tools/push-secrets.sh) — never deploy secrets from a file.
#   • LOCAL (emulator): nothing to do. tools/emulators.sh gives every key declared here an INERT
#     placeholder, so local runs can never act with production's credentials. `.secret.local` is
#     never fed to the emulator.
#   • SANDBOX (opt-in): to exercise a real integration locally (a test bot, a sandbox account), put
#     THOSE credentials in `.secret.sandbox.local` (gitignored) — never production's. The emulator
#     loads them and says so on every launch; delete the file to disarm.
#
# Lines starting with `#`, and unfilled `PASTE_*` values, are skipped by push-secrets. Add a real
# entry when your functions call `defineSecret('MY_API_KEY')` — for example:
# MY_API_KEY=PASTE_MY_API_KEY_HERE
