#!/usr/bin/env bash
# A REAL image built from a project wearing `supabase`: does the CLI the house installs, and its native runtime, work for the
# devcontainer's user, on every Debian release the house composes?
#
# tools/test-supabase runs the provider against the real CLI unprivileged, on whatever machine runs it. This is the only place the
# installer runs as root in a real `docker build`, with the Debian server left out of the image, and so the only place a release other
# than this devcontainer's, or the arm64 runtime, gets its own observation: glibc, /bin/ps, Docker's default /dev/shm, a home with nothing in it.
#
# FOR EACH CASE: one project per preset, made once with this checkout (`house.sh new --local --add-layer=supabase`), its .nvmrc set to
# the case, the devcontainer generator re-run, then `docker build` from the context devcontainer.json names.
#
# ASSERTED: the Dockerfile is FROM the case's image, on the case's Debian release; the installer's own lines say the CLI was installed; as the
# remote user, not root, with the PATH and environment devcontainer.json gives: `supabase` answers from /usr/local/bin at the pin; no
# Debian server and no dbmate, on PATH or anywhere under /usr/lib/postgresql; psql, ps and tar there; SUPABASE_HOME under the persisted
# ~/.local. On the node presets, whose image has its Node (the agent preset's is a devcontainer feature, which `docker build` does not
# apply): the real launcher boots the real stack, under the real engine, with a migration in the ledger and the seed applied; a second
# migration through the verb; a stop that leaves nothing running.
#
# Exit codes, as its siblings: 0 all hold; 1 a case's assertion or build failed; 2 could not run, so nothing is known about that case (no
# docker, no base image, an engine error, `new` failing). A finding outranks a could-not-run.
#
#   bash tools/check-runner-image/supabase-image.sh [case…]    (docker, the network, 1.7 GB per boot, Node 22.18+; ~6 minutes a case)
#   bash tools/check-runner-image/test.sh                      its own branches, against a fake docker
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ENGINE="$ROOT/plugins/house/engine"
VERSIONS="$ENGINE/nx-tools/src/generators/_utils/versions.ts"
MCR=mcr.microsoft.com/devcontainers
# shellcheck source=image-case.lib.sh
. "$HERE/image-case.lib.sh"

PIN="$(sed -n "s/^export const SUPABASE_CLI_VERSION = '\([^']*\)'.*/\1/p" "$VERSIONS")"
[ -n "$PIN" ] || { notice error "No SUPABASE_CLI_VERSION in $VERSIONS: COULD NOT RUN."; exit 2; }

# id | preset | .nvmrc | the image it must compose | the Debian release that image must be on
# Bookworm is reached the way a project reaches it: its Node. tools/postgres-debs/image-codenames.mjs is what says which do.
CASES="
sb-trixie-agent|agent|24|$MCR/base:debian|trixie
sb-trixie-node24|node|24|$MCR/typescript-node:24|trixie
sb-bookworm-node18|node|18|$MCR/typescript-node:18|bookworm
"

SELECTED=("$@")
for wanted in ${SELECTED[@]+"${SELECTED[@]}"}; do
  case "$CASES" in *"
$wanted|"*) ;; *) echo "usage: supabase-image.sh [case…]; cases: $(printf '%s\n' "$CASES" | cut -d'|' -f1 | xargs)" >&2; exit 2 ;; esac
done

command -v docker > /dev/null 2>&1 || { notice error "COULD NOT RUN: no docker on PATH."; exit 2; }

