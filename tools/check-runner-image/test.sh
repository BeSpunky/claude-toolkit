#!/usr/bin/env bash
# The runner-image checks' own decisions, against a fake docker and a fake curl: no image, no network, seconds. Whether a
# real image passes is what check.sh and e2e.sh are for; this only proves that each answer they can get produces the
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
printf '#!/usr/bin/env bash\necho "curl $*" >> "$FAKE_ARGV"\nprintf "%%s" "${FAKE_NPM_STATUS:-200}"\n' > "$TMP/bin/curl"
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
e2e_case "registry road: …and after a publish" registry 1 "did not reach it" "SKIP" FAKE_NPM_STATUS=404 GITHUB_EVENT_NAME=workflow_run
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

[ "$FAILED" -eq 0 ] && echo "PASS" || { echo "FAIL"; exit 1; }
