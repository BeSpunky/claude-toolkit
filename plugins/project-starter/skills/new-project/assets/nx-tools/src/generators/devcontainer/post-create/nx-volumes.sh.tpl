# --- Reclaim Nx's volume mount points (nx) ---
# `.nx/cache` and `.nx/workspace-data` are named volumes, and Docker creates a fresh volume — and any mount
# point missing from the bind-mounted workspace, `.nx/` itself included on a fresh clone — owned by root. Nx
# runs as the remote user and would then hit EACCES on its first cache write. Guarded on ownership, so it is a
# no-op on every rebuild after the first.
for nx_dir in "$WS/.nx" "$WS/.nx/cache" "$WS/.nx/workspace-data"; do
  if [ -d "$nx_dir" ] && [ "$(stat -c %U "$nx_dir")" != "$ME" ]; then
    echo "[post-create] reclaiming ${nx_dir#"$WS"/} ownership for $ME"
    sudo chown "$ME:$ME_GROUP" "$nx_dir" || echo "[post-create] WARNING: could not reclaim ${nx_dir#"$WS"/} — Nx may fail to write its cache"
  fi
done
