#!/usr/bin/env bash
# The runner-image checks' own decisions, against a fake docker and a fake curl: no image, no network, seconds. Whether a
# real image passes is what check.sh, e2e.sh, devcontainer.sh and postgres-image.sh are for; this only proves that each answer they can get produces the
# right exit code and the right words, because a checker whose red branches have never run is a checker nobody can trust.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$ROOT/tools/check-runner-image"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILED=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; FAILED=1; }

mkdir -p "$TMP/bin"
export FAKE_ARGV="$TMP/argv"
cat > "$TMP/bin/docker" <<'FAKE'
#!/usr/bin/env bash
[ "$1" = "run" ] || exit 0
all="$*"
case "$all" in
  *'probe=done'*)
    echo "$all" >> "$FAKE_ARGV"
    [ ! -t 0 ] && read -r _ && echo "probe had stdin" >> "$FAKE_ARGV"
    [ -z "${FAKE_RUN_STDERR:-}" ] || echo "$FAKE_RUN_STDERR" >&2
    [ -z "${FAKE_PROBE_STDOUT+x}" ] || printf '%b' "$FAKE_PROBE_STDOUT"
    exit "${FAKE_RUN_RC:-0}" ;;
  *'command -v'*) exit 0 ;;   # house.sh's up-front check
  *' chown '*) exit 0 ;;
esac
# The program: it creates the project under the directory mounted at /work.
echo "$all" >> "$FAKE_ARGV"
while [ "$#" -gt 0 ]; do
  case "$2" in *:/work) work="${2%:/work}" ;; esac
  shift
done
[ "${FAKE_PROGRAM_RC:-0}" -eq 0 ] || exit "$FAKE_PROGRAM_RC"
mkdir -p "$work/runner-image-e2e"
[ -n "${FAKE_NO_DOC:-}" ] || : > "$work/runner-image-e2e/HOUSE.md"
[ -n "${FAKE_NO_NVMRC:-}" ] || echo "$FAKE_MAJOR" > "$work/runner-image-e2e/.nvmrc"
[ -n "${FAKE_NO_DECLARATION:-}" ] || echo '{ "packageManager": "yarn@1.22.22" }' > "$work/runner-image-e2e/package.json"
FAKE
cat > "$TMP/bin/curl" <<'CURL'
#!/usr/bin/env bash
echo "curl $*" >> "$FAKE_ARGV"
# FAKE_NPM_404S_FILE holds how many more times to answer 404: a version npm is about to serve.
if [ -n "${FAKE_NPM_404S_FILE:-}" ] && [ "$(cat "$FAKE_NPM_404S_FILE")" -gt 0 ]; then
  echo "$(($(cat "$FAKE_NPM_404S_FILE") - 1))" > "$FAKE_NPM_404S_FILE"
  printf 404
  exit 0
fi
printf "%s" "${FAKE_NPM_STATUS:-200}"
CURL
chmod +x "$TMP/bin/"*

image_with() {   # <yarn path> <yarn version> <corepack path> <pnpm path> [home.writable] [node path]
  printf 'node.path=%s\nnode.version=v24.0.0\nyarn.path=%s\nyarn.version=%s\ncorepack.path=%s\ncorepack.version=%s\npnpm.path=%s\npnpm.version=%s\nhome.writable=%s\nuid=4242\nprobe=done\n' \
    "${6-/usr/local/bin/node}" "$1" "$2" "$3" "${3:+0.30.0}" "$4" "${4:+9.0.0}" "${5:-yes}"
}

check_case() {   # <name> <expected rc> <must say> <must NOT say> [ENV=VAL…]
  local name="$1" want="$2" say="$3" not="$4" got out; shift 4
  : > "$FAKE_ARGV"
  out="$(env PATH="$TMP/bin:$PATH" GITHUB_ACTIONS= GITHUB_STEP_SUMMARY= "$@" bash "$HERE/check.sh" 2>&1)"; got=$?
  if [ "$got" != "$want" ]; then fail "$name: exit $got, wanted $want"; printf '%s\n' "$out" | sed 's/^/       /'; return; fi
  case "$out" in *"$say"*) ;; *) fail "$name: never said '$say'"; printf '%s\n' "$out" | sed 's/^/       /'; return ;; esac
  if [ -n "$not" ]; then case "$out" in *"$not"*) fail "$name: wrongly said '$not'"; return ;; esac; fi
  ok "$name (exit $got)"
}

echo "check.sh"
GOOD="$(image_with /usr/local/bin/yarn 1.22.22 '' '')"
check_case "yarn 1, no corepack, no pnpm: passes and reports" 0 "pnpm: absent" "BROKEN" FAKE_PROBE_STDOUT="$GOOD"
check_case "says which yarn it found" 0 "has yarn 1.22.22" "" FAKE_PROBE_STDOUT="$GOOD"
check_case "reports a pnpm that is there" 0 "pnpm: 9.0.0" "" FAKE_PROBE_STDOUT="$(image_with /usr/local/bin/yarn 1.22.22 /c /p)"
check_case "no yarn: broken, says what to do" 1 "npm install -g yarn@1.22.22" "COULD NOT RUN" FAKE_PROBE_STDOUT="$(image_with '' '' '' '')"
check_case "no yarn: names the fact" 1 "has no yarn" "" FAKE_PROBE_STDOUT="$(image_with '' '' '' '')"
check_case "yarn 4: wrong major is broken" 1 "has yarn 4.1.0" "" FAKE_PROBE_STDOUT="$(image_with /y 4.1.0 '' '')"
check_case "yarn that prints no version: broken" 1 "printed nothing" "" FAKE_PROBE_STDOUT="$(image_with /y '' '' '')"
check_case "no node: broken" 1 "has no node" "COULD NOT RUN" FAKE_PROBE_STDOUT="$(image_with /y 1.22.22 '' '' yes '')"
check_case "an unwritable HOME: broken, for the container's uid" 1 "not writable by uid 4242" "COULD NOT RUN" FAKE_PROBE_STDOUT="$(image_with /y 1.22.22 '' '' no)"
check_case "a broken image does not offer a digest pin as the way out" 1 "rejected" "pins this major" FAKE_PROBE_STDOUT="$(image_with '' '' '' '')"
check_case "engine error 125: could not run, no finding about yarn" 2 "COULD NOT RUN" "has no yarn" FAKE_RUN_RC=125 FAKE_RUN_STDERR="manifest unknown"
check_case "engine error 125: shows the engine's words" 2 "manifest unknown" "" FAKE_RUN_RC=125 FAKE_RUN_STDERR="manifest unknown"
check_case "no bash in the image (127): could not run" 2 "COULD NOT RUN" "BROKEN" FAKE_RUN_RC=127
check_case "exit 0 with no sentinel: could not run" 2 "did not reach its end" "BROKEN" FAKE_PROBE_STDOUT="yarn.path=\n"
check_case "a profile that prints noise changes nothing" 0 "has yarn 1.22.22" "" FAKE_PROBE_STDOUT="welcome yarn.path=/nope
$GOOD"

