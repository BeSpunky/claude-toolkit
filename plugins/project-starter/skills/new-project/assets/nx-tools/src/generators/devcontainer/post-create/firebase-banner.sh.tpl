# --- Firebase: the welcome banner (firebase) ---
# The emulator suite's JDK arrived with the OS packages above (Firestore / RTDB / Storage run on the JVM; apt
# rather than the SDKMAN-based java feature, whose build-time github.com fetch fails intermittently). This
# installs a /etc/profile.d sourcer for the self-extinguishing Firebase welcome banner
# (tools/firebase-welcome.sh), so every login shell nudges toward the cloud-linkage steps until setup is done.
if [ -f "$WS/firebase.json" ]; then
  echo "[ -f $WS/tools/firebase-welcome.sh ] && source $WS/tools/firebase-welcome.sh" \
    | sudo tee /etc/profile.d/zz-firebase-welcome.sh > /dev/null
  echo "[post-create] Firebase prerequisites ready"
fi
