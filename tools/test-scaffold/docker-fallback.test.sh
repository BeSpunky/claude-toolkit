#!/usr/bin/env bash
# The Docker fallback runs on a known image, and a run that cannot work says so and stops.
#
# WHY THIS IS A TEST. The fallback used to take the newest typescript-node image on MCR. When :26 appeared with no yarn
# and no corepack, `house.sh new` printed `env: 'yarn': No such file or directory`, then died on `chown: cannot access`,
# with exit 1 and no project — the run's own failure replaced by the failure of its cleanup. Nothing here had changed.
#
# What is asserted, against a fake `docker` that records every call and plays the part it is told to (no image, no
# network): the image comes from HOUSE_NODE_MAJOR and from no registry; a missing package manager, or a declared yarn
# the image's yarn cannot reach, stops the run before the program starts; a program that dies reports itself with its own exit code, does not chown what does not exist,
# and is never pushed to GitHub; a failed chown ends a run that had otherwise succeeded with its own exit code, but only
# after that run's report, because the work is done and the report is the record of it.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENGINE="$ROOT/plugins/house/engine"
HOUSE_SH="$ENGINE/house.sh"
[ -f "$HOUSE_SH" ] || { echo "FATAL: house.sh not found at $HOUSE_SH" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILED=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; FAILED=1; }

mkdir -p "$TMP/bin" "$TMP/projects"
export CALLS="$TMP/calls"
cat > "$TMP/bin/docker" <<'FAKE'
#!/usr/bin/env bash
if [ "$1" = "info" ]; then
  [ "$*" != "info --format {{.Host.Security.Rootless}}" ] || [ -z "${FAKE_ROOTLESS:-}" ] || echo true
  exit 0
fi
[ "$1" = "run" ] || exit 0
# Classified by what follows the image, never by searching the text: the rendered program itself mentions chown.
before=""
while [ "$#" -gt 0 ]; do
  case "$1" in *typescript-node:*) break ;; esac
  before="$before $1"; shift
done
image="$1"; shift
case "$1 ${2:-}" in
  'chown '*)              what=chown ;;
  'bash -lc')             case "$3" in
                            'command -v "$1"')  what=probe ;;
                            '"$1" --version')   what=version ;;
                            *)                  what=program ;;
                          esac ;;
  'node /tool/'*)         what=program ;;
  *)                      what=unknown ;;
esac
echo "$what" >> "$CALLS"
echo "$what image=$image args=$before" >> "$CALLS.argv"
case "$what" in
  probe)   [ "$4" = "_" ] && echo "tool=$5" >> "$CALLS.argv"; exit "${FAKE_PROBE_RC:-0}" ;;
  version) echo "${FAKE_YARN_VERSION-1.22.22}"; exit "${FAKE_VERSION_RC:-0}" ;;
  chown)   exit "${FAKE_CHOWN_RC:-0}" ;;
  program) [ -z "${FAKE_CREATES:-}" ] || mkdir -p "$FAKE_CREATES"
           exit "${FAKE_PROGRAM_RC:-0}" ;;
esac
exit 99
FAKE
for tool in gh curl; do printf '#!/usr/bin/env bash\necho %s >> "$CALLS"\nexit 1\n' "$tool" > "$TMP/bin/$tool"; done
chmod +x "$TMP/bin/"*

# One scaffold on the Docker path; its output lands in $out, its exit code in $rc.
scaffold() {
  : > "$CALLS"; : > "$CALLS.argv"
  out="$(env PATH="$TMP/bin:$PATH" "$@" bash "$HOUSE_SH" new --docker --github --preset=angular "$TMP/projects/shop" 2>&1)"
  rc=$?
}
called() { grep -qx "$1" "$CALLS"; }
argv() { grep "^$1 " "$CALLS.argv" | head -1; }

echo "── the image"
major="$(. "$ENGINE/container-engine.sh"; PATH="$TMP/bin:$PATH" base_image_node_major)"
house="$(sed -n "s/^export const HOUSE_NODE_MAJOR = '\([0-9]*\)'.*/\1/p" "$ENGINE/nx-tools/src/generators/_utils/versions.ts")"
[ -n "$major" ] && [ "$major" = "$house" ] && ok "the runner is HOUSE_NODE_MAJOR ($major)" || fail "runner '$major', house '$house'"
grep -qE "TYPESCRIPT_NODE_IMAGE_MAJORS.*[[ ]$major[],]" "$ENGINE/nx-tools/src/generators/_utils/node-facts.ts" \
  && ok "…and MCR publishes an image for it" || fail "no typescript-node:$major in node-facts.ts"
