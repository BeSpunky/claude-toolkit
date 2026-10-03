# shellcheck shell=bash
# THE DECLARED BRANCH MODEL, AS THE SCAFFOLDER SEES IT — which lines a sync must never commit onto, and whether
# the project has declared a model at all.
#
# WHY THIS EXISTS. A sync's migration ladder commits onto whatever branch HEAD is, so the preflight must know
# which branches are PROTECTED. That used to be hard-coded (development/staging/main/master, armed by "a
# 'development' branch exists"), which is wrong for every project that is not three-line — and right only by
# accident for the ones that were forced into three-line. The model is now a declared project fact,
# `.bespunky/branches.json`, interpreted ONLY by the workflow plugin's engine (`branches.mjs`). This file is a
# READER, and reads exactly one part of the declaration: its derived, flat `projection` block — the same split
# as `layers.sh` from the layer registry (contract: docs/features/2026-10-03-branch-model/CONTRACT.md §2).
# It never interprets the model, never guesses past an unknown schema, and never writes the file.
#
# RENDERED BY VALUE. scaffold.sh sources this and renders the functions into its program with `declare -f`
# (as it does house-mounts.sh), so the check runs wherever the program does — natively or inside the fallback
# container — with no file to find there.
#
# WHY NODE, when house-mounts.sh is pure bash. That file is also read by the SessionStart hook, which must stay a
# few stat calls; this one has a single reader, the sync program, which already requires node before the
# preflight verdict (the version probe compares with it) — node is the runtime on both the native path (22.18+)
# and the container path (the typescript-node image). And this is JSON: a grep/sed reading of it would be the
# one parser in the toolkit that could be fooled by formatting, in the one check that decides where commits land.
#
# WHICH COPY IS AUTHORITATIVE (CONTRACT Amendment 2 — the rule the engine's lib/resolve.mjs implements too, and both
# test suites run the same scenario list). The file is committed, so every branch has its own, possibly stale or
# missing, copy. The copy on the INTEGRATION LINE'S TIP is the model; the integration name comes from the working
# tree's copy. Resolution, in order:
#   1. the working tree's copy exists but cannot be read with certainty (bad JSON, no projection, an unknown
#      projection.schema major) → UNREADABLE: the reader refuses to act, and protection is the §3 list.
#   2. a readable working copy names integration I and remote R → BOTH refs/heads/I and refs/remotes/R/I are
#      considered (a stale local integration branch must not hide a fresh remote one — that is the bug that let
#      a sync commit onto production), keeping those that exist AND hold the file:
#        - neither ref exists      → the working copy is in force (bootstrap), with a note;
#        - none holds the file     → NOT LANDED: undeclared, but protected = the §3 names that exist UNION the copy's
#                                    protected / protectedPatterns (never fewer protections than the copy says);
#        - one holds it            → that copy;
#        - both hold it            → identical → that copy; else the one whose commit descends from the other's;
#                                    diverged → the local one, with a note.
#   3. no working copy → SELF-CONFIRMING search: each §3 name, local branch AND origin/<name>; a copy is accepted
#      only when its own projection.integration names the very branch it was read from.
#   4. nothing → UNDECLARED: protected = the §3 names that exist (locally or on origin).
# Every state reports the EFFECTIVE protected set (`protected=` / `protectedPatterns=`), so a caller never has to
# reconstruct one from the state word — that reconstruction is exactly where the working copy's list was lost.

# The names the toolkit ever forced, plus gitflow's (CONTRACT §3): the candidates for the self-confirming search,
# the protected set while a declaration is UNREADABLE, and — narrowed to the ones that exist — while UNDECLARED.
# A function, not a variable, so `declare -f` carries it.
house_branches_undeclared_protected() { echo 'main master development develop staging'; }