# Asked the way the program runs, of the image the engine picks, and never of a cached copy.
MAJOR="$(sed -n "s/^export const HOUSE_NODE_MAJOR = '\([0-9]*\)';.*/\1/p" "$ROOT/plugins/house/engine/nx-tools/src/generators/_utils/versions.ts")"
: > "$FAKE_ARGV"
echo 'stdin a tool could wait on' | env PATH="$TMP/bin:$PATH" GITHUB_STEP_SUMMARY= FAKE_PROBE_STDOUT="$GOOD" bash "$HERE/check.sh" >/dev/null 2>&1
ARGV="$(cat "$FAKE_ARGV")"
case "$ARGV" in *"probe had stdin"*) fail "the probe inherited stdin" ;; *) ok "the probe gets no stdin" ;; esac
# The engine's own value, not a copy of it: the point is that this asks what the program would be asked.
CONTAINER_HOME="$(. "$ROOT/plugins/house/engine/container-engine.sh"; echo "$CONTAINER_HOME")"
for want in "--pull=always" "-e HOME=$CONTAINER_HOME" "typescript-node:$MAJOR bash -lc" "-u $(id -u):$(id -g)"; do
  case "$ARGV" in *"$want"*) ok "docker run carries $want" ;; *) fail "docker run lacks $want: $ARGV" ;; esac
done

# The two write where GitHub reads them, and only there.
SUMMARY="$TMP/summary"
out="$(env PATH="$TMP/bin:$PATH" GITHUB_ACTIONS=true GITHUB_STEP_SUMMARY="$SUMMARY" FAKE_PROBE_STDOUT="$(image_with '' '' '' '')" bash "$HERE/check.sh" 2>&1)"
case "$out" in *'::error title='*) ok "a broken image annotates the run" ;; *) fail "no ::error annotation" ;; esac
grep -q 'pnpm: absent' "$SUMMARY" && ok "the step summary reports pnpm" || fail "step summary lacks pnpm"

# No docker at all. PATH holds only what the script needs, so this holds on a machine that has docker.
mkdir -p "$TMP/nodocker"
for tool in bash sed dirname head id tail cat mktemp rm; do ln -s "$(command -v "$tool")" "$TMP/nodocker/$tool"; done
out="$(PATH="$TMP/nodocker" GITHUB_ACTIONS= "$TMP/nodocker/bash" "$HERE/check.sh" 2>&1)"; got=$?
if [ "$got" = 2 ] && case "$out" in *"no docker on PATH"*) true ;; *) false ;; esac; then
  ok "no docker: could not run (exit 2)"
else
  fail "no docker: exit $got: $out"
fi

e2e_case() {   # <name> <road> <expected rc> <must say> <must NOT say> [ENV=VAL…]
  local name="$1" road="$2" want="$3" say="$4" not="$5" got out; shift 5
  : > "$FAKE_ARGV"
  out="$(env PATH="$TMP/bin:$PATH" GITHUB_ACTIONS= GITHUB_EVENT_NAME= HOME="$TMP" GIT_CONFIG_GLOBAL=/dev/null FAKE_PROBE_STDOUT= FAKE_MAJOR="$MAJOR" "$@" bash "${E2E_SH:-$HERE/e2e.sh}" "$road" 2>&1)"; got=$?
  if [ "$got" != "$want" ]; then fail "$name: exit $got, wanted $want"; printf '%s\n' "$out" | tail -n 15 | sed 's/^/       /'; return; fi
  case "$out" in *"$say"*) ;; *) fail "$name: never said '$say'"; printf '%s\n' "$out" | tail -n 15 | sed 's/^/       /'; return ;; esac
  if [ -n "$not" ]; then case "$out" in *"$not"*) fail "$name: wrongly said '$not'"; return ;; esac; fi
  ok "$name (exit $got)"
}

