#!/usr/bin/env bash
# A generated house devcontainer on a REAL engine and REAL images: does the project's package manager answer?
#
# tools/test-layers runs the installer against fakes and tools/test-generators reads what it renders; neither can say that
# `house.package-manager.sh` gets through typescript-node:<major> as root, then works for the image's non-root user. An
# image's package managers are the image's accident (:24 ships yarn 1 and a pnpm of its own choosing, :26 was observed with
# no yarn and no corepack), so only a real build says. docs/features/2026-11-04-house-docker-open-items/DECISION.md, D5.
#
# FOR EACH CASE: one project made once with this checkout (`house.sh new --local --preset=node`), its package.json, .nvmrc
# and lockfile set to the case, the devcontainer generator re-run, then `docker build` from the context devcontainer.json
# names. In the image, as devcontainer.json's remoteUser with the HOME the image gives it, the post-create's own sections
# (its preamble, volume ownership, the project's dependencies) run in a workspace holding the generated .devcontainer and a
# dependency-free package.json: the real one names a toolkit build no registry has, and all the install has to prove is
# that the package manager works. Features are the devcontainer CLI's and no package manager comes from them.
#
# ASSERTED: the Dockerfile states the case's spec; the image layer succeeded, read from the installer's own lines in the
# build log, because the Dockerfile's `||` keeps the build green when it fails; an image already right installs nothing; the
# post-create step exits 0 and the version answers; a second container start on the same image and ~/.local volume is a no-op;
# then the hand-back: the non-root user re-installs another version over what root installed, into the prefix, leaving no
# orphan directory, dangling bin or root-owned file.
#
# Exit codes, as check.sh: 0 all hold; 1 a case's assertion or build failed; 2 could not run, so nothing is known about
# that case (no docker, no base image, an engine error, `new` failing). A finding outranks a could-not-run.
#
#   bash tools/check-runner-image/devcontainer.sh [case…]    (docker, the network, Node 22.18+, yarn; ~3 minutes a case)
#   bash tools/check-runner-image/test.sh                    its own branches, against a fake docker
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENGINE="$ROOT/plugins/house/engine"
VERSIONS="$ENGINE/nx-tools/src/generators/_utils/versions.ts"

notice() { echo "$2"; [ -z "${GITHUB_ACTIONS:-}" ] || echo "::$1::$2"; }
summary() { [ -z "${GITHUB_STEP_SUMMARY:-}" ] || echo "$1" >> "$GITHUB_STEP_SUMMARY"; }

# What a project naming no version gets: the house's own first pin, so moving the pin does not redden this.
YARN_PIN="$(sed -n "s/^[[:space:]]*yarn: \['\([^']*\)'.*/\1/p" "$VERSIONS" | head -n 1)"
[ -n "$YARN_PIN" ] || { notice error "No yarn pin in $VERSIONS: COULD NOT RUN."; exit 2; }

# id | Node | packageManager | lockfile | the spec the image must state | pm | the version it must answer | what the image layer does | what node re-installs
# pnpm's versions are neither the image's (12.x) nor, on 24, the house pin: an exact declaration has to be honoured as written.
CASES="
yarn1-node24|24|yarn@1.22.22|yarn.lock|yarn@1.22.22|yarn|1.22.22|none|yarn@1.22.21
yarn1-node26|26|yarn@1.22.22|yarn.lock|yarn@1.22.22|yarn|1.22.22|install|yarn@1.22.21
pnpm-node24|24|pnpm@10.30.0||pnpm@10.30.0|pnpm|10.30.0|install|pnpm@10.33.0
pnpm-node26|26|pnpm@10.34.9||pnpm@10.34.9|pnpm|10.34.9|install|pnpm@10.33.0
yarn4-node24|24|yarn@4.17.1||yarn@4.17.1|yarn|4.17.1|install|yarn@4.18.1
lockfile-node26|26||yarn.lock|yarn|yarn|$YARN_PIN|install|yarn@1.22.21
"

SELECTED=("$@")
for wanted in ${SELECTED[@]+"${SELECTED[@]}"}; do
  case "$CASES" in *"
$wanted|"*) ;; *) echo "usage: devcontainer.sh [case…]; cases: $(printf '%s\n' "$CASES" | cut -d'|' -f1 | xargs)" >&2; exit 2 ;; esac
done

command -v docker > /dev/null 2>&1 || { notice error "COULD NOT RUN: no docker on PATH."; exit 2; }