# _house_bm_parse — stdin: a branches.json. stdout: KEY=VALUE lines from its projection; on anything it cannot
# read with certainty, a single `reason=` line and exit 1. Lists are space-joined (branch names hold no spaces).
_house_bm_parse() {
  node -e '
const say = s => console.log(s), fail = r => { say("reason=" + r); process.exit(1); };
let j;
try { j = JSON.parse(require("fs").readFileSync(0, "utf8")); }
catch (e) { fail("it is not valid JSON (" + String(e.message).split("\n")[0] + ")"); }
const p = j && typeof j === "object" ? j.projection : undefined;
if (!p || typeof p !== "object") fail("it has no projection block (the engine writes one: branches.mjs write)");
const major = String(p.schema).split(".")[0];
if (major !== "1") fail("its projection.schema is " + JSON.stringify(p.schema) + ", a major this toolkit does not know (it reads 1) - update the toolkit; nothing is guessed past an unknown schema");
const name = v => typeof v === "string" && /^[^\s=]+$/.test(v);
if (!name(p.integration)) fail("projection.integration is not a branch name");
for (const k of ["production", "chain", "protected", "protectedPatterns"])
  if (!Array.isArray(p[k]) || !p[k].every(name)) fail("projection." + k + " is not a list of branch names");
const prod = new Set(p.production);
if (p.remote !== undefined && !name(p.remote)) fail("projection.remote is not a remote name");
say("integration=" + p.integration);
say("remote=" + (p.remote || "origin"));
say("summary=" + String(p.summary || p.chain.join(" -> ")).replace(/\s+/g, " "));
say("protected=" + p.protected.join(" "));
say("protectedPatterns=" + p.protectedPatterns.join(" "));
say("chain=" + p.chain.join(" "));
say("production=" + p.production.join(" "));
say("preproduction=" + p.chain.filter(b => b !== p.integration && !prod.has(b)).join(" "));
say("projection=" + JSON.stringify(p));
'
}

# _house_bm_has <ref> — exit 0 when that ref exists.
_house_bm_has() { git rev-parse --verify -q "$1^{commit}" >/dev/null 2>&1; }

# _house_bm_existing <remote…> — the §3 names that EXIST here, as a local branch or on any of the given remotes
# (CONTRACT Amendment 2: undeclared protects the §3 names that exist). Not a guard narrowed for its own sake: the
# set is reported to a human ("every branch named …"), and naming lines the repository does not have is a lie the
# reader then has to see through. Matching HEAD is unaffected — HEAD's own branch always exists.
_house_bm_existing() {
  local out='' n r hit
  for n in $(house_branches_undeclared_protected); do
    hit=0
    _house_bm_has "refs/heads/$n" && hit=1
    for r in "$@"; do [ "$hit" = 1 ] && break; _house_bm_has "refs/remotes/$r/$n" && hit=1; done
    [ "$hit" = 1 ] && out="${out:+$out }$n"
  done
  printf '%s' "$out"
}

# _house_bm_union <list> <list> — space-joined, order kept, duplicates dropped.
_house_bm_union() {
  local out='' n
  for n in $1 $2; do
    case " $out " in *" $n "*) ;; *) out="${out:+$out }$n" ;; esac
  done
  printf '%s' "$out"
}

