#!/usr/bin/env bash
# BeSpunky Firebase setup nudge — self-extinguishing.
#
# Sourced into every interactive login bash session inside the devcontainer via
# /etc/profile.d/zz-firebase-welcome.sh (installed by the devcontainer's postCreateCommand
# when this project was scaffolded with --firebase).
#
# Prints a banner with the Firebase wiring recipe ONLY when setup is still pending.
# Once `.firebaserc` exists AND productionFirebaseConfig is filled in, this stays silent.
# No permanent stale artifact — when there's nothing to nudge, you see nothing.

_fb_root="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." 2>/dev/null && pwd)"

# Only act inside a workspace that was scaffolded with --firebase.
[ -f "$_fb_root/firebase.json" ] || return 0 2>/dev/null

_fb_setup_pending() {
  # Pending if .firebaserc is missing OR no app's productionFirebaseConfig has a non-empty projectId.
  [ -f "$_fb_root/.firebaserc" ] || return 0
  for f in "$_fb_root"/apps/*/src/app/firebase.config.ts; do
    [ -f "$f" ] || continue
    # Extract the productionFirebaseConfig literal and look for a non-empty projectId.
    if sed -n '/productionFirebaseConfig[[:space:]]*=/,/^};/p' "$f" \
        | grep -qE "projectId:[[:space:]]*['\"][^'\"]+['\"]"; then
      return 1  # at least one app is fully wired — done
    fi
  done
  return 0  # nothing wired yet — pending
}

if _fb_setup_pending; then
  printf '\n\033[1;33m🔥 Firebase setup is pending in this workspace.\033[0m\n'
  printf '  Local dev with emulators already works: \033[1mnx serve <app>\033[0m\n'
  printf '  When you are ready to wire a real Firebase project (App Hosting — the framework-aware product):\n'
  printf '    1) \033[1mfirebase login\033[0m\n'
  printf '    2) \033[1mfirebase use --add\033[0m                                            (picks a project from your account; writes .firebaserc)\n'
  printf '    3) \033[1mfirebase apphosting:backends:create --project <projectId>\033[0m       (one-time: creates the App Hosting backend; interactive — picks region, optionally links a GitHub repo)\n'
  printf '    4) \033[1mfirebase apps:sdkconfig WEB <appId> --project <projectId>\033[0m       (prints the real web config for client-side SDK init)\n'
  printf '    5) Paste the returned firebaseConfig into productionFirebaseConfig in apps/<app>/src/app/firebase.config.ts\n'
  printf '  After the backend exists, App Hosting deploys are GitHub-driven (push to the configured branch).\n'
  printf '  Or just ask Claude to walk you through it.\n\n'
fi

unset -f _fb_setup_pending
unset _fb_root
