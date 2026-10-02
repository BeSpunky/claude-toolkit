# shellcheck shell=bash
# THE HOUSE MOUNT POINTS — which directories inside a workspace a container mounts as named volumes, and which
# of them the current user can no longer write.
#
# WHY THIS EXISTS. A devcontainer that mounts a named volume at ${containerWorkspaceFolder}/node_modules gets a
# mount point Docker CREATES ROOT-OWNED the first time that volume exists. Unless the container's post-create
# reclaims it, `yarn install` dies with `EACCES: mkdir '<ws>/node_modules/…'` and the container comes up with no
# dependencies at all. Such a project cannot even sync its way out: the sync's own install hits the same wall,
# minutes in, after the migrations have started. So the condition is DETECTED up front, by two readers:
#
#   scaffold.sh   a sync PREFLIGHT refusal (`unwritable-mounts`), before anything is written. The functions are
#                 rendered into the program with `declare -f`, so the check runs wherever the program does —
#                 natively or inside the fallback container — with no file to find there.
#   the SessionStart hook (hooks/check-house-version.sh), which relays it as one fact: post-create most likely
#                 failed for this reason, and here is the fix.
#
# ONE DERIVATION, so the two can never disagree about which directories are the house's. The mount points are
# READ FROM THE PROJECT'S OWN devcontainer.json (every `type=volume` mount targeting
# ${containerWorkspaceFolder}/…), never hard-coded: a layer that adds a volume (`.angular`, a future one) is
# covered the day the devcontainer carries it. `node_modules` and `.nx` are the floor in every case — they are
# what an install and Nx write into, so a root-owned one breaks a sync whether or not a container put it there.
# Each path's in-workspace ANCESTORS are candidates too: Docker creates the missing parents of a mount point
# (`.nx` for `.nx/cache`) root-owned in exactly the same way.
#
# Pure bash plus grep/sed and `test` — no Node, no jq — because the hook must stay a few stat calls and the
# preflight runs before anything is installed. Sourcing defines functions only; it runs nothing.
#
# The devcontainer is a REPO-CONTROLLED file and the hook echoes these paths into the model's context, so every
# derived path is held to a strict charset (no whitespace, no quotes, no `..`, bounded length) and anything else
# is dropped — the same under-report-when-unsure rule every house notice keeps. It also keeps the remedy line
# safe to paste: a surviving path needs no quoting.

# house_mount_points <workspace> — the candidate directories, workspace-relative, one per line, ancestors first.
house_mount_points() {
  local dc="$1/.devcontainer/devcontainer.json" p acc part
  {
    printf '%s\n' node_modules .nx
    if [ -f "$dc" ]; then
      # Whole-line `//` comments dropped first (JSONC), so a commented-out mount is not a mount. Then every
      # string literal carrying `type=volume`, reduced to its target under the workspace folder.
      sed 's#^[[:space:]]*//.*##' "$dc" 2>/dev/null \
        | grep -o '"[^"]*type=volume[^"]*"' \
        | sed -n 's#.*target=\${containerWorkspaceFolder}/\([^,"]*\).*#\1#p'
    fi
  } | while IFS= read -r p; do
    p="${p%/}"
    case "$p" in '' | /* | *..* | *[!A-Za-z0-9._/-]*) continue ;; esac
    [ "${#p}" -le 96 ] || continue
    acc=''
    local IFS=/
    for part in $p; do
      [ -n "$part" ] || continue
      acc="${acc:+$acc/}$part"
      printf '%s\n' "$acc"
    done
  done | LC_ALL=C sort -u
}

# house_unwritable_mounts <workspace> — the candidates that EXIST but the current user cannot write into, one per
# line as `<path> <owner>`. A path under one already listed is omitted: `chown -R` of the parent reclaims it.
house_unwritable_mounts() {
  local ws="$1" p t tops='' owner covered
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    covered=0
    for t in $tops; do
      case "$p/" in "$t"/*) covered=1 ;; esac
    done
    [ "$covered" = 1 ] && continue
    [ -e "$ws/$p" ] || continue
    if [ -d "$ws/$p" ]; then
      [ -w "$ws/$p" ] && [ -x "$ws/$p" ] && continue
    else
      [ -w "$ws/$p" ] && continue
    fi
    owner="$(ls -ld "$ws/$p" 2>/dev/null | awk '{print $3}')"
    printf '%s %s\n' "$p" "${owner:-?}"
    tops="$tops $p"
  done <<EOF
$(house_mount_points "$ws")
EOF
}

# house_post_create <workspace> — the house post-create script to re-run after reclaiming, workspace-relative, or
# nothing when the project has none. An ADOPTED devcontainer keeps its own post-create.sh and gets the house one
# beside it as post-create.bespunky.sh; that beside file is the house's, so it is the one named.
house_post_create() {
  if [ -f "$1/.devcontainer/post-create.bespunky.sh" ]; then
    printf '%s\n' .devcontainer/post-create.bespunky.sh
  elif [ -f "$1/.devcontainer/post-create.sh" ]; then
    printf '%s\n' .devcontainer/post-create.sh
  fi
}