WORK="$(mktemp -d)"
IMAGES=()
cleanup() {
  [ "${#IMAGES[@]}" -eq 0 ] || docker image rm -f "${IMAGES[@]}" > /dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

run_case() {
  local preset="$2" node="$3" image="$4" codename="$5" project
  CASE="$1"; CASE_RED=0
  echo; echo "=== $CASE: the Supabase CLI on $image ($codename), the $preset preset"

  if ! project="$(project_for sb supabase "$preset")"; then
    could_not "house.sh new --local failed: no project to generate from"; summary "| $CASE | could not run |"; return
  fi
  if ! docker pull -q "$image" > "$WORK/pull.log" 2>&1; then
    sed 's/^/    /' "$WORK/pull.log"; could_not "docker pull $image failed"; summary "| $CASE | could not run |"; return
  fi

  echo "$node" > "$project/.nvmrc"
  local nx=./nx
  [ -e "$project/nx" ] || nx=./node_modules/.bin/nx
  if ! (cd "$project" && NX_DAEMON=false NX_TUI=false "$nx" g @bespunky/nx-tools:devcontainer "sb-$preset" --no-interactive) < /dev/null > "$WORK/generate.log" 2>&1; then
    tail -n 30 "$WORK/generate.log"; check 1 "the devcontainer generator ran"; summary "| $CASE | **failed** |"; return
  fi

  local dc="$project/.devcontainer" json="$project/.devcontainer/devcontainer.json" dockerfile context user path home packages
  dockerfile="$(json_field "$json" dockerfile)"
  context="$(json_field "$json" context)"
  user="$(json_field "$json" remoteUser)"
  path="$(json_field "$json" PATH)"
  home="$(json_field "$json" SUPABASE_HOME)"
  if [ -z "$dockerfile" ] || [ -z "$context" ] || [ -z "$user" ] || [ -z "$path" ] || [ -z "$home" ]; then
    check 1 "devcontainer.json names a build, a remoteUser, a PATH and SUPABASE_HOME"; summary "| $CASE | **failed** |"; return
  fi
  packages="$dc/house.packages.sh"
  says "$dc/$dockerfile" "FROM $image"; check $? "the generated Dockerfile is FROM $image"
  ! grep -q '^tool postgres ' "$packages"; check $? "the generated installer holds no Debian server"
  ! grep -q '^dbmate ' "$packages"; check $? "the generated installer holds no dbmate"

  # --no-cache: a cached layer prints nothing, and the installer's lines are the evidence.
  local tag="house-supabase-image-e2e-$CASE" build="$WORK/build-$CASE.log" lines="$WORK/lines-$CASE" facts="$WORK/facts-$CASE" brc=0 rc=0
  IMAGES+=("$tag")
  DOCKER_BUILDKIT=1 docker build --no-cache --progress=plain -f "$dc/$dockerfile" -t "$tag" "$dc/$context" < /dev/null > "$build" 2>&1 || brc=$?
  if [ "$brc" -ne 0 ]; then
    # The installer's own verdict can sit far above the tail, as it can name the package at fault only after its retries.
    grep -E '\[os-packages\]|\[package-manager\]|^#[0-9]+ [0-9.]+ (E:|W:|Err:)' "$build" | sed 's/^/    /'
    tail -n 40 "$build" | sed 's/^/    /'
    check "$brc" "docker build exited 0 (it exited $brc)"; summary "| $CASE | **build failed** |"; return
  fi
  echo "  ok   docker build exited 0"
  installer_lines "$build" > "$lines"
  grep -E 'supabase' "$lines" | sed 's/^/    /'
  says "$lines" "[os-packages] supabase $PIN installed"; check $? "the installer says the CLI is installed, at $PIN"

  # What devcontainer.json's containerEnv gives every process there, which a plain `docker run` does not read.
  local env=(-e "SUPABASE_HOME=$home" -e "SUPABASE_NO_KEYRING=$(json_field "$json" SUPABASE_NO_KEYRING)" -e "DO_NOT_TRACK=$(json_field "$json" DO_NOT_TRACK)")
  echo "  as $user"
  docker run -i --rm --user "$user" "${env[@]}" "$tag" bash -s -- "$path" < "$HERE/supabase-image.inside.sh" > "$facts" 2>&1 || rc=$?
  sed 's/^/    /' "$facts"
  if [ "$rc" -ne 0 ] || ! grep -q '^probe=done$' "$facts"; then
    could_not "docker run exited $rc before the probe's end"; summary "| $CASE | could not run |"; docker image rm -f "$tag" > /dev/null 2>&1; return
  fi

  [ "$(value "$facts" uid)" != 0 ]; check $? "it runs as a user who is not root"
  equal "$facts" codename "$codename" "the image is on $codename"
  equal "$facts" path.supabase /usr/local/bin/supabase "supabase is on PATH, from /usr/local/bin"
  equal "$facts" version.supabase "$PIN" "supabase --version is the pin, $PIN"
  equal "$facts" path.postgres "" "no server on PATH"
  equal "$facts" server.anywhere "" "no Debian server under /usr/lib/postgresql"
  equal "$facts" path.dbmate "" "no dbmate on PATH"
  [ -n "$(value "$facts" path.psql)" ]; check $? "psql is there, for postgres:psql and postgres:seed"
  [ -n "$(value "$facts" path.ps)" ]; check $? "ps is there: the native runtime watches its processes through it"
  [ -n "$(value "$facts" path.tar)" ]; check $? "tar is there: the native runtime unpacks its artifacts with it"
  starts "$facts" supabase.home "$(value "$facts" home)/.local/" "SUPABASE_HOME is under the persisted ~/.local"
  equal "$facts" supabase.home.writable yes "and its user can write there"

  # The node presets' images carry their Node, so the launcher itself runs there.
  if [ "$preset" = node ]; then
    local running="$WORK/launcher-$CASE" stage="$WORK/stage-$CASE" lrc=0
    mkdir -p "$stage"
    tar -C "$project" -cf - tools/dev tools/postgres .bespunky supabase postgres | tar -C "$stage" -xf -
    cp "$HERE/supabase-image.launcher.sh" "$stage/probe.sh"
    echo "  the launcher, as $user"
    # bash -c, so `tar` reads the copy from stdin: a bind mount of this runner's temp directory is not readable by the remote user.
    tar -C "$stage" -cf - . | docker run -i --rm --user "$user" "${env[@]}" "$tag" bash -c 'd="$(mktemp -d)" && tar -xf - -C "$d" && exec bash "$d/probe.sh" "$d" "$1"' _ "$path" > "$running" 2>&1 || lrc=$?
    sed 's/^/    /' "$running"
    if [ "$lrc" -ne 0 ] || ! grep -q '^probe=done$' "$running"; then
      could_not "docker run exited $lrc before the launcher's probe ended"
    else
      equal "$running" launcher.ready yes "the launcher booted the stack, under the real engine"
      equal "$running" launcher.major 17 "on the stack's own Postgres, 17"
      equal "$running" launcher.row seeded "migrated and seeded before it said ready"
      equal "$running" launcher.ledger 20260101000000 "and the CLI's ledger holds the migration"
      equal "$running" launcher.migrate.rc 0 "postgres.mjs migrate exited 0"
      equal "$running" launcher.column 1 "and applied the new migration"
      equal "$running" launcher.stop.rc 0 "dev stop exited 0"
      equal "$running" launcher.exit.rc 0 "and the keeper ended clean"
      equal "$running" launcher.port closed "the stack's port is closed"
      equal "$running" launcher.left "" "and nothing of the stack is running, zombies aside"
    fi
  fi

  docker image rm -f "$tag" > /dev/null 2>&1
  [ "$CASE_RED" -eq 0 ] && summary "| $CASE ($(value "$facts" arch)) | ok |" || summary "| $CASE ($(value "$facts" arch)) | **red** |"
}

summary "### A project wearing supabase, on real images"
summary "| case | result |"
summary "| --- | --- |"
# Its own descriptor: nothing a case runs may read the table.
while IFS='|' read -r -u 3 id preset node image codename; do
  [ -n "$id" ] || continue
  if [ "${#SELECTED[@]}" -gt 0 ]; then case " ${SELECTED[*]} " in *" $id "*) ;; *) continue ;; esac; fi
  run_case "$id" "$preset" "$node" "$image" "$codename"
done 3<<< "$CASES"

echo
if [ "$FINDINGS" -ne 0 ]; then echo "FAIL: a project wearing supabase does not get what the layer promises (above)."; exit 1; fi
if [ "$COULD_NOT" -ne 0 ]; then echo "COULD NOT RUN: nothing is known about the cases named above."; exit 2; fi
echo "PASS"