echo "e2e.sh"
e2e_case "local road: a project and NEW_OK pass" local 0 "HOUSE.md exists" "FAILED"
if grep -q 'npm pack' "$FAKE_ARGV"; then ok "the local road installs the working tree"; else fail "the local road did not pack"; fi
e2e_case "local road: the program dying fails" local 1 "FAILED (local road): house.sh exited 0 (it exited 7)" "" FAKE_PROGRAM_RC=7
e2e_case "local road: no HOUSE.md fails, even with NEW_OK" local 1 "FAILED (local road): runner-image-e2e/HOUSE.md exists" "" FAKE_NO_DOC=1
e2e_case "registry road: on npm, walks it" registry 0 "walking the registry road" "SKIP registry road"
if grep -q 'npm pack' "$FAKE_ARGV"; then fail "the registry road packed the working tree"; else ok "the registry road installs from npm"; fi
e2e_case "registry road: unpublished is a stated skip, no run" registry 0 "SKIP registry road" "Verdict" FAKE_NPM_STATUS=404
if grep -q 'bash -lc' "$FAKE_ARGV"; then fail "the skip still ran the program"; else ok "the skip ran nothing"; fi
e2e_case "registry road: npm not answering fails" registry 1 "Could not tell" "Verdict" FAKE_NPM_STATUS=000
e2e_case "registry road: a 404 on a schedule means the release never arrived" registry 1 "did not reach it" "SKIP" FAKE_NPM_STATUS=404 GITHUB_EVENT_NAME=schedule
e2e_case "registry road: …and after a publish, once npm has had its time" registry 1 "did not reach it" "SKIP" FAKE_NPM_STATUS=404 GITHUB_EVENT_NAME=workflow_run NPM_SETTLE_SECONDS=2 NPM_SETTLE_INTERVAL=1
case "$(grep -c '^curl ' "$FAKE_ARGV")" in 3) ok "…asked again until the time ran out" ;; *) fail "…asked npm $(grep -c '^curl ' "$FAKE_ARGV") times, not 3" ;; esac
echo 2 > "$TMP/npm-404s"
e2e_case "registry road: a version npm serves a moment after its publish walks the road" registry 0 "walking the registry road" "did not reach it" FAKE_NPM_404S_FILE="$TMP/npm-404s" GITHUB_EVENT_NAME=workflow_run NPM_SETTLE_INTERVAL=0
echo 1 > "$TMP/npm-404s"
e2e_case "registry road: a 404 on a schedule does not wait" registry 1 "did not reach it" "just published" FAKE_NPM_404S_FILE="$TMP/npm-404s" GITHUB_EVENT_NAME=schedule
e2e_case "registry road: …but not on a push, which may be racing the publish" registry 0 "SKIP registry road" "" FAKE_NPM_STATUS=404 GITHUB_EVENT_NAME=push
e2e_case "no road: usage" "" 2 "usage" ""
e2e_case "no .nvmrc fails" local 1 "FAILED (local road): .nvmrc" "" FAKE_NO_NVMRC=1
e2e_case "no packageManager fails" local 1 "FAILED (local road): package.json declares" "" FAKE_NO_DECLARATION=1

# The verdict on what house.sh says, and what it is asked: its real report cannot be made to lie, so a stand-in plays it.
COPY="$TMP/copy"
mkdir -p "$COPY/tools/check-runner-image" "$COPY/plugins/house/engine/nx-tools/src/generators/_utils"
cp "$HERE/e2e.sh" "$COPY/tools/check-runner-image/"
cp "$ROOT/plugins/house/engine/container-engine.sh" "$COPY/plugins/house/engine/"
cp "$ROOT/plugins/house/engine/nx-tools/package.json" "$COPY/plugins/house/engine/nx-tools/"
cp "$ROOT/plugins/house/engine/nx-tools/src/generators/_utils/versions.ts" "$COPY/plugins/house/engine/nx-tools/src/generators/_utils/"
cat > "$COPY/plugins/house/engine/house.sh" <<'FAKE'
#!/usr/bin/env bash
echo "house.sh $*" >> "$FAKE_ARGV"
read -r _ && echo "house.sh had stdin" >> "$FAKE_ARGV"
dir="$PROJECTS_DIR/runner-image-e2e"
mkdir -p "$dir"; : > "$dir/HOUSE.md"; echo "$FAKE_MAJOR" > "$dir/.nvmrc"; echo '{ "packageManager": "yarn@1.22.22" }' > "$dir/package.json"
printf '%b' "$FAKE_REPORT" | sed "s#<dir>#$dir#"
FAKE
IMAGE_REF="mcr.microsoft.com/devcontainers/typescript-node:$MAJOR"
export E2E_SH="$COPY/tools/check-runner-image/e2e.sh"
e2e_case "stand-in: a true report passes" local 0 "ran on $IMAGE_REF" "FAILED" "FAKE_REPORT=NEW_OK <dir> (image=$IMAGE_REF x)\n"
args="$(grep '^house.sh ' "$FAKE_ARGV")"
for want in --docker --local --preset=angular runner-image-e2e; do
  case "$args" in *" $want"*) ok "the local road passes $want" ;; *) fail "the local road lacks $want: $args" ;; esac
done
e2e_case "stand-in: no NEW_OK fails" local 1 "FAILED (local road): it reported NEW_OK" "" "FAKE_REPORT=something else\n"
e2e_case "stand-in: a host-Node run fails" local 1 "FAILED (local road): it ran on" "" "FAKE_REPORT=NEW_OK <dir> (runtime=native node x)\n"
e2e_case "stand-in: the registry road does not pass --local" registry 0 "walking" "FAILED" "FAKE_REPORT=NEW_OK <dir> (image=$IMAGE_REF x)\n"
case "$(grep '^house.sh ' "$FAKE_ARGV")" in *--local*) fail "the registry road passed --local" ;; *--docker*--preset=angular*) ok "the registry road passes --docker and the preset" ;; *) fail "registry road args: $(cat "$FAKE_ARGV")" ;; esac
# A prompt nobody can answer must not hang a CI job for 45 minutes.
: > "$FAKE_ARGV"
echo 'stdin a tool could wait on' | env PATH="$TMP/bin:$PATH" GITHUB_ACTIONS= HOME="$TMP" FAKE_MAJOR="$MAJOR" "FAKE_REPORT=NEW_OK <dir> (image=$IMAGE_REF x)\n" bash "$E2E_SH" local >/dev/null 2>&1
grep -q 'house.sh had stdin' "$FAKE_ARGV" && fail "house.sh inherited stdin" || ok "house.sh gets no stdin"
unset E2E_SH

