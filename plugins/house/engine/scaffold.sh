#!/usr/bin/env bash
# DEPRECATED SHIM — the old command line of the house engine, translated onto house.sh beside it.
#
# WHY IT EXISTS. The engine used to be `scaffold.sh [--sync] [--ensure=<csv>] …`; it is now
# `house.sh new | upgrade | add-layer` (docs/features/2026-10-03-house-plugin-rename/DECISION.md). Every consumer
# HOUSE.md generated before that rename still prints `scaffold.sh --sync`, and so do people's shell histories and
# notes — a command line written into someone else's repository cannot be renamed under them. This file keeps
# those invocations working, says once what they are now, and hands over. It decides nothing itself: house.sh
# validates everything, so the translation is purely a re-spelling (precedent: publishable-lib's --nonAngular).
#
#   --sync                                  → upgrade
#   --sync --ensure=X / --ensure X          → add-layer X        (layers are add-layer's first positional)
#   --sync --firebase                       → add-layer firebase (upgrade adds no layer; --firebase is one)
#   --sync --preset=P                       → add-layer --preset=P <the Nx floor>   (a preset is a layer set)
#   no --sync                               → new, with --ensure → --add-layer
#   every other argument                    → passed through, in order
set -euo pipefail

ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Only for the floor's id (HOUSE_LAYER_FLOOR) — derived from the registry, never typed here. Sourcing runs nothing.
# shellcheck source=layers.sh
. "$ENGINE_DIR/layers.sh"

SYNC=0
ENSURE=""
PRESET_GIVEN=0
FIREBASE_GIVEN=0
FLAGS=()
# The old parser's rule, kept: flags are LEADING; the first non-flag starts the positionals. A value-taking flag in
# its space form consumes the next word, exactly as it did there — so `--ensure agent .` keeps meaning what it meant.
while [ "$#" -gt 0 ]; do
  case "$1" in
    --sync)              SYNC=1; shift;;
    --ensure=*)          ENSURE="${ENSURE:+$ENSURE,}${1#--ensure=}"; shift;;
    --ensure)            [ "$#" -ge 2 ] || { FLAGS+=("$1"); shift; continue; }
                         ENSURE="${ENSURE:+$ENSURE,}$2"; shift 2;;
    --firebase)          FIREBASE_GIVEN=1; FLAGS+=("$1"); shift;;
    --preset=*)          PRESET_GIVEN=1; FLAGS+=("$1"); shift;;
    --preset|--layout|--linking)
                         FLAGS+=("$1"); [ "$1" = "--preset" ] && PRESET_GIVEN=1
                         [ "$#" -ge 2 ] && { FLAGS+=("$2"); shift; }
                         shift;;
    -*)                  FLAGS+=("$1"); shift;;
    *)                   break;;
  esac
done

if [ "$SYNC" = "0" ]; then
  NEW=(new ${FLAGS[@]+"${FLAGS[@]}"})
  [ -n "$ENSURE" ] && NEW+=("--add-layer=$ENSURE")
elif [ -n "$ENSURE" ] || [ "$FIREBASE_GIVEN" = "1" ] || [ "$PRESET_GIVEN" = "1" ]; then
  # --firebase IS the firebase layer, so it joins the list instead of riding along as a flag; a preset alone still
  # needs a list, and the floor is the one layer every run ensures anyway, so naming it adds nothing.
  _layers="$ENSURE"
  _kept=()
  for _f in ${FLAGS[@]+"${FLAGS[@]}"}; do
    if [ "$_f" = "--firebase" ]; then _layers="${_layers:+$_layers,}firebase"; else _kept+=("$_f"); fi
  done
  NEW=(add-layer ${_kept[@]+"${_kept[@]}"} "${_layers:-$HOUSE_LAYER_FLOOR}")
else
  NEW=(upgrade ${FLAGS[@]+"${FLAGS[@]}"})
fi
NEW+=("$@")

# The new form, pasteable: a word is quoted only when it needs to be (%q alone would escape every comma in a list).
_shown=""
for _w in "${NEW[@]}"; do
  if [[ "$_w" =~ ^[A-Za-z0-9_./=,:@+-]+$ ]]; then _shown="$_shown $_w"; else _shown="$_shown $(printf '%q' "$_w")"; fi
done
echo "NOTE: scaffold.sh is deprecated — this is now: house.sh$_shown" >&2
exec bash "$ENGINE_DIR/house.sh" "${NEW[@]}"
