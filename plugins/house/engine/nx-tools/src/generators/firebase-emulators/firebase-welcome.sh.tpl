#!/bin/sh
# BeSpunky Firebase setup nudge — self-extinguishing.
#
# Sourced into every interactive login bash session inside the devcontainer via
# /etc/profile.d/zz-firebase-welcome.sh (installed by the devcontainer's postCreateCommand
# when this project was scaffolded with --firebase).
#
# Prints a banner with the Firebase wiring recipe ONLY when setup is still pending.
# Once `.firebaserc` exists AND — where a client app carries the house's environment files —
# at least one app's environment.prod.ts has a non-empty environment.firebase.projectId, this
# stays silent. A workspace with no such client (the Firebase core alone, or a stack whose
# client the house does not wire) is done at `.firebaserc`: there is no file of ours to fill,
# and a nudge that can never be satisfied is one everybody learns to ignore.

# POSIX throughout: /etc/profile.d is sourced by /bin/sh (dash) too, where the ARRAY form BASH_SOURCE[0] is a
# syntax error. The profile.d line passes the workspace in BESPUNKY_FIREBASE_WS. Without it — run directly, or
# sourced by a hook written before that variable existed (a container not yet rebuilt) — the plain
# ${BASH_SOURCE:-$0} is valid in every shell: this file under bash, $0 elsewhere.
_fb_root="${BESPUNKY_FIREBASE_WS:-$(cd "$(dirname "${BASH_SOURCE:-$0}")/.." 2>/dev/null && pwd)}"

# Only act inside a workspace that was scaffolded with --firebase.
[ -f "$_fb_root/firebase.json" ] || return 0 2>/dev/null

# The client env files the house wires (the Angular client adapter's). None → no client config to fill.
_fb_has_client() {
  for f in "$_fb_root"/{{appsDir}}/*/src/environments/environment.prod.ts; do
    [ -f "$f" ] && return 0
  done
  return 1
}

_fb_setup_pending() {
  # Pending if .firebaserc is missing OR there are client env files and none has a non-empty
  # environment.firebase.projectId.
  [ -f "$_fb_root/.firebaserc" ] || return 0
  _fb_has_client || return 1  # no house-wired client: .firebaserc is the whole setup
  for f in "$_fb_root"/{{appsDir}}/*/src/environments/environment.prod.ts; do
    [ -f "$f" ] || continue
    # Look for environment.firebase.projectId with a non-empty string literal.
    # Scoped to the `firebase: { ... }` block to avoid false positives elsewhere.
    if sed -n '/firebase[[:space:]]*:[[:space:]]*{/,/}/p' "$f" \
        | grep -qE "projectId:[[:space:]]*['\"][^'\"]+['\"]"; then
      return 1  # at least one app is fully wired — done
    fi
  done
  return 0  # nothing wired yet — pending
}

if _fb_setup_pending; then
  printf '\n\033[1;33m🔥 Firebase setup is pending in this workspace.\033[0m\n'
  if [ -x "$_fb_root/tools/dev/dev" ] && [ -f "$_fb_root/.bespunky/dev.json" ]; then
    printf '  Local dev with emulators already works: \033[1mtools/dev/dev serve <app>\033[0m (or your app'"'"'s nx serve)\n'
  else
    printf '  Local dev with emulators already works: \033[1mnx run firebase:emulators\033[0m\n'
  fi
  printf '  When you are ready to wire a real Firebase project (App Hosting — the framework-aware product):\n'
  printf '    1) \033[1mfirebase login\033[0m\n'
  printf '    2) \033[1mfirebase use --add\033[0m                                            (picks a project from your account; writes .firebaserc)\n'
  printf '    3) \033[1mfirebase apphosting:backends:create --project <projectId> --root-dir {{appsDir}}/<app>\033[0m   (one-time: creates the App Hosting backend; interactive — links a GitHub repo + live branch)\n'
  printf '    4) \033[1mfirebase apps:sdkconfig WEB <appId> --project <projectId>\033[0m       (prints the real web config for client-side SDK init)\n'
  if _fb_has_client; then
    printf '    5) Paste the returned firebaseConfig fields into `firebase` in {{appsDir}}/<app>/src/environments/environment.prod.ts\n'
  fi
  printf '  Then each push to the live branch rolls out (Firebase runs the build; no workflow file here) — or deploy from local\n'
  printf '  source instead (\033[1mfirebase init apphosting\033[0m once, then \033[1mfirebase deploy --only apphosting\033[0m). Either way the Root Directory is the app, never /.\n'
  printf '  Cloud Functions and the Firestore / Storage rules deploy through Nx, not App Hosting — the road from login to the\n'
  printf '  first deploy (and to CI), with what this machine already has ticked: \033[1mnode tools/firebase-deploy.mjs --check\033[0m\n'
  printf '  Or just ask Claude to walk you through it (staging, deploy modes, account moves: bespunky-house:firebase-app-hosting).\n\n'
fi

unset -f _fb_setup_pending _fb_has_client
unset _fb_root