: > "$CALLS"; (. "$ENGINE/container-engine.sh"; PATH="$TMP/bin:$PATH" base_image_node_major >/dev/null)
called curl && fail "choosing the image asked the network" || ok "…and choosing it asks no registry"
# Moving the constant moves this runner AND every new project's devcontainer, and neither has a yarn past 24 yet.
[ "$major" = "24" ] && ok "the major is one known to ship yarn" \
  || fail "HOUSE_NODE_MAJOR is $major: first answer where yarn comes from, here and in post-create (docs/features/2026-11-02-house-docker-pm/DECISION.md), then update this list"
mkdir -p "$TMP/noconst"; cp "$ENGINE/container-engine.sh" "$TMP/noconst/"
mkdir -p "$TMP/noconst/nx-tools/src/generators/_utils"
for shape in '' "export const HOUSE_NODE_MAJOR: string = '24';" 'export const HOUSE_NODE_MAJOR = "24";'; do
  echo "$shape" > "$TMP/noconst/nx-tools/src/generators/_utils/versions.ts"
  bad="$(. "$TMP/noconst/container-engine.sh"; base_image_node_major 2>&1)"; brc=$?
  [ "$brc" -ne 0 ] && grep -qF "no HOUSE_NODE_MAJOR" <<< "$bad" && ok "a constant it cannot read stops it: '${shape:-empty}'" || fail "shape '$shape' gave rc=$brc: $bad"
done

echo "── --print-inner runs nothing"
: > "$CALLS"
env PATH="$TMP/bin:$PATH" bash "$HOUSE_SH" new --docker --print-inner --preset=angular "$TMP/projects/shop" >/dev/null 2>&1
[ $? -eq 0 ] && ok "exits 0" || fail "--print-inner failed"
[ -s "$CALLS" ] && fail "--print-inner ran: $(tr '\n' ' ' < "$CALLS")" || ok "no container started"

echo "── a run that works"
scaffold "FAKE_CREATES=$TMP/projects/shop"
[ "$rc" -eq 0 ] && ok "exit 0" || fail "exit $rc: $out"
grep -q "^NEW_OK $TMP/projects/shop" <<< "$out" && ok "NEW_OK" || fail "no NEW_OK: $out"
called gh && ok "the GitHub step runs" || fail "the GitHub step never ran, so 'nothing published' below proves nothing"
# The probe has to ask the way the program runs, or it answers a different question.
p="$(argv probe)"; g="$(argv program)"
[ "${p%% args=*}" = "probe image=${IMAGE_REF:=mcr.microsoft.com/devcontainers/typescript-node:$major}" ] && [ "${g%% args=*}" = "program image=$IMAGE_REF" ] \
  && ok "probe and program use the house image" || fail "images: $p / $g"
case "$p" in *"-u $(id -u):$(id -g)"*"-e HOME=/home/node"*) ok "the probe has the program's user and HOME" ;; *) fail "probe: $p" ;; esac
case "$g" in *"-u $(id -u):$(id -g)"*"-e HOME=/home/node"*) ok "…and so does the program" ;; *) fail "program: $g" ;; esac
grep -qx "tool=yarn" "$CALLS.argv" && ok "it asks for yarn" || fail "asked: $(cat "$CALLS.argv")"
rm -rf "$TMP/projects/shop"

echo "── a rootless engine"
scaffold FAKE_ROOTLESS=1 "FAKE_CREATES=$TMP/projects/shop"
[ "$rc" -eq 0 ] && ok "exit 0" || fail "exit $rc: $out"
case "$(argv probe)" in *" -u "*) fail "the probe mapped the user: $(argv probe)" ;; *) ok "the probe runs as container root" ;; esac
called chown && fail "chowned on a rootless engine" || ok "no chown"
rm -rf "$TMP/projects/shop"

