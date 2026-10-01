# --- Reclaim the cache directory and the shared port registry (web) ---
# Docker creates intermediate mount-point directories as root. The Playwright browser cache is a volume at
# ~/.cache/ms-playwright, so Docker creates the parent ~/.cache as root:root — and any tool running as the
# remote user that later mkdirs a sibling there hits EACCES (firebase-tools' emulator JAR cache is the loud
# one; package-manager caches break silently). This chowns just the parent dir, leaving the mounted volume's
# contents untouched. Idempotent: skipped when already owned.
if [ -d "$HOME/.cache" ] && [ "$(stat -c %U "$HOME/.cache")" != "$ME" ]; then
  echo "[post-create] reclaiming $HOME/.cache ownership for $ME"
  sudo chown "$ME:$ME_GROUP" "$HOME/.cache"
fi
# …and the Playwright cache VOLUME itself: a fresh named volume is root-owned, and the browser install below
# (running as the remote user) hits EACCES the first time it mkdirs inside it. Guarded on ownership: runs only
# on a fresh (empty → instant) volume.
if [ -d "$HOME/.cache/ms-playwright" ] && [ "$(stat -c %U "$HOME/.cache/ms-playwright")" != "$ME" ]; then
  echo "[post-create] reclaiming $HOME/.cache/ms-playwright volume ownership for $ME"
  sudo chown -R "$ME:$ME_GROUP" "$HOME/.cache/ms-playwright"
fi

# /var/opt/bespunky/ports is the FIXED-name docker volume every BeSpunky devcontainer on this engine
# mounts (see devcontainer.json). It is how containers see each other's noVNC port claims, so the
# shared browser can allocate a host port nobody else took instead of everyone assuming 6080 and the
# second container silently forwarding somewhere else. A fresh named volume is root-owned, so hand it to
# the remote user — the allocator must be able to write claims. Idempotent; best-effort, because a missing
# registry only degrades allocation (hash + probe), it never blocks a container.
#
# chmod 1777, not just chown: ownership in a SHARED volume is a UID, and different containers can have
# different UIDs for their remote user (a different base image, a second host user, updateRemoteUserUID
# not applying). A plain chown would let the second container take the directory AWAY from the first,
# whose allocator would then silently fall back to probe-only — reopening the collision window with no
# error anywhere. Sticky + world-writable means any UID can create its own claim file and no container
# can ever strand another; the sticky bit still stops one container deleting another's claim.
if [ -d /var/opt/bespunky/ports ]; then
  if [ "$(stat -c %a /var/opt/bespunky/ports)" != "1777" ]; then
    echo "[post-create] preparing the shared host-port registry (/var/opt/bespunky/ports)"
    sudo chown "$ME:$ME_GROUP" /var/opt/bespunky/ports || true
    sudo chmod 1777 /var/opt/bespunky/ports \
      || echo "[post-create] WARNING: could not prepare the port registry — shared-browser will fall back to probe-only allocation (parallel devcontainers won't see each other's noVNC port claims)"
  fi
fi
