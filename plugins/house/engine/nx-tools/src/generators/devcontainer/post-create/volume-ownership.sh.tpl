# --- Volume ownership (DERIVED from this devcontainer's volume mounts) ---
# Docker creates a fresh named volume — and every directory missing on the way to its mount point (`.nx/` on a
# fresh clone, on the way to its two volumes) — owned by ROOT. Everything below runs as the remote user,
# so the first install would hit EACCES (`mkdir node_modules/…`). This section is generated from the mounts in
# devcontainer.json, one line per volume, so a layer that adds a volume gets its reclaim by declaring it — never
# by remembering to script one. It runs FIRST, before anything installs.
#
#   reclaim_volume tree  <dir>   the mount point: chown -R (a fresh volume is empty, so it is instant; an older
#                                volume a root process populated needs the recursion)
#   reclaim_volume dir   <dir>   a directory Docker created on the way: chown of that directory only — the rest
#                                of what lives in it is not the volume's
#   share_volume         <dir>   a volume SEVERAL containers mount: chmod 1777 rather than chown, because
#                                ownership in a shared volume is a UID and remote users' UIDs differ between
#                                containers — a chown would let the second container take it away from the
#                                first. Sticky + world-writable lets every UID write its own entries and none
#                                delete another's.
#
# Guarded on ownership (or mode), so every rebuild after the first is a no-op. A failure WARNS, never aborts:
# the step that needed the directory reports its own error, louder and more specifically than this could.
reclaim_volume() {
  [ -d "$2" ] || return 0
  [ "$(stat -c %U "$2")" = "$ME" ] && return 0
  echo "[post-create] reclaiming $2 for $ME (Docker created it as root)"
  if [ "$1" = tree ]; then
    sudo chown -R "$ME:$ME_GROUP" "$2" || echo "[post-create] WARNING: could not reclaim $2 — writes into it will fail with EACCES"
  else
    sudo chown "$ME:$ME_GROUP" "$2" || echo "[post-create] WARNING: could not reclaim $2 — writes into it will fail with EACCES"
  fi
}
share_volume() {
  [ -d "$1" ] || return 0
  [ "$(stat -c %a "$1")" = 1777 ] && return 0
  echo "[post-create] opening the shared volume $1 to every container's user (1777)"
  sudo chmod 1777 "$1" || echo "[post-create] WARNING: could not open the shared volume $1 — containers whose user does not own it cannot write there"
}
{{VOLUMES}}