WORK="$(mktemp -d)"
IMAGES=()
VOLUMES=()
cleanup() {
  [ "${#IMAGES[@]}" -eq 0 ] || docker image rm -f "${IMAGES[@]}" > /dev/null 2>&1
  [ "${#VOLUMES[@]}" -eq 0 ] || docker volume rm -f "${VOLUMES[@]}" > /dev/null 2>&1
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

# Lines of the program's own output in a plain BuildKit log: `#7 3.21 [package-manager] …`. Never the step's header
# (`#7 [3/3] RUN … || echo "[package-manager] not installed …"`), which states the soft-fail's words on every build.
installer_lines() { sed -n 's/^#[0-9]* [0-9.]* \(\[package-manager\].*\)$/\1/p' "$1"; }

# The inside of a container. No `set -e`: every fact is reported for the host to judge, and `probe=done` says it got to the end.
write_inside() {
  cat > "$1" <<'INSIDE'
#!/usr/bin/env bash
MODE="$1"; PM="$2"; SPEC="${3:-}"; PATH_TEMPLATE="$4"
WS="$PWD"
PATH="${PATH_TEMPLATE//\$\{containerWorkspaceFolder\}/$WS}"
PATH="${PATH//\$\{containerEnv:PATH\}/$IMAGE_PATH}"
export PATH
echo "home=$HOME"
if [ "$MODE" = start ]; then
  bash .e2e/step.sh 2>&1; echo "step.rc=$?"
else
  # Away from the project: pnpm in a project switches itself to the version that project declares.
  cd "$HOME" && { sh "$WS/.devcontainer/house.package-manager.sh" "$SPEC" 2>&1; echo "step.rc=$?"; }
fi
hash -r
echo "pm.path=$(command -v "$PM")"
echo "pm.version=$("$PM" --version 2>/dev/null </dev/null | head -n 1)"
PREFIX="$(npm prefix -g)"
echo "orphans=$(find "$PREFIX/lib/node_modules" "$HOME/.local/lib/node_modules" -mindepth 1 -maxdepth 2 -type d \( -path '*/node_modules/.*' -o -path '*/node_modules/@*/.*' \) 2>/dev/null | xargs)"
echo "dangling=$(find "$PREFIX/bin" "$HOME/.local/bin" -xtype l 2>/dev/null | xargs)"
echo "rootowned=$(find "$PREFIX/lib/node_modules" "$PREFIX/bin" -user 0 2>/dev/null | wc -l)"
echo "probe=done"
INSIDE
}

# The post-create's preamble and the two sections this asks about, as generated. Empty output means it lost one of them.
extract_step() {
  [ "$(grep -cE '^# --- (Volume ownership|The project.s dependencies)' "$1")" = 2 ] || return 1
  awk '/^# --- / { head = 1; on = ($0 ~ /^# --- (Volume ownership|The project.s dependencies)/) } !head || on' "$1"
}

run_in_image() {   # <output file> <mode> <spec or empty> [docker run args…]: 0 when it reached its end, else could-not-run has been said
  local out="$1" mode="$2" spec="$3" rc; shift 3
  tar -C "$CASE_WS" -cf - . | docker run -i --rm --user "$RUN_USER" "$@" "$TAG" bash -c \
    'IMAGE_PATH="$PATH"; export IMAGE_PATH; mkdir -p "$HOME/ws" && tar -xf - -C "$HOME/ws" && cd "$HOME/ws" && exec bash .e2e/inside.sh "$@"' _ \
    "$mode" "$PM" "$spec" "$PATH_TEMPLATE" > "$out" 2>&1
  rc="${PIPESTATUS[1]}"
  sed 's/^/    /' "$out"
  if [ "$rc" -ne 0 ] || ! grep -q '^probe=done$' "$out"; then could_not "docker run ($mode) exited $rc before the probe's end"; return 1; fi
}

common_facts() {   # <output file> <the version it must answer> <label>
  [ "$(value "$1" step.rc)" = 0 ]; check $? "$3: the step exited 0 (it exited $(value "$1" step.rc))"
  [ "$(value "$1" pm.version)" = "$2" ]; check $? "$3: $PM answers $2 (it answers '$(value "$1" pm.version)', from $(value "$1" pm.path))"
  [ -z "$(value "$1" orphans)" ]; check $? "$3: no orphaned directory in the prefix ($(value "$1" orphans))"
  [ -z "$(value "$1" dangling)" ]; check $? "$3: no dangling bin ($(value "$1" dangling))"
}

PROJECT="$WORK/base"
echo "One project, made with this checkout on Node $(node --version 2>/dev/null): house.sh new --local --preset=node"
if ! PROJECTS_DIR="$WORK" bash "$ENGINE/house.sh" new --local --preset=node base < /dev/null > "$WORK/new.log" 2>&1; then
  CASE=new; tail -n 40 "$WORK/new.log"; could_not "house.sh new --local failed: no project to generate from"; exit 2
fi

# Which yarn or pnpm the project declares is all that may differ between cases; a `yarn-path` would make any yarn right.
set_project() {   # <Node> <packageManager or empty> <lockfile or empty>
  rm -rf "$PROJECT/.yarnrc" "$PROJECT/.yarn" "$PROJECT/yarn.lock" "$PROJECT/pnpm-lock.yaml"
  echo "$1" > "$PROJECT/.nvmrc"
  DECLARED="$2" node -e '
    const fs = require("fs"), file = process.argv[1], manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    if (process.env.DECLARED) manifest.packageManager = process.env.DECLARED; else delete manifest.packageManager;
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");' "$PROJECT/package.json"
  [ -z "$3" ] || echo '# yarn lockfile v1' > "$PROJECT/$3"
}

run_case() {
  local node="$2" declared="$3" lockfile="$4" spec="$5" version="$7" image_does="$8" reinstall="$9"
  PM="$6"; CASE="$1"; CASE_RED=0
  echo; echo "=== $CASE: Node $node, ${declared:-no declaration}${lockfile:+, $lockfile}"

  local base="mcr.microsoft.com/devcontainers/typescript-node:$node"
  if ! docker pull -q "$base" > "$WORK/pull.log" 2>&1; then
    sed 's/^/    /' "$WORK/pull.log"; could_not "docker pull $base failed"; summary "| $CASE | could not run |"; return
  fi

  set_project "$node" "$declared" "$lockfile"
  if ! (cd "$PROJECT" && NX_DAEMON=false NX_TUI=false ./node_modules/.bin/nx g @bespunky/nx-tools:devcontainer base --no-interactive) < /dev/null > "$WORK/generate.log" 2>&1; then
    tail -n 30 "$WORK/generate.log"; check 1 "the devcontainer generator ran"; summary "| $CASE | **failed** |"; return
  fi

  local dc="$PROJECT/.devcontainer" json="$PROJECT/.devcontainer/devcontainer.json" dockerfile context local_target
  dockerfile="$(sed -n 's/^[[:space:]]*"dockerfile"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$json" | head -n 1)"
  context="$(sed -n 's/^[[:space:]]*"context"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$json" | head -n 1)"
  RUN_USER="$(sed -n 's/^[[:space:]]*"remoteUser"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$json" | head -n 1)"
  PATH_TEMPLATE="$(sed -n 's/^[[:space:]]*"PATH"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$json" | head -n 1)"
  local_target="$(sed -n 's/.*target=\(\/[^,]*\/\.local\),type=volume.*/\1/p' "$json" | head -n 1)"
  if [ -z "$dockerfile" ] || [ -z "$context" ] || [ -z "$RUN_USER" ] || [ -z "$PATH_TEMPLATE" ] || [ -z "$local_target" ]; then
    check 1 "devcontainer.json names a build, a remoteUser, a PATH and a ~/.local volume"; summary "| $CASE | **failed** |"; return
  fi

  says "$dc/$dockerfile" "FROM $base"; check $? "the generated Dockerfile is FROM $base"
  says "$dc/$dockerfile" "house.package-manager.sh '$spec'"; check $? "the generated Dockerfile states '$spec'"

  CASE_WS="$WORK/ws-$CASE"
  mkdir -p "$CASE_WS/.e2e"
  cp -R "$dc" "$CASE_WS/.devcontainer"
  cp "$PROJECT/.nvmrc" "$CASE_WS/"
  DECLARED="$declared" node -e '
    const manifest = { name: "e2e", version: "0.0.0", private: true };
    if (process.env.DECLARED) manifest.packageManager = process.env.DECLARED;
    process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");' > "$CASE_WS/package.json"
  [ -z "$lockfile" ] || cp "$PROJECT/$lockfile" "$CASE_WS/$lockfile"
  write_inside "$CASE_WS/.e2e/inside.sh"
  if ! extract_step "$dc/post-create.sh" > "$CASE_WS/.e2e/step.sh"; then
    check 1 "the generated post-create.sh has its volume-ownership and dependencies sections"; summary "| $CASE | **failed** |"; return
  fi

  # --no-cache: a cached layer prints nothing, and the installer's lines are the evidence.
  TAG="house-devcontainer-e2e-$CASE"
  IMAGES+=("$TAG")
  local build="$WORK/build-$CASE.log" lines="$WORK/lines-$CASE" brc=0
  DOCKER_BUILDKIT=1 docker build --no-cache --progress=plain -f "$dc/$dockerfile" -t "$TAG" "$dc/$context" < /dev/null > "$build" 2>&1 || brc=$?
  if [ "$brc" -ne 0 ]; then
    tail -n 40 "$build" | sed 's/^/    /'
    check "$brc" "docker build exited 0 (it exited $brc)"; summary "| $CASE | **build failed** |"; return
  fi
  echo "  ok   docker build exited 0"
  installer_lines "$build" > "$lines"
  sed 's/^/    /' "$lines"
  ! says "$lines" 'not installed in the image'; check $? "the image layer's installer exited 0, not hidden by the soft-fail"
  if [ "$image_does" = none ]; then
    says "$lines" "$PM $version — nothing to install"; check $? "the spec is already right, so the layer says nothing to install"
    ! says "$lines" 'npm install -g'; check $? "…and installs nothing"
  else
    says "$lines" "$PM $version installed"; check $? "the layer installed $PM $version"
  fi

  local volume="house-devcontainer-e2e-$CASE-local" first="$WORK/first-$CASE" second="$WORK/second-$CASE" again="$WORK/again-$CASE" back="$WORK/back-$CASE"
  VOLUMES+=("$volume")
  local mount="source=$volume,target=$local_target,type=volume"

  echo "  first container start, as $RUN_USER"
  if run_in_image "$first" start "" --mount "$mount"; then
    [ "$(value "$first" home)" = "${local_target%/.local}" ]; check $? "HOME is ${local_target%/.local} (it is '$(value "$first" home)')"
    common_facts "$first" "$version" "first start"
    says "$first" "[post-create] package manager: $PM"; check $? "first start: the post-create detected $PM"
    says "$first" "$PM $version — nothing to install"; check $? "first start: the image already provided it"
    ! says "$first" '[package-manager] npm install -g'; check $? "first start: installed nothing"
    if [ "$image_does" = install ]; then
      [ "$(value "$first" rootowned)" = 0 ]; check $? "first start: the image's install was handed back ($(value "$first" rootowned) root-owned left in the prefix)"
    fi
  fi

  echo "  second container start, on the same image and volume"
  if run_in_image "$again" start "" --mount "$mount"; then
    common_facts "$again" "$version" "second start"
    says "$again" "$PM $version — nothing to install"; check $? "second start: nothing to install"
    ! says "$again" '[package-manager] npm install -g'; check $? "second start: installed nothing"
    ! says "$again" 'reclaiming'; check $? "second start: no volume to reclaim"
  fi

  echo "  $RUN_USER re-installs $reinstall over the image's copy"
  if run_in_image "$back" reinstall "$reinstall"; then
    common_facts "$back" "${reinstall#*@}" "re-install"
    if [ "$image_does" = install ]; then
      ! says "$back" 'installed in ~/.local'; check $? "re-install: replaced root's copy in the prefix, with no fallback to ~/.local"
      [ "$(value "$back" rootowned)" = 0 ]; check $? "re-install: nothing root-owned in the prefix ($(value "$back" rootowned))"
    fi
  fi

  docker image rm -f "$TAG" > /dev/null 2>&1
  [ "$CASE_RED" -eq 0 ] && summary "| $CASE | ok |" || summary "| $CASE | **red** |"
}

summary "### Generated devcontainers on real images"
summary "| case | result |"
summary "| --- | --- |"
# Its own descriptor: nothing a case runs may read the table.
while IFS='|' read -r -u 3 id node declared lockfile spec pm version image_does reinstall; do
  [ -n "$id" ] || continue
  if [ "${#SELECTED[@]}" -gt 0 ]; then case " ${SELECTED[*]} " in *" $id "*) ;; *) continue ;; esac; fi
  run_case "$id" "$node" "$declared" "$lockfile" "$spec" "$pm" "$version" "$image_does" "$reinstall"
done 3<<< "$CASES"

echo
if [ "$FINDINGS" -ne 0 ]; then echo "FAIL: a generated devcontainer does not hold what it promises (above)."; exit 1; fi
if [ "$COULD_NOT" -ne 0 ]; then echo "COULD NOT RUN: nothing is known about the cases named above."; exit 2; fi
echo "PASS"
