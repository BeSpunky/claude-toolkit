#!/usr/bin/env bash
# `house.sh new` takes a NAME or a PATH, and creates a GitHub repository only when asked.
#
# WHY THIS IS A TEST. Given an absolute path, `new` joined it under PROJECTS_DIR (`~/projects//abs/path`), named the
# app after the whole path (`apps//abs/path`) and never got a git repository to work in — and it then tried to
# CREATE A GITHUB REPOSITORY by default, an outward-facing act nobody had asked for. Both regress silently: the
# files still land, and a missing gh login hides the second.
#
# What is asserted (rendered with --print-inner, which runs nothing): an absolute and a relative path each name the
# project and its app after the last segment, and no doubled `//` path is formed; a missing parent is refused up
# front, naming it; `--github` is the opt-in flag, and the retired `--no-github` is an unknown one.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOUSE_SH="$ROOT/plugins/house/engine/house.sh"
[ -f "$HOUSE_SH" ] || { echo "FATAL: house.sh not found at $HOUSE_SH" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILED=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; FAILED=1; }

echo "── new <absolute path>"
mkdir -p "$TMP/work"
prog="$(bash "$HOUSE_SH" new --print-inner --preset=angular "$TMP/work/shop" 2>&1)"
grep -qF "APP='shop'" <<< "$prog" && ok "the app is named after the last segment" || fail "the app is not 'shop': $(grep -m1 "^APP=" <<< "$prog")"
grep -qE '(apps|projects)//' <<< "$prog" && fail "the path was joined onto a root: $(grep -m1 -E '(apps|projects)//' <<< "$prog")" || ok "no path joined onto apps/ or PROJECTS_DIR (the old apps//<abs path>)"
grep -qF "$TMP/work" <<< "$(grep -E "^APP=|--name=" <<< "$prog")" && fail "the parent path leaked into a name" || ok "the parent path is in no name"

echo "── new <relative/path>"
prog="$(cd "$TMP" && bash "$HOUSE_SH" new --print-inner --preset=angular work/cafe 2>&1)"
grep -qF "APP='cafe'" <<< "$prog" && ok "a relative path names the app after its last segment" || fail "the app is not 'cafe'"

echo "── new <path whose parent does not exist>"
out="$(bash "$HOUSE_SH" new --print-inner "$TMP/nowhere/shop" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && grep -qF "$TMP/nowhere" <<< "$out" && ok "refused, naming the missing parent" || fail "not refused (rc=$rc): $out"

echo "── the GitHub repository is opt-in"
bash "$HOUSE_SH" new --print-inner --github "$TMP/work/repo" > /dev/null 2>&1 && ok "--github is accepted" || fail "--github is not accepted"
out="$(bash "$HOUSE_SH" new --print-inner --no-github "$TMP/work/repo" 2>&1)"
grep -qF "unknown flag '--no-github'" <<< "$out" && ok "--no-github is retired (unknown)" || fail "--no-github still does something: $out"
grep -qE '^GITHUB=0 ' "$HOUSE_SH" && ok "the default creates no repository" || fail "the default is not GITHUB=0"

exit "$FAILED"