echo "── the image has no package manager"
scaffold FAKE_PROBE_RC=1
[ "$rc" -ne 0 ] && ok "non-zero exit ($rc)" || fail "exit 0"
grep -qF "typescript-node:$major has no 'yarn'" <<< "$out" && ok "names the image and the tool" || fail "no clear error: $out"
grep -q "^NEW_FAILED $TMP/projects/shop (exit 1)" <<< "$out" && ok "NEW_FAILED" || fail "no NEW_FAILED: $out"
grep -qF "runs natively" <<< "$out" && ok "says the way around it" || fail "no next step: $out"
called program && fail "the program ran anyway" || ok "the program never started"
called chown && fail "it went on to chown" || ok "no chown"
[ -e "$TMP/projects/shop" ] && fail "something was created" || ok "nothing was created"

echo "── the image cannot be run at all"
scaffold FAKE_PROBE_RC=125
[ "$rc" -ne 0 ] && grep -qF "could not run" <<< "$out" && ok "says so, non-zero ($rc)" || fail "rc=$rc: $out"
called program && fail "the program ran anyway" || ok "the program never started"

echo "── the program dies having created nothing"
scaffold FAKE_PROGRAM_RC=127
[ "$rc" -eq 127 ] && ok "the program's own exit code" || fail "exit $rc, not 127"
grep -q "^NEW_FAILED $TMP/projects/shop (exit 127)" <<< "$out" && ok "NEW_FAILED, naming the project" || fail "no NEW_FAILED: $out"
grep -qF "not created" <<< "$out" && ok "says nothing was created" || fail "does not say what is left: $out"
grep -qF "UPGRADE_FAILED" <<< "$out" && fail "a scaffold reported as an upgrade" || ok "no upgrade advice"
called chown && fail "chowned a project that does not exist" || ok "no chown"
called gh && fail "tried to publish a failed scaffold" || ok "nothing published"

echo "── the program dies part-way"
scaffold FAKE_PROGRAM_RC=3 "FAKE_CREATES=$TMP/projects/shop"
[ "$rc" -eq 3 ] && ok "the program's own exit code" || fail "exit $rc, not 3"
called chown && ok "the partial tree is handed back" || fail "no chown of the partial tree"
grep -qF "partly created" <<< "$out" && ok "says what is left" || fail "does not say what is left: $out"
called gh && fail "tried to publish a failed scaffold" || ok "nothing published"
rm -rf "$TMP/projects/shop"

echo "── the program dies and the chown fails too"
scaffold FAKE_PROGRAM_RC=3 FAKE_CHOWN_RC=9 "FAKE_CREATES=$TMP/projects/shop"
[ "$rc" -eq 3 ] && ok "the program's failure is the one reported" || fail "exit $rc, not 3"
grep -q "^NEW_FAILED" <<< "$out" && ok "NEW_FAILED still printed" || fail "no NEW_FAILED: $out"
grep -qF "sudo chown -R" <<< "$out" && ok "…and the repair, for the partial tree" || fail "no repair: $out"
rm -rf "$TMP/projects/shop"

echo "── the program succeeds and the chown fails"
scaffold FAKE_CHOWN_RC=9 "FAKE_CREATES=$TMP/projects/shop"
[ "$rc" -eq 9 ] && ok "ends the run with the chown's exit code" || fail "exit $rc, not 9"
grep -q "^NEW_OK $TMP/projects/shop" <<< "$out" && ok "the completed run's NEW_OK still prints" || fail "no NEW_OK: $out"
grep -q "^OWNERSHIP_UNRESTORED $TMP/projects/shop (exit 9)" <<< "$out" && ok "says the ownership was not restored" || fail "no clear error: $out"
grep -qF "sudo chown -R $(id -u):$(id -g) '$TMP/projects/shop'" <<< "$out" && ok "gives the exact repair" || fail "no repair: $out"
[ "$(grep -nE '^(NEW_OK|OWNERSHIP_UNRESTORED)' <<< "$out" | cut -d: -f2 | cut -d' ' -f1 | tr '\n' ' ')" = "NEW_OK OWNERSHIP_UNRESTORED " ] \
  && ok "the repair comes last, under the report" || fail "order: $out"