# house_branch_model — resolve the model of the repository at $PWD. stdout, KEY=VALUE lines:
#   state=declared|undeclared|unreadable    always first
#   source=<ref>|working-tree               declared/unreadable: where the copy was read
#   protected= protectedPatterns=           ALWAYS — the effective set for this state (see above)
#   integration= remote= summary= chain= production= preproduction= projection=<compact JSON>   declared only
#   pending=<integration>                   undeclared only, when NOT LANDED: the line the tree's copy names, where
#                                           the declaration must land before it is in force
#   reason=…                                unreadable only
#   note=…                                  zero or more, human-facing
# Never fails: every git or parse failure is a state, so `x="$(house_branch_model)"` is safe under `set -e`.
house_branch_model() {
  local f='.bespunky/branches.json' top wt='' integ='' remote='' json='' src='' out='' cand r t i
  local wt_prot='' wt_pat='' local_ref remote_ref local_json='' remote_json='' any=0
  local notes=() refs=()
  local undeclared; undeclared="$(house_branches_undeclared_protected)"
  _bm_emit_notes() { local n; for n in "${notes[@]+"${notes[@]}"}"; do echo "note=$n"; done; }
  # Outside git there are no refs: a copy here is in force as written (rule 2, "neither ref exists").
  top="$(git rev-parse --show-toplevel 2>/dev/null)" || top="$PWD"

  if [ -f "$top/$f" ]; then
    wt="$(cat "$top/$f" 2>/dev/null)" || wt=''
    if ! out="$(printf '%s' "$wt" | _house_bm_parse 2>/dev/null)"; then
      echo 'state=unreadable'; echo 'source=working-tree'
      echo "protected=$undeclared"; echo 'protectedPatterns='
      printf '%s\n' "$out" | sed -n '/^reason=/p'
      return 0
    fi
    integ="$(printf '%s\n' "$out" | sed -n 's/^integration=//p')"
    remote="$(printf '%s\n' "$out" | sed -n 's/^remote=//p')"
    wt_prot="$(printf '%s\n' "$out" | sed -n 's/^protected=//p')"
    wt_pat="$(printf '%s\n' "$out" | sed -n 's/^protectedPatterns=//p')"
    local_ref="refs/heads/$integ"; remote_ref="refs/remotes/$remote/$integ"
    if _house_bm_has "$local_ref"; then
      any=1; local_json="$(git show "$local_ref:$f" 2>/dev/null)" && refs+=("$local_ref") || local_json=''
    fi
    if _house_bm_has "$remote_ref"; then
      any=1; remote_json="$(git show "$remote_ref:$f" 2>/dev/null)" && refs+=("$remote_ref") || remote_json=''
    fi
    if [ "$any" = 0 ]; then
      src='working-tree'; json="$wt"
      notes+=("the integration line '$integ' does not exist yet (no local or $remote branch), so this tree's copy of $f is in force")
    elif [ "${#refs[@]}" = 0 ]; then
      echo 'state=undeclared'
      local rems='origin'; [ "$remote" = origin ] || rems="origin $remote"
      # shellcheck disable=SC2086 # a space-joined list of remote names, split on purpose
      echo "protected=$(_house_bm_union "$(_house_bm_existing $rems)" "$wt_prot")"
      echo "protectedPatterns=$wt_pat"
      echo "pending=$integ"
      notes+=("this tree carries $f naming '$integ' as its integration line, but '$integ' does not — a declaration is not in force until it lands there; meanwhile the lines it declares are protected too")
      _bm_emit_notes
      return 0
    elif [ "${#refs[@]}" = 1 ]; then
      src="${refs[0]}"
      [ "$src" = "$local_ref" ] && json="$local_json" || json="$remote_json"
    elif [ "$local_json" = "$remote_json" ]; then
      src="$local_ref"; json="$local_json"
    elif git merge-base --is-ancestor "$local_ref" "$remote_ref" 2>/dev/null; then
      src="$remote_ref"; json="$remote_json"
    elif git merge-base --is-ancestor "$remote_ref" "$local_ref" 2>/dev/null; then
      src="$local_ref"; json="$local_json"
    else
      src="$local_ref"; json="$local_json"
      notes+=("'$integ' and '$remote/$integ' have diverged and carry different copies of $f — the local one was read; reconcile them")
    fi
    if [ "$src" != 'working-tree' ] && [ "$wt" != "$json" ]; then
      notes+=("this tree's copy of $f differs from the one on '$integ' ($src) — the integration line's copy is the model in force")
    fi
  else
    for cand in $undeclared; do
      for r in "refs/heads/$cand" "refs/remotes/origin/$cand"; do
        _house_bm_has "$r" || continue
        t="$(git show "$r:$f" 2>/dev/null)" || continue
        i="$(printf '%s' "$t" | _house_bm_parse 2>/dev/null | sed -n 's/^integration=//p')" || i=''
        if [ "$i" = "$cand" ]; then src="$r"; json="$t"; break 2; fi
      done
    done
    if [ -z "$src" ]; then
      echo 'state=undeclared'; echo "protected=$(_house_bm_existing origin)"; echo 'protectedPatterns='; return 0
    fi
  fi

  if out="$(printf '%s' "$json" | _house_bm_parse 2>/dev/null)"; then
    echo 'state=declared'; echo "source=$src"; printf '%s\n' "$out"
  else
    echo 'state=unreadable'; echo "source=$src"
    echo "protected=$undeclared"; echo 'protectedPatterns='
    printf '%s\n' "$out" | sed -n '/^reason=/p'
  fi
  _bm_emit_notes
  return 0
}

# house_branches_fns — every function above, by value, for rendering into a program (`declare -f`). One list, so
# the renderers (scaffold.sh, and the gate's test) cannot carry a stale subset of it.
house_branches_fns() { declare -f house_branches_undeclared_protected _house_bm_parse _house_bm_has _house_bm_existing _house_bm_union house_branch_model; }