# devcontainer.sh, against a fake docker that answers as a right image would unless a FAKE_ names a fault, and a stand-in
# house.sh whose project's `nx` writes the files the real generator does. Each fault must turn into the right exit and words.
DC="$TMP/dc"
mkdir -p "$DC/bin" "$DC/state" "$DC/tree/tools/check-runner-image" "$DC/tree/plugins/house/engine/nx-tools/src/generators/_utils"
cp "$HERE/devcontainer.sh" "$DC/tree/tools/check-runner-image/"
cp "$ROOT/plugins/house/engine/nx-tools/src/generators/_utils/versions.ts" "$DC/tree/plugins/house/engine/nx-tools/src/generators/_utils/"
export FAKE_DC_STATE="$DC/state"
cat > "$DC/tree/plugins/house/engine/house.sh" <<'FAKE'
#!/usr/bin/env bash
echo "house.sh $*" >> "$FAKE_ARGV"
[ "${FAKE_NEW_RC:-0}" -eq 0 ] || { echo "the project could not be made"; exit "$FAKE_NEW_RC"; }
dir="$PROJECTS_DIR/base"
mkdir -p "$dir/node_modules/.bin"
echo '{ "name": "base", "packageManager": "yarn@1.22.22" }' > "$dir/package.json"
cat > "$dir/node_modules/.bin/nx" <<'NX'
#!/usr/bin/env bash
echo "nx $*" >> "$FAKE_ARGV"
[ "${FAKE_NX_RC:-0}" -eq 0 ] || { echo "the generator threw"; exit "$FAKE_NX_RC"; }
spec="$(sed -n 's/.*"packageManager": "\([^"]*\)".*/\1/p' package.json)"
[ -n "$spec" ] || spec=yarn
[ -z "${FAKE_WRONG_SPEC:-}" ] || spec=npm
mkdir -p .devcontainer
cat > .devcontainer/devcontainer.json <<JSON
{
  "build": {
    "dockerfile": "house.Dockerfile",
    "context": "."
  },
  "remoteUser": "node",
  "remoteEnv": {
    "PATH": "/home/node/.local/bin:\${containerEnv:PATH}"
  },
  "mounts": [
    "source=x-local,target=/home/node/.local,type=volume"
  ]
}
JSON
printf 'FROM mcr.microsoft.com/devcontainers/typescript-node:%s\nRUN sh house.package-manager.sh '"'"'%s'"'"' || echo x\n' "$(cat .nvmrc)" "$spec" > .devcontainer/house.Dockerfile
: > .devcontainer/house.package-manager.sh
{
  echo '#!/usr/bin/env bash'
  [ -n "${FAKE_NO_SECTION:-}" ] || echo '# --- Volume ownership (DERIVED) ---'
  echo "# --- The project's dependencies (node) ---"
} > .devcontainer/post-create.sh
NX
chmod +x "$dir/node_modules/.bin/nx"
FAKE
cat > "$DC/bin/docker" <<'FAKE'
#!/usr/bin/env bash
sub="$1"; shift
echo "docker $sub $*" >> "$FAKE_ARGV"
case "$sub" in
  pull) [ "${FAKE_PULL_RC:-0}" -eq 0 ] || echo "manifest unknown"; exit "${FAKE_PULL_RC:-0}" ;;
  build)
    while [ "$#" -gt 0 ]; do case "$1" in -f) file="$2"; shift ;; -t) tag="$2"; shift ;; esac; shift; done
    spec="$(sed -n "s/.*house.package-manager.sh '\([^']*\)'.*/\1/p" "$file")"
    from="$(sed -n 's/^FROM .*:\([0-9]*\)$/\1/p' "$file")"
    version="${spec#*@}"; [ "$spec" != yarn ] || version="$FAKE_YARN_PIN"
    echo "$spec $version" > "$FAKE_DC_STATE/$tag"
    # The step's header states the soft-fail's words on every build, as BuildKit prints it.
    echo '#7 [2/2] RUN sh house.package-manager.sh || echo "[package-manager] not installed in the image; post-create tries again"'
    [ "${FAKE_BUILD_RC:-0}" -eq 0 ] || { echo '#7 ERROR: process did not complete'; exit "$FAKE_BUILD_RC"; }
    [ -z "${FAKE_CACHED:-}" ] || { echo '#7 CACHED'; exit 0; }
    if [ -n "${FAKE_SOFT_FAIL:-}" ]; then
      echo '#7 2.10 [package-manager] not installed in the image; post-create tries again'
    elif [ "$from:$spec" = 24:yarn@1.22.22 ] && [ -z "${FAKE_ALWAYS_INSTALLS:-}" ]; then
      echo '#7 0.20 [package-manager] yarn 1.22.22 — nothing to install'
    else
      echo "#7 0.20 [package-manager] npm install -g  ${spec%%@*}@$version"
      echo "#7 2.10 [package-manager] ${spec%%@*} $version installed"
    fi
    exit 0 ;;
  run)
    cat > /dev/null
    [ "${FAKE_RUN_RC:-0}" -eq 0 ] || { echo "OCI runtime create failed"; exit "$FAKE_RUN_RC"; }
    while [ "$#" -gt 0 ]; do case "$1" in house-devcontainer-e2e-*) tag="$1" ;; _) shift; break ;; esac; shift; done
    mode="$1"; pm="$2"; spec="$3"
    read -r _ version < "$FAKE_DC_STATE/$tag"
    [ -n "${FAKE_NO_SENTINEL:-}" ] && exit 0
    count="$FAKE_DC_STATE/$tag.$mode"; echo x >> "$count"
    echo "home=${FAKE_HOME:-/home/node}"
    if [ "$mode" = start ]; then
      echo "[post-create] package manager: $pm"
      if [ -n "${FAKE_START_INSTALLS:-}" ] && [ "$(wc -l < "$count")" -gt "$FAKE_START_INSTALLS" ]; then
        echo "[package-manager] npm install -g  $pm@$version"; echo "[package-manager] $pm $version installed"
      else
        echo "[package-manager] $pm $version — nothing to install"
      fi
    else
      version="${spec#*@}"
      echo "[package-manager] npm install -g  $spec"
      echo "[package-manager] $pm $version installed${FAKE_LOCAL_FALLBACK:+ in ~/.local}"
    fi
    echo "step.rc=${FAKE_STEP_RC:-0}"
    echo "pm.path=/usr/local/share/npm-global/bin/$pm"
    echo "pm.version=${FAKE_ANSWER:-$version}"
    echo "orphans=${FAKE_ORPHANS:-}"
    echo "dangling=${FAKE_DANGLING:-}"
    echo "rootowned=${FAKE_ROOTOWNED:-0}"
    echo "probe=done"
    exit 0 ;;