grep -qF "NEW_FAILED" <<< "$out" && fail "a completed scaffold reported as failed" || ok "no NEW_FAILED"
called gh && fail "published with ownership unrestored" || ok "nothing published"
grep -qF "GITHUB_SKIP: ownership not restored" <<< "$out" && ok "says why it was not published" || fail "no GITHUB_SKIP: $out"
rm -rf "$TMP/projects/shop"

# An upgrade reports in its own vocabulary, and the pre-write stop has to leave the project as it was.
proj="$TMP/projects/existing"
mkdir -p "$proj"
( cd "$proj" && git init -q -b feature && git config user.email t@t && git config user.name t \
  && echo '{"packageManager":"npm@10.0.0"}' > package.json && echo '{}' > nx.json && git add -A && git commit -qm init )
upgrade() {
  : > "$CALLS"; : > "$CALLS.argv"
  out="$(env PATH="$TMP/bin:$PATH" "$@" bash "$HOUSE_SH" upgrade --docker --yes "$proj" 2>&1)"
  rc=$?
}

echo "── upgrade: the image has no package manager"
upgrade FAKE_PROBE_RC=1
[ "$rc" -eq 1 ] && ok "exit 1" || fail "exit $rc: $out"
grep -qx "UPGRADE_REFUSED: runner-image" <<< "$out" && ok "UPGRADE_REFUSED: runner-image" || fail "no refusal code: $out"
grep -qF "UPGRADE_FAILED" <<< "$out" && fail "a refusal reported as a failure" || ok "no UPGRADE_FAILED"
grep -qx "tool=npm" "$CALLS.argv" && ok "asks for the project's own package manager" || fail "asked: $(cat "$CALLS.argv")"
called program && fail "the program ran anyway" || ok "the program never started"
[ -z "$(git -C "$proj" status --porcelain)" ] && ok "the tree is untouched, no lock" || fail "written: $(git -C "$proj" status --porcelain)"
[ -z "$(git -C "$proj" tag)" ] && ok "no backup tag" || fail "tagged: $(git -C "$proj" tag)"

echo "── upgrade: the program dies and the chown fails too"
upgrade FAKE_PROGRAM_RC=3 FAKE_CHOWN_RC=9
[ "$rc" -eq 3 ] && ok "the program's own exit code" || fail "exit $rc, not 3: $out"
grep -q "^UPGRADE_FAILED" <<< "$out" && ok "UPGRADE_FAILED" || fail "no UPGRADE_FAILED: $out"
grep -qF "NEW_FAILED" <<< "$out" && fail "an upgrade reported as a scaffold" || ok "no NEW_FAILED"

echo "── upgrade: the program succeeds and the chown fails"
upgrade FAKE_CHOWN_RC=9
[ "$rc" -eq 9 ] && ok "ends with the chown's exit code" || fail "exit $rc, not 9: $out"
grep -q "^UPGRADE_NEXT: " <<< "$out" && ok "UPGRADE_NEXT still prints" || fail "no UPGRADE_NEXT: $out"
grep -q "^UPGRADE_OK $proj" <<< "$out" && ok "UPGRADE_OK still prints" || fail "no UPGRADE_OK: $out"
grep -qF "UPGRADE_FAILED" <<< "$out" && fail "a completed upgrade reported as failed" || ok "no UPGRADE_FAILED"
[ "$(tail -2 <<< "$out" | cut -d' ' -f1 | head -1)" = "OWNERSHIP_UNRESTORED" ] && ok "the ownership line is last" || fail "order: $out"
tail -1 <<< "$out" | grep -qF "sudo chown -R $(id -u):$(id -g) '$proj'" && ok "…with the exact repair" || fail "no repair: $out"
[ ! -e "$proj/.bespunky-upgrade.lock" ] && ok "the lock is released" || fail "lock left behind"

