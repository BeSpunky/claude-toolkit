# --- The OS packages (the house's and .devcontainer/os-packages.txt) ---
# They are installed when the IMAGE is built (.devcontainer/house.Dockerfile) — one cached Docker layer, so a
# rebuild reinstalls nothing unless a list changed. This step runs the same installer, which installs only what is
# MISSING: nothing, in a container built from the house Dockerfile; everything, in one built from an image of the
# project's own. Best-effort: a failure WARNS — it never aborts post-create and leaves the container half-provisioned.
if sh .devcontainer/os-packages.sh .devcontainer/os-packages.txt; then
  echo "[post-create] OS packages ready"
else
  echo "[post-create] WARNING: some OS packages could not be installed (often a transient network issue)."
  echo "[post-create]          The container is otherwise ready. Finish this one step once the network settles:"
  echo "[post-create]            sh .devcontainer/os-packages.sh .devcontainer/os-packages.txt"
fi