esac
exit 0
FAKE
chmod +x "$DC/bin/docker"

dc_case() {   # <name> <cases, space-separated, or empty for all> <expected rc> <must say> <must NOT say> [ENV=VAL…]
  local name="$1" cases="$2" want="$3" say="$4" not="$5" got out; shift 5
  : > "$FAKE_ARGV"; rm -f "$DC/state/"*
  # shellcheck disable=SC2086
  out="$(env PATH="$DC/bin:$PATH" GITHUB_ACTIONS= GITHUB_STEP_SUMMARY= HOME="$TMP" FAKE_YARN_PIN="$YARN_PIN" "$@" bash "$DC/tree/tools/check-runner-image/devcontainer.sh" $cases 2>&1)"; got=$?
  if [ "$got" != "$want" ]; then fail "$name: exit $got, wanted $want"; printf '%s\n' "$out" | tail -n 15 | sed 's/^/       /'; return; fi
  case "$out" in *"$say"*) ;; *) fail "$name: never said '$say'"; printf '%s\n' "$out" | tail -n 15 | sed 's/^/       /'; return ;; esac
  if [ -n "$not" ]; then case "$out" in *"$not"*) fail "$name: wrongly said '$not'"; return ;; esac; fi
  ok "$name (exit $got)"
}

echo "devcontainer.sh"
YARN_PIN="$(sed -n "s/^[[:space:]]*yarn: \['\([^']*\)'.*/\1/p" "$ROOT/plugins/house/engine/nx-tools/src/generators/_utils/versions.ts" | head -n 1)"
dc_case "every case on a right image passes" "" 0 "PASS" "FAILED"
for want in "new --local --preset=node base" "nx g @bespunky/nx-tools:devcontainer base --no-interactive" "--no-cache --progress=plain -f" "--user node" "target=/home/node/.local,type=volume" "typescript-node:26"; do
  grep -qF -- "$want" "$FAKE_ARGV" && ok "the run carries $want" || fail "the run lacks $want"
done
for id in yarn1-node24 yarn1-node26 pnpm-node24 pnpm-node26 yarn4-node24 lockfile-node26; do
  grep -q "docker build.*-t house-devcontainer-e2e-$id " "$FAKE_ARGV" && ok "it built $id" || fail "it never built $id"
done
dc_case "one case by name runs only that one" pnpm-node26 0 "pnpm-node26" "yarn1-node24"
dc_case "an unknown case: usage" nope 2 "usage" "PASS"
dc_case "the build failing: a finding, with the build's words" yarn1-node26 1 "FAILED (yarn1-node26): docker build exited 0 (it exited 3)" "first container start" FAKE_BUILD_RC=3
dc_case "the build's tail is shown" yarn1-node26 1 "process did not complete" "" FAKE_BUILD_RC=3
dc_case "the soft-fail hiding a failed layer: a finding" yarn1-node26 1 "not hidden by the soft-fail" "PASS" FAKE_SOFT_FAIL=1
dc_case "the soft-fail's words in the step header alone: no finding" yarn1-node26 0 "PASS" "FAILED"
dc_case "a cached layer printing nothing: a finding, not a pass" yarn1-node26 1 "the layer installed" "PASS" FAKE_CACHED=1
dc_case "an installed version when the image was right: a finding" yarn1-node24 1 "says nothing to install" "PASS" FAKE_ALWAYS_INSTALLS=1
dc_case "the wrong version answering: a finding" pnpm-node24 1 "pnpm answers 10.30.0 (it answers '0.0.1'" "PASS" FAKE_ANSWER=0.0.1
dc_case "the post-create step failing: a finding" pnpm-node24 1 "the step exited 0 (it exited 1)" "PASS" FAKE_STEP_RC=1
dc_case "a Dockerfile stating another spec: a finding" pnpm-node24 1 "states 'pnpm@10.30.0'" "PASS" FAKE_WRONG_SPEC=1
dc_case "post-create losing a section: a finding" pnpm-node24 1 "volume-ownership and dependencies" "PASS" FAKE_NO_SECTION=1
dc_case "the generator failing: a finding" pnpm-node24 1 "the devcontainer generator ran" "PASS" FAKE_NX_RC=4
dc_case "a HOME the image does not give: a finding" pnpm-node24 1 "HOME is /home/node (it is '/root')" "PASS" FAKE_HOME=/root
dc_case "a first start installing: a finding" pnpm-node24 1 "first start: installed nothing" "PASS" FAKE_START_INSTALLS=0
dc_case "only the second start installing: a finding" pnpm-node24 1 "second start: installed nothing" "first start: installed nothing (" FAKE_START_INSTALLS=1
dc_case "an orphan: a finding" pnpm-node24 1 "no orphaned directory in the prefix (/p/.pnpm-abc)" "PASS" FAKE_ORPHANS=/p/.pnpm-abc
dc_case "a dangling bin: a finding" pnpm-node24 1 "no dangling bin (/p/bin/pnpm)" "PASS" FAKE_DANGLING=/p/bin/pnpm
dc_case "root's copy never handed back: a finding" pnpm-node24 1 "root-owned" "PASS" FAKE_ROOTOWNED=2
dc_case "falling back to ~/.local after root's install: a finding" pnpm-node24 1 "no fallback to ~/.local" "PASS" FAKE_LOCAL_FALLBACK=1
dc_case "no base image: could not run, no verdict on the case" pnpm-node24 2 "COULD NOT RUN (pnpm-node24): docker pull" "FAILED" FAKE_PULL_RC=1
dc_case "an engine error at run: could not run" pnpm-node24 2 "COULD NOT RUN (pnpm-node24): docker run (start) exited 125" "FAILED" FAKE_RUN_RC=125
dc_case "exit 0 with no sentinel: could not run" pnpm-node24 2 "before the probe's end" "PASS" FAKE_NO_SENTINEL=1
dc_case "no project: could not run" pnpm-node24 2 "COULD NOT RUN (new)" "=== pnpm-node24" FAKE_NEW_RC=9
out="$(env PATH="$DC/bin:$PATH" GITHUB_ACTIONS= HOME="$TMP" FAKE_YARN_PIN="$YARN_PIN" FAKE_BUILD_RC=3 bash "$DC/tree/tools/check-runner-image/devcontainer.sh" pnpm-node24 pnpm-node26 2>&1)"; got=$?
[ "$got" = 1 ] && ok "two cases, a build failing: a finding" || fail "two cases, a build failing: exit $got"
case "$out" in *"=== pnpm-node26"*) ok "a red case does not stop the next" ;; *) fail "a red case stopped the next" ;; esac
out="$(PATH="$TMP/nodocker" GITHUB_ACTIONS= "$TMP/nodocker/bash" "$HERE/devcontainer.sh" 2>&1)"; got=$?
if [ "$got" = 2 ] && case "$out" in *"no docker on PATH"*) true ;; *) false ;; esac; then
  ok "no docker: could not run (exit 2)"