echo "── upgrade: a declared yarn the image cannot reach"
declare_yarn() {   # <packageManager value, or nothing>
  rm -f "$proj/.yarnrc.yml" "$proj/.yarnrc" "$TMP/projects/.yarnrc.yml"
  printf '{%s}\n' "${1:+\"packageManager\":\"$1\"}" > "$proj/package.json"
  touch "$proj/yarn.lock"
  git -C "$proj" add -A && git -C "$proj" commit -qm "$1"
}
refused() {   # <label>
  [ "$rc" -eq 1 ] && ok "$1: exit 1" || fail "$1: exit $rc: $out"
  grep -qx "UPGRADE_REFUSED: runner-image" <<< "$out" && ok "$1: UPGRADE_REFUSED: runner-image" || fail "$1: no refusal code: $out"
  called program && fail "$1: the program ran anyway" || ok "$1: the program never started"
  [ -z "$(git -C "$proj" status --porcelain)" ] && ok "$1: the tree is untouched, no lock" || fail "$1: written: $(git -C "$proj" status --porcelain)"
}
passes() {   # <label>
  [ "$rc" -eq 0 ] && called program && ok "$1: runs" || fail "$1: rc=$rc: $out"
}
declare_yarn "yarn@4.1.0+sha512.abc"
upgrade
refused "yarn 4 on image yarn 1"
grep -qF "declares yarn@4.1.0+sha512.abc with no yarnPath" <<< "$out" && grep -qF "has yarn 1.22.22" <<< "$out" && ok "names the declaration and what the image answered" || fail "no clear error: $out"
grep -qF "Node 22.18+ with yarn@4.1.0+sha512.abc on this machine's PATH runs natively" <<< "$out" && ok "names the native route, with the yarn it takes" || fail "no route: $out"
upgrade FAKE_YARN_VERSION=$'a banner from a login shell\n1.22.22'
refused "the version is the answer's last line"
grep -qF "has yarn 1.22.22" <<< "$out" && ok "…and not the shell's noise" || fail "read: $out"
upgrade FAKE_VERSION_RC=125
refused "the version cannot be asked"
grep -qF "could not read the yarn version" <<< "$out" && ok "says it could not ask" || fail "no clear error: $out"
upgrade FAKE_YARN_VERSION=
refused "an empty answer"
upgrade FAKE_YARN_VERSION=4.2.0
passes "the image's real yarn is the declared major"
echo 'nodeLinker: node-modules' > "$proj/.yarnrc.yml"; git -C "$proj" add -A; git -C "$proj" commit -qm rc
upgrade
refused ".yarnrc.yml without a yarnPath"
echo '# yarnPath: .yarn/releases/yarn-4.1.0.cjs' > "$proj/.yarnrc.yml"; git -C "$proj" add -A; git -C "$proj" commit -qm rc
upgrade
refused "a commented-out yarnPath"
echo 'yarnPath: .yarn/releases/yarn-4.1.0.cjs' > "$proj/.yarnrc.yml"; git -C "$proj" add -A; git -C "$proj" commit -qm rc
upgrade
passes "yarnPath in .yarnrc.yml"
grep -qx version "$CALLS" && fail "a yarnPath still asked the image" || ok "…asking the image nothing"
declare_yarn "yarn@4.1.0"
echo 'yarn-path ".yarn/releases/yarn-4.1.0.cjs"' > "$proj/.yarnrc"; git -C "$proj" add -A; git -C "$proj" commit -qm rc
upgrade
passes "yarn-path in .yarnrc"
declare_yarn "yarn@4.1.0"
echo 'yarnPath: ../.yarn/releases/yarn-4.1.0.cjs' > "$TMP/projects/.yarnrc.yml"
upgrade
passes "yarnPath in the directory above, which the container mounts"
rm -f "$TMP/projects/.yarnrc.yml"
declare_yarn "yarn@1.22.22"
upgrade
passes "yarn 1 on image yarn 1"
declare_yarn ""
upgrade
passes "a yarn.lock with no declaration"
grep -qx version "$CALLS" && fail "no declaration still asked the image" || ok "…asking the image nothing"
git -C "$proj" rm -qf yarn.lock; echo '{"packageManager":"npm@99.0.0"}' > "$proj/package.json"; git -C "$proj" add -A; git -C "$proj" commit -qm npm
upgrade
passes "npm is not refused by version"
echo '{"packageManager":"pnpm@99.0.0"}' > "$proj/package.json"; git -C "$proj" add -A; git -C "$proj" commit -qm pnpm
upgrade
passes "pnpm present in the image is not refused by version"
grep -qx version "$CALLS" && fail "asked for a version of a non-yarn package manager" || ok "…asking no version"

