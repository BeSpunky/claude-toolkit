#!/usr/bin/env bash
# A REAL image built from a project wearing `postgres`: does the server the house installs work for the devcontainer's user, on
# every major it offers and every Debian release it composes?
#
# Everything else about the layer runs unprivileged against a cache (tools/test-postgres) on whatever machine runs it: this is
# the only place the installer runs as root in a real `docker build`, with a real `apt-get satisfy` of what the closure asks
# Debian for, and so the only place a major or a release other than this devcontainer's gets its own observation.
#
# FOR EACH CASE: one project per preset, made once with this checkout (`house.sh new --local --add-layer=postgres`), its .nvmrc
# and .bespunky/postgres.json set to the case, the devcontainer generator re-run, then `docker build` from the context
# devcontainer.json names. Features are the devcontainer CLI's, so the launcher's Node may not be there on the agent image, and
# none of this needs it: postgres-image.inside.sh asks the tools themselves.
#
# ASSERTED: the Dockerfile is FROM the case's image, on the case's Debian release; the installer's own lines say both tools were
# installed; as the remote user, not root, with the PATH devcontainer.json gives: postgres, psql, initdb, pg_ctl, pg_dump and dbmate
# answer from /usr/local/bin, the server through its generated wrapper, at the pinned versions; a real initdb with the launcher's
# flags; a boot; pgvector; a real dbmate migration; a stop that leaves nothing.
#
# Exit codes, as its siblings: 0 all hold; 1 a case's assertion or build failed; 2 could not run, so nothing is known about that
# case (no docker, no base image, an engine error, `new` failing). A finding outranks a could-not-run.
#
#   bash tools/check-runner-image/postgres-image.sh [case…]    (docker, the network, Node 22.18+; ~4 minutes a case)
#   bash tools/check-runner-image/test.sh                      its own branches, against a fake docker
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ENGINE="$ROOT/plugins/house/engine"
VERSIONS="$ENGINE/nx-tools/src/generators/_utils/versions.ts"
MCR=mcr.microsoft.com/devcontainers

notice() { echo "$2"; [ -z "${GITHUB_ACTIONS:-}" ] || echo "::$1::$2"; }
summary() { [ -z "${GITHUB_STEP_SUMMARY:-}" ] || echo "$1" >> "$GITHUB_STEP_SUMMARY"; }

DBMATE_VERSION="$(sed -n "s/^export const DBMATE_VERSION = '\([^']*\)'.*/\1/p" "$VERSIONS")"
[ -n "$DBMATE_VERSION" ] || { notice error "No DBMATE_VERSION in $VERSIONS: COULD NOT RUN."; exit 2; }

# id | preset | .nvmrc | major | the image it must compose | the Debian release that image must be on
# Bookworm is reached the way a project reaches it: its Node, here without `web`, which cannot build on bookworm today. tools/postgres-debs/image-codenames.mjs is what says which do.
CASES="
pg18-trixie-agent|agent|24|18|$MCR/base:debian|trixie
pg17-trixie-node24|node|24|17|$MCR/typescript-node:24|trixie
pg18-bookworm-node18|bare-node|18|18|$MCR/typescript-node:18|bookworm
pg17-bookworm-node18|bare-node|18|17|$MCR/typescript-node:18|bookworm
"

SELECTED=("$@")
for wanted in ${SELECTED[@]+"${SELECTED[@]}"}; do
  case "$CASES" in *"
$wanted|"*) ;; *) echo "usage: postgres-image.sh [case…]; cases: $(printf '%s\n' "$CASES" | cut -d'|' -f1 | xargs)" >&2; exit 2 ;; esac
done

command -v docker > /dev/null 2>&1 || { notice error "COULD NOT RUN: no docker on PATH."; exit 2; }

WORK="$(mktemp -d)"
IMAGES=()
cleanup() {
  [ "${#IMAGES[@]}" -eq 0 ] || docker image rm -f "${IMAGES[@]}" > /dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

FINDINGS=0
COULD_NOT=0
CASE=""
# The status FIRST: `check "says $(x)" $?` would hand it the status of that `$(x)`, and every check would pass.
check() {   # <holds? 0/non-zero> <what>
  if [ "$1" -eq 0 ]; then echo "  ok   $2"; else notice error "FAILED ($CASE): $2"; FINDINGS=1; CASE_RED=1; fi
}
could_not() { notice error "COULD NOT RUN ($CASE): $1"; COULD_NOT=1; CASE_RED=1; }
says() { grep -qF -- "$2" "$1"; }
value() { sed -n "s/^$2=//p" "$1" | head -n 1; }
equal() {   # <file> <fact> <wanted> <what>
  [ "$(value "$1" "$2")" = "$3" ]; check $? "$4 (it says '$(value "$1" "$2")')"
}
starts() {   # <file> <fact> <wanted prefix> <what>
  case "$(value "$1" "$2")" in "$3"*) check 0 "$4" ;; *) check 1 "$4 (it says '$(value "$1" "$2")')" ;; esac
}
json_field() { sed -n "s/^[[:space:]]*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$1" | head -n 1; }