else
  fail "no docker: exit $got: $out"
fi

# postgres-image.sh, the same way: a fake docker answering as a right image would, a stand-in house.sh whose project's `nx` writes
# what the real generator does, and each fault must turn into the right exit and words. The inside's own lines are real: they
# were run against the real tools, and a real image is what the job is for.
PG="$TMP/pg"
mkdir -p "$PG/bin" "$PG/state" "$PG/tree/tools/check-runner-image" "$PG/tree/plugins/house/engine/nx-tools/src/generators/_utils"
cp "$HERE/postgres-image.sh" "$HERE/postgres-image.inside.sh" "$PG/tree/tools/check-runner-image/"
cp "$ROOT/plugins/house/engine/nx-tools/src/generators/_utils/versions.ts" "$PG/tree/plugins/house/engine/nx-tools/src/generators/_utils/"
export FAKE_PG_STATE="$PG/state"
DBMATE_PIN="$(sed -n "s/^export const DBMATE_VERSION = '\([^']*\)'.*/\1/p" "$ROOT/plugins/house/engine/nx-tools/src/generators/_utils/versions.ts")"
cat > "$PG/tree/plugins/house/engine/house.sh" <<'FAKE'
#!/usr/bin/env bash
echo "house.sh $*" >> "$FAKE_ARGV"
[ "${FAKE_NEW_RC:-0}" -eq 0 ] || { echo "the project could not be made"; exit "$FAKE_NEW_RC"; }
for name; do :; done
dir="$PROJECTS_DIR/$name"
mkdir -p "$dir/.bespunky"
tool="$dir/nx"
case "$*" in *--preset=node*) mkdir -p "$dir/node_modules/.bin"; tool="$dir/node_modules/.bin/nx" ;; esac
cat > "$tool" <<'NX'
#!/usr/bin/env bash
echo "nx $*" >> "$FAKE_ARGV"
[ "${FAKE_NX_RC:-0}" -eq 0 ] || { echo "the generator threw"; exit "$FAKE_NX_RC"; }
node="$(cat .nvmrc)"
major="$(sed 's/[^0-9]//g' .bespunky/postgres.json)"
case "$PWD" in *pg-agent) image=mcr.microsoft.com/devcontainers/base:debian; user=vscode ;; *) image="mcr.microsoft.com/devcontainers/typescript-node:$node"; user=node ;; esac
[ -z "${FAKE_WRONG_FROM:-}" ] || image=mcr.microsoft.com/devcontainers/other:1
[ -z "${FAKE_WRONG_MAJOR:-}" ] || major=16
mkdir -p .devcontainer
cat > .devcontainer/devcontainer.json <<JSON
{
  "build": {
    "dockerfile": "house.Dockerfile",
    "context": "."
  },
  "remoteUser": "$user",
  "remoteEnv": {
    "PATH": "/home/$user/.local/bin:\${containerEnv:PATH}"
  }
}
JSON
echo "FROM $image" > .devcontainer/house.Dockerfile
{
  echo "tool postgres usr/lib/postgresql/$major/bin usr/lib/*-linux-gnu x"
  [ -n "${FAKE_NO_CLOSURE:-}" ] || {
    echo "closure postgres trixie $major.6-aaaa libc6"
    echo "closure postgres bookworm $major.6-bbbb libc6"
  }
} > .devcontainer/house.packages.sh
NX
chmod +x "$tool"
FAKE
cat > "$PG/bin/docker" <<'FAKE'
#!/usr/bin/env bash
sub="$1"; shift
echo "docker $sub $*" >> "$FAKE_ARGV"
case "$sub" in
  pull) [ "${FAKE_PULL_RC:-0}" -eq 0 ] || echo "manifest unknown"; exit "${FAKE_PULL_RC:-0}" ;;
  build)
    while [ "$#" -gt 0 ]; do case "$1" in -f) file="$2"; shift ;; -t) tag="$2"; shift ;; esac; shift; done
    case "$tag" in *bookworm*) closure_of=bbbb; codename=bookworm ;; *) closure_of=aaaa; codename=trixie ;; esac
    case "$tag" in *pg17*) major=17 ;; *) major=18 ;; esac
    echo "$major $codename" > "$FAKE_PG_STATE/$tag"
    # The step's header states words of the installer on every build, as BuildKit prints it.
    echo "#7 [2/2] RUN sh house.packages.sh && echo [os-packages] postgres $major.6-$closure_of installed"
    [ "${FAKE_BUILD_RC:-0}" -eq 0 ] || { echo '#7 ERROR: apt-get satisfy could not be done'; exit "$FAKE_BUILD_RC"; }
    [ -n "${FAKE_CACHED:-}" ] && { echo '#7 CACHED'; exit 0; }
    [ -n "${FAKE_NO_SERVER:-}" ] || {
      echo "#7 1.00 [os-packages] installing postgres $major.6-$closure_of ($codename, amd64)"
      echo "#7 9.00 [os-packages] postgres $major.6-$closure_of installed"
    }
    [ -n "${FAKE_NO_DBMATE:-}" ] || echo "#7 9.10 [os-packages] dbmate $FAKE_DBMATE_PIN installed"
    exit 0 ;;
  run)
    cat > /dev/null
    [ "${FAKE_RUN_RC:-0}" -eq 0 ] || { echo "OCI runtime create failed"; exit "$FAKE_RUN_RC"; }
    args="$*"
    tag="$(printf '%s\n' "$@" | grep '^house-postgres-image-e2e-')"
    read -r major codename < "$FAKE_PG_STATE/$tag"
    echo "args=$args"
    [ -n "${FAKE_NO_SENTINEL:-}" ] && exit 0
    bin="${FAKE_BIN:-/usr/local/bin}"
    echo "uid=${FAKE_UID:-1000}"
    echo "codename=${FAKE_CODENAME:-$codename}"
    echo "arch=amd64"
    for tool in postgres psql initdb pg_ctl pg_dump dbmate; do
      if [ "$tool" = "${FAKE_NO_TOOL:-}" ]; then echo "path.$tool="; else echo "path.$tool=$bin/$tool"; fi
    done
    echo "wrapper.postgres=${FAKE_WRAPPER-# bespunky-house wrapper for postgres}"
    echo "version.postgres=postgres (PostgreSQL) ${FAKE_PG_VERSION:-$major.6} (Debian x)"
    echo "version.psql=psql (PostgreSQL) ${FAKE_PG_VERSION:-$major.6} (Debian x)"
    echo "version.dbmate=dbmate version ${FAKE_DBMATE_ANSWER:-$FAKE_DBMATE_PIN}"
    echo "initdb.rc=${FAKE_INITDB_RC:-0}"
    echo "boot.rc=${FAKE_BOOT_RC:-0}"
    echo "server.version=${FAKE_SERVER_VERSION:-$major.6 (Debian x)}"
    echo "server.vector=${FAKE_VECTOR-0.8.7}"
    echo "dbmate.rc=${FAKE_DBMATE_RC:-0}"
    echo "dbmate.row=${FAKE_ROW:-1}"
    echo "stop.rc=${FAKE_STOP_RC:-0}"
    echo "stop.pidfile=${FAKE_PIDFILE:-gone}"
    echo "probe=done"
    exit 0 ;;
