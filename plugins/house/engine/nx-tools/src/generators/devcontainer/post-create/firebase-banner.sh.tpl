# --- Firebase: the welcome banner (firebase) ---
# The emulator suite's JDK arrived with the OS packages (built into the image) (Firestore / RTDB / Storage run on the JVM; apt
# rather than the SDKMAN-based java feature, whose build-time github.com fetch fails intermittently). This
# installs a /etc/profile.d sourcer for the self-extinguishing Firebase welcome banner
# (tools/firebase-welcome.sh), so every login shell nudges toward the cloud-linkage steps until setup is done.
#
# /etc/profile.d is read by /bin/sh (dash) as often as by bash, so the line it gets is POSIX — `.`, never
# `source`, which dash does not have — and the workspace path is SINGLE-QUOTED into it (any ' inside escaped):
# unquoted, a path with a space broke every login shell in both. It hands the banner its root in
# BESPUNKY_FIREBASE_WS, since a sourced script has no portable way to find itself.
if [ -f "$WS/firebase.json" ]; then
  _fb_ws="'$(printf '%s' "$WS" | sed "s/'/'\\\\''/g")'"
  printf '%s\n' "BESPUNKY_FIREBASE_WS=$_fb_ws; [ -f \"\$BESPUNKY_FIREBASE_WS/tools/firebase-welcome.sh\" ] && . \"\$BESPUNKY_FIREBASE_WS/tools/firebase-welcome.sh\"; unset BESPUNKY_FIREBASE_WS" \
    | sudo tee /etc/profile.d/zz-firebase-welcome.sh > /dev/null
  unset _fb_ws
  echo "[post-create] Firebase prerequisites ready"
fi
