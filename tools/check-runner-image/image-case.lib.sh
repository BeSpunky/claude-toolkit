# What the real-image checks of a project wearing a layer share: how a fact is judged and reported, and how the project is made.
# Sourced by postgres-image.sh and supabase-image.sh, which set HERE, ENGINE, WORK and the counters' first values.
notice() { echo "$2"; [ -z "${GITHUB_ACTIONS:-}" ] || echo "::$1::$2"; }
summary() { [ -z "${GITHUB_STEP_SUMMARY:-}" ] || echo "$1" >> "$GITHUB_STEP_SUMMARY"; }

FINDINGS=0
COULD_NOT=0
CASE=""
CASE_RED=0
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

project_for() {   # <name prefix> <layers> <preset>: prints the project's directory, making it the first time. Fails when `new` does.
  local prefix="$1" layers="$2" preset="$3" dir="$WORK/$1-$3" flags=()
  if [ ! -d "$dir" ]; then
    [ "$preset" = agent ] || flags=("--preset=$preset")
    echo "One project, made with this checkout on Node $(node --version 2>/dev/null): house.sh new --local ${flags[*]-} --add-layer=$layers" >&2
    if ! PROJECTS_DIR="$WORK" bash "$ENGINE/house.sh" new --local ${flags[@]+"${flags[@]}"} "--add-layer=$layers" "$prefix-$preset" < /dev/null > "$WORK/new-$preset.log" 2>&1; then
      tail -n 40 "$WORK/new-$preset.log" >&2
      return 1
    fi
  fi
  echo "$dir"
}