esac
exit 0
FAKE
chmod +x "$PG/bin/docker"

pg_case() {   # <name> <cases, space-separated, or empty for all> <expected rc> <must say> <must NOT say> [ENV=VAL…]
  local name="$1" cases="$2" want="$3" say="$4" not="$5" got out; shift 5
  : > "$FAKE_ARGV"; rm -f "$PG/state/"*
  # shellcheck disable=SC2086
  out="$(env PATH="$PG/bin:$PATH" GITHUB_ACTIONS= GITHUB_STEP_SUMMARY= HOME="$TMP" FAKE_DBMATE_PIN="$DBMATE_PIN" "$@" bash "$PG/tree/tools/check-runner-image/postgres-image.sh" $cases 2>&1)"; got=$?
  if [ "$got" != "$want" ]; then fail "$name: exit $got, wanted $want"; printf '%s\n' "$out" | tail -n 15 | sed 's/^/       /'; return; fi
  case "$out" in *"$say"*) ;; *) fail "$name: never said '$say'"; printf '%s\n' "$out" | tail -n 15 | sed 's/^/       /'; return ;; esac
  if [ -n "$not" ]; then case "$out" in *"$not"*) fail "$name: wrongly said '$not'"; return ;; esac; fi
  ok "$name (exit $got)"
}

echo "postgres-image.sh"
ONE=pg17-bookworm-node18
pg_case "every case on a right image passes" "" 0 "PASS" "FAILED"
for want in "new --local --add-layer=postgres pg-agent" "new --local --preset=node --add-layer=postgres pg-node" "nx g @bespunky/nx-tools:devcontainer pg-node --no-interactive" "--no-cache --progress=plain -f" "--user vscode" "--user node" "typescript-node:18" "base:debian"; do
  grep -qF -- "$want" "$FAKE_ARGV" && ok "the run carries $want" || fail "the run lacks $want"
done
for id in pg18-trixie-agent pg17-trixie-node24 pg18-bookworm-node18 pg17-bookworm-node18; do
  grep -q "docker build.*-t house-postgres-image-e2e-$id " "$FAKE_ARGV" && ok "it built $id" || fail "it never built $id"