# Lines of the installer's own output in a plain BuildKit log: `#7 3.21 [os-packages] …`, never the step's header.
installer_lines() { sed -n 's/^#[0-9]* [0-9.]* \(\[os-packages\].*\)$/\1/p' "$1"; }

project_for() {   # <preset>: prints the project's directory, making it the first time. Fails when `new` does.
  local preset="$1" dir="$WORK/pg-$1" flags=() layers=postgres
  if [ ! -d "$dir" ]; then
    # `bare-node` is the node layer with no preset: the node preset wears `web`, whose Chromium packages are named for trixie.
    case "$preset" in
      agent) ;;
      bare-node) layers=node,postgres ;;
      *) flags=("--preset=$preset") ;;
    esac
    echo "One project, made with this checkout on Node $(node --version 2>/dev/null): house.sh new --local ${flags[*]-} --add-layer=$layers" >&2
    if ! PROJECTS_DIR="$WORK" bash "$ENGINE/house.sh" new --local ${flags[@]+"${flags[@]}"} "--add-layer=$layers" "pg-$preset" < /dev/null > "$WORK/new-$preset.log" 2>&1; then
      tail -n 40 "$WORK/new-$preset.log" >&2
      return 1
    fi
  fi
  echo "$dir"
}

run_case() {
  local preset="$2" node="$3" major="$4" image="$5" codename="$6" project
  CASE="$1"; CASE_RED=0
  echo; echo "=== $CASE: Postgres $major on $image ($codename), the $preset preset"

  if ! project="$(project_for "$preset")"; then
    could_not "house.sh new --local failed: no project to generate from"; summary "| $CASE | could not run |"; return
  fi
  if ! docker pull -q "$image" > "$WORK/pull.log" 2>&1; then
    sed 's/^/    /' "$WORK/pull.log"; could_not "docker pull $image failed"; summary "| $CASE | could not run |"; return
  fi

  echo "$node" > "$project/.nvmrc"
  printf '{ "major": %s }\n' "$major" > "$project/.bespunky/postgres.json"
  local nx=./nx
  [ -e "$project/nx" ] || nx=./node_modules/.bin/nx
  if ! (cd "$project" && NX_DAEMON=false NX_TUI=false "$nx" g @bespunky/nx-tools:devcontainer "pg-$preset" --no-interactive) < /dev/null > "$WORK/generate.log" 2>&1; then
    tail -n 30 "$WORK/generate.log"; check 1 "the devcontainer generator ran"; summary "| $CASE | **failed** |"; return
  fi

  local dc="$project/.devcontainer" json="$project/.devcontainer/devcontainer.json" dockerfile context user path packages closure minor
  dockerfile="$(json_field "$json" dockerfile)"
  context="$(json_field "$json" context)"
  user="$(json_field "$json" remoteUser)"
  path="$(json_field "$json" PATH)"
  if [ -z "$dockerfile" ] || [ -z "$context" ] || [ -z "$user" ] || [ -z "$path" ]; then
    check 1 "devcontainer.json names a build, a remoteUser and a PATH"; summary "| $CASE | **failed** |"; return
  fi
  packages="$dc/house.packages.sh"
  says "$dc/$dockerfile" "FROM $image"; check $? "the generated Dockerfile is FROM $image"
  says "$packages" "tool postgres usr/lib/postgresql/$major/bin"; check $? "the generated installer holds Postgres $major's tools"
  closure="$(sed -n "s/^closure postgres $codename \([^ ]*\) .*/\1/p" "$packages" | head -n 1)"
  if [ -z "$closure" ]; then
    check 1 "the generated installer has a $codename closure"; summary "| $CASE | **failed** |"; return
  fi
  minor="${closure%%-*}"

  # --no-cache: a cached layer prints nothing, and the installer's lines are the evidence.
  local tag="house-postgres-image-e2e-$CASE" build="$WORK/build-$CASE.log" lines="$WORK/lines-$CASE" facts="$WORK/facts-$CASE" brc=0 rc=0
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
  grep -E 'postgres|dbmate' "$lines" | sed 's/^/    /'
  says "$lines" "[os-packages] installing postgres $closure ($codename,"; check $? "the installer took the $codename closure, $closure"
  says "$lines" "[os-packages] postgres $closure installed"; check $? "the installer says the server is installed"
  says "$lines" "[os-packages] dbmate $DBMATE_VERSION installed"; check $? "the installer says dbmate $DBMATE_VERSION is installed"

  echo "  as $user"
  docker run -i --rm --user "$user" "$tag" bash -s -- "$path" < "$HERE/postgres-image.inside.sh" > "$facts" 2>&1 || rc=$?
  sed 's/^/    /' "$facts"
  if [ "$rc" -ne 0 ] || ! grep -q '^probe=done$' "$facts"; then
    could_not "docker run exited $rc before the probe's end"; summary "| $CASE | could not run |"; docker image rm -f "$tag" > /dev/null 2>&1; return
  fi

  [ "$(value "$facts" uid)" != 0 ]; check $? "it runs as a user who is not root"
  equal "$facts" codename "$codename" "the image is on $codename"
  local tool
  for tool in postgres psql initdb pg_ctl pg_dump pg_controldata pg_isready dbmate; do
    equal "$facts" "path.$tool" "/usr/local/bin/$tool" "$tool is on PATH, from /usr/local/bin"
  done
  equal "$facts" wrapper.postgres "# bespunky-house wrapper for postgres" "the server's binary is reached through its generated wrapper"
  starts "$facts" version.postgres "postgres (PostgreSQL) $minor" "postgres --version is the pin, $minor"
  starts "$facts" version.psql "psql (PostgreSQL) $minor" "psql --version is the pin, $minor"
  equal "$facts" version.dbmate "dbmate version $DBMATE_VERSION" "dbmate --version is the pin, $DBMATE_VERSION"
  equal "$facts" initdb.rc 0 "a real initdb, with the launcher's flags, exited 0"
  equal "$facts" boot.rc 0 "the server booted"
  starts "$facts" server.version "$minor" "the server answers, at $minor"
  equal "$facts" ready.rc 0 "pg_isready answers, as the launcher's wait asks it"
  [[ "$(value "$facts" control.identifier)" =~ ^[0-9]+$ ]]; check $? "pg_controldata reads the identifier the launcher records"
  # A version, not "some text": a failed CREATE EXTENSION ends on a non-empty HINT line.
  [[ "$(value "$facts" server.vector)" =~ ^[0-9]+\.[0-9]+ ]]; check $? "pgvector loads in it"
  equal "$facts" dbmate.rc 0 "a real dbmate migration exited 0"
  equal "$facts" dbmate.row 1 "and its row is there"
  equal "$facts" stop.rc 0 "the server stopped"
  equal "$facts" stop.pidfile gone "and left no pid file"

  # The node presets' images carry their Node, so the launcher itself runs there. The agent preset's is a devcontainer feature.
  if [ "$preset" = node ]; then
    local running="$WORK/launcher-$CASE" stage="$WORK/stage-$CASE" lrc=0
    mkdir -p "$stage"
    tar -C "$project" -cf - tools/dev tools/postgres .bespunky | tar -C "$stage" -xf -
    cp "$HERE/postgres-image.launcher.sh" "$stage/probe.sh"
    echo "  the launcher, as $user"
    # bash -c, so `tar` reads the copy from stdin: a bind mount of this runner's temp directory is not readable by the remote user.
    tar -C "$stage" -cf - . | docker run -i --rm --user "$user" "$tag" bash -c 'd="$(mktemp -d)" && tar -xf - -C "$d" && exec bash "$d/probe.sh" "$d" "$1"' _ "$path" > "$running" 2>&1 || lrc=$?
    sed 's/^/    /' "$running"
    if [ "$lrc" -ne 0 ] || ! grep -q '^probe=done$' "$running"; then
      could_not "docker run exited $lrc before the launcher's probe ended"
    else
      equal "$running" launcher.ready yes "the launcher booted it, under the real engine"
      equal "$running" launcher.row seeded "migrated and seeded before it said ready"
      equal "$running" launcher.wal logical "with the launcher's own settings"
      equal "$running" launcher.migrate.rc 0 "postgres.mjs migrate exited 0"
      equal "$running" launcher.column 1 "and applied the new migration"
      equal "$running" launcher.stop.rc 0 "dev stop exited 0"
      equal "$running" launcher.exit.rc 0 "and the launcher ended clean"
    fi
  fi

  docker image rm -f "$tag" > /dev/null 2>&1
  [ "$CASE_RED" -eq 0 ] && summary "| $CASE ($(value "$facts" arch)) | ok |" || summary "| $CASE ($(value "$facts" arch)) | **red** |"
}

summary "### A project wearing postgres, on real images"
summary "| case | result |"
summary "| --- | --- |"
# Its own descriptor: nothing a case runs may read the table.
while IFS='|' read -r -u 3 id preset node major image codename; do
  [ -n "$id" ] || continue
  if [ "${#SELECTED[@]}" -gt 0 ]; then case " ${SELECTED[*]} " in *" $id "*) ;; *) continue ;; esac; fi
  run_case "$id" "$preset" "$node" "$major" "$image" "$codename"
done 3<<< "$CASES"

echo
if [ "$FINDINGS" -ne 0 ]; then echo "FAIL: a project wearing postgres does not get what the layer promises (above)."; exit 1; fi
if [ "$COULD_NOT" -ne 0 ]; then echo "COULD NOT RUN: nothing is known about the cases named above."; exit 2; fi
echo "PASS"