# The native path has its own road to the same report. Its fake yarn is the program's first real command; the real Node
# stays, because that is what chooses the native path.
echo "── native: the program dies"
mkdir -p "$TMP/native-bin"; cp "$TMP/bin/"* "$TMP/native-bin/"
cat > "$TMP/native-bin/yarn" <<'FAKE'
#!/usr/bin/env bash
[ -z "${FAKE_CREATES:-}" ] || mkdir -p "$FAKE_CREATES"
exit 7
FAKE
chmod +x "$TMP/native-bin/yarn"
native() {
  : > "$CALLS"
  out="$(env PATH="$TMP/native-bin:$PATH" PROJECTS_DIR="$TMP/projects" "$@" bash "$HOUSE_SH" new --github --preset=angular shop 2>&1)"
  rc=$?
}
native
grep -qF "running the generators natively" <<< "$out" && ok "takes the native path" || fail "not native, so this case tests nothing: $out"
[ "$rc" -eq 7 ] && ok "the program's own exit code" || fail "exit $rc, not 7: $out"
grep -q "^NEW_FAILED $TMP/projects/shop (exit 7)" <<< "$out" && ok "NEW_FAILED, naming the project" || fail "no NEW_FAILED: $out"
grep -qF "not created" <<< "$out" && ok "says nothing was created" || fail "does not say what is left: $out"
grep -qF "UPGRADE_FAILED" <<< "$out" && fail "a scaffold reported as an upgrade" || ok "no upgrade advice"
grep -qF "OWNERSHIP_UNRESTORED" <<< "$out" && fail "the native path has no ownership to restore" || ok "no ownership line"
called gh && fail "tried to publish a failed scaffold" || ok "nothing published"
native "FAKE_CREATES=$TMP/projects/shop"
[ "$rc" -eq 7 ] && grep -qF "partly created" <<< "$out" && ok "a partial project is named" || fail "rc=$rc: $out"
called gh && fail "tried to publish a partial scaffold" || ok "nothing published"
rm -rf "$TMP/projects/shop"

echo "── extract-tool"
mkdir -p "$TMP/projects/from" "$TMP/projects/into"
extract() {
  : > "$CALLS"; : > "$CALLS.argv"
  out="$(env PATH="$TMP/bin:$PATH" PROJECTS_DIR="$TMP/projects" "$@" bash "$EXTRACT_SH" --from from --into into 2>&1)"
  rc=$?
}
EXTRACT_SH="$ROOT/tools/extract-tool/extract-tool.sh"
extract FAKE_PROBE_RC=1
[ "$rc" -ne 0 ] && grep -qF "has no 'yarn'" <<< "$out" && ok "an image with no yarn stops it" || fail "rc=$rc: $out"
called program && fail "the tool ran anyway" || ok "the tool never started"
extract
[ "$rc" -eq 0 ] && called program && [ "$(argv program | sed 's/ args=.*//')" = "program image=$IMAGE_REF" ] && ok "otherwise it runs on the house image" || fail "rc=$rc: $out $(argv program)"
mkdir -p "$TMP/copy/tools/extract-tool" "$TMP/copy/plugins/house/engine"
cp "$EXTRACT_SH" "$TMP/copy/tools/extract-tool/"; cp "$ENGINE/container-engine.sh" "$TMP/copy/plugins/house/engine/"
EXTRACT_SH="$TMP/copy/tools/extract-tool/extract-tool.sh" extract
[ "$rc" -ne 0 ] && grep -qF "no HOUSE_NODE_MAJOR" <<< "$out" && ! called program && ok "an unreadable constant stops it, before any image" || fail "rc=$rc: $out"

echo "── publish.sh"
# Read, not run: a publish asks upstream first, and a per-push test must not depend on upstream.
PUBLISH_SH="$ROOT/tools/publish-nx-tools/publish.sh"
grep -q 'MAJOR="$(base_image_node_major)"' "$PUBLISH_SH" && ok "takes the house image" || fail "publish.sh does not call base_image_node_major"
grep -q 'mcr.microsoft.com' "$PUBLISH_SH" && fail "publish.sh still names MCR itself" || ok "and names no registry of its own"

exit "$FAILED"