done
[ "$(grep -c 'house.sh new' "$FAKE_ARGV")" = 2 ] && ok "one project per preset" || fail "made $(grep -c 'house.sh new' "$FAKE_ARGV") projects"
pg_case "one case by name runs only that one" "$ONE" 0 "$ONE" "pg18-trixie-agent"
pg_case "an unknown case: usage" nope 2 "usage" "PASS"
pg_case "the build failing: a finding, with the build's words" "$ONE" 1 "docker build exited 0 (it exited 3)" "as node" FAKE_BUILD_RC=3
pg_case "the build's tail is shown" "$ONE" 1 "apt-get satisfy could not be done" "" FAKE_BUILD_RC=3
pg_case "a cached layer printing nothing: a finding, though the step's header says the words" "$ONE" 1 "the server is installed" "PASS" FAKE_CACHED=1
pg_case "the installer not installing the server: a finding" "$ONE" 1 "the bookworm closure, 17.6-bbbb" "PASS" FAKE_NO_SERVER=1
pg_case "the installer not installing dbmate: a finding" "$ONE" 1 "dbmate $DBMATE_PIN is installed" "PASS" FAKE_NO_DBMATE=1
pg_case "a Dockerfile from another image: a finding" "$ONE" 1 "is FROM mcr.microsoft.com/devcontainers/typescript-node:18" "PASS" FAKE_WRONG_FROM=1
pg_case "an installer of another major: a finding" "$ONE" 1 "holds Postgres 17's tools" "PASS" FAKE_WRONG_MAJOR=1
pg_case "no closure for the release: a finding" "$ONE" 1 "has a bookworm closure" "docker build exited" FAKE_NO_CLOSURE=1
pg_case "the generator failing: a finding" "$ONE" 1 "the devcontainer generator ran" "PASS" FAKE_NX_RC=4
pg_case "an image on another release: a finding" "$ONE" 1 "the image is on bookworm (it says 'forky')" "PASS" FAKE_CODENAME=forky
pg_case "running as root: a finding" "$ONE" 1 "a user who is not root" "PASS" FAKE_UID=0
pg_case "a tool missing from PATH: a finding" "$ONE" 1 "pg_dump is on PATH, from /usr/local/bin (it says '')" "PASS" FAKE_NO_TOOL=pg_dump
pg_case "a tool from elsewhere: a finding" "$ONE" 1 "postgres is on PATH, from /usr/local/bin (it says '/usr/bin/postgres')" "PASS" FAKE_BIN=/usr/bin
pg_case "the server not behind its wrapper: a finding" "$ONE" 1 "through its generated wrapper" "PASS" FAKE_WRAPPER=
pg_case "another minor answering: a finding" "$ONE" 1 "is the pin, 17.6" "PASS" FAKE_PG_VERSION=17.5
pg_case "another dbmate answering: a finding" "$ONE" 1 "dbmate --version is the pin" "PASS" FAKE_DBMATE_ANSWER=0.0.1
pg_case "initdb failing: a finding" "$ONE" 1 "a real initdb" "PASS" FAKE_INITDB_RC=1
pg_case "the boot failing: a finding" "$ONE" 1 "the server booted" "PASS" FAKE_BOOT_RC=1
pg_case "the server answering another version: a finding" "$ONE" 1 "the server answers, at 17.6" "PASS" FAKE_SERVER_VERSION=9.9
pg_case "pgvector not loading: a finding" "$ONE" 1 "pgvector loads" "PASS" FAKE_VECTOR=
pg_case "a migration failing: a finding" "$ONE" 1 "a real dbmate migration" "PASS" FAKE_DBMATE_RC=1
pg_case "a migration with no row: a finding" "$ONE" 1 "its row is there" "PASS" FAKE_ROW=0
pg_case "the stop failing: a finding" "$ONE" 1 "the server stopped" "PASS" FAKE_STOP_RC=1
pg_case "a pid file left: a finding" "$ONE" 1 "left no pid file" "PASS" FAKE_PIDFILE=left
pg_case "no base image: could not run" "$ONE" 2 "COULD NOT RUN ($ONE): docker pull" "FAILED" FAKE_PULL_RC=1
pg_case "an engine error at run: could not run" "$ONE" 2 "docker run exited 125" "FAILED" FAKE_RUN_RC=125
pg_case "exit 0 with no sentinel: could not run" "$ONE" 2 "before the probe's end" "PASS" FAKE_NO_SENTINEL=1
pg_case "no project: could not run" "$ONE" 2 "COULD NOT RUN ($ONE): house.sh new" "FAILED" FAKE_NEW_RC=9
out="$(env PATH="$PG/bin:$PATH" GITHUB_ACTIONS= HOME="$TMP" FAKE_DBMATE_PIN="$DBMATE_PIN" FAKE_BUILD_RC=3 bash "$PG/tree/tools/check-runner-image/postgres-image.sh" pg18-bookworm-node18 pg17-bookworm-node18 2>&1)"; got=$?
[ "$got" = 1 ] && ok "two cases, a build failing: a finding" || fail "two cases, a build failing: exit $got"
case "$out" in *"=== pg17-bookworm-node18"*) ok "a red case does not stop the next" ;; *) fail "a red case stopped the next" ;; esac
out="$(PATH="$TMP/nodocker" GITHUB_ACTIONS= "$TMP/nodocker/bash" "$HERE/postgres-image.sh" 2>&1)"; got=$?
if [ "$got" = 2 ] && case "$out" in *"no docker on PATH"*) true ;; *) false ;; esac; then
  ok "no docker: could not run (exit 2)"
else
  fail "no docker: exit $got: $out"
fi

[ "$FAILED" -eq 0 ] && echo "PASS" || { echo "FAIL"; exit 1; }
