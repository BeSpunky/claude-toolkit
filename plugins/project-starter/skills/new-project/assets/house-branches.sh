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
# WHICH COPY IS AUTHORITATIVE (CONTRACT §1, §3, §4 status). The file is committed, so every branch has its own,
# possibly stale or missing. The copy on the INTEGRATION LINE'S TIP is the model; the integration name comes
# from the working tree's copy. Resolution, in order:
#   1. the working tree's copy names the integration line → read that line's tip (local branch, else
#      origin/<it>). Present → DECLARED from the tip (a note when the working copy differs). Absent → the
#      declaration has not landed yet → UNDECLARED (not in force until it does).
#   2. no readable working copy → each name the toolkit has ever protected is tried, and a copy is accepted only
#      when it is SELF-CONFIRMING (it names the very branch it was read from as its integration line) — a branch
#      cut before the model was declared still finds it, and nothing is inferred from a name alone.
#   3. the integration tip cannot be resolved at all → the working tree's copy, with a note saying so.
#   4. nothing found → UNDECLARED.
# Remote tips resolve through `projection.remote` (absent → `origin`); the self-confirming search, which has no
# projection yet to name one, uses `origin`.

# The names the toolkit ever forced, plus gitflow's (CONTRACT §3): protected while a project declares no model,
# and the candidates for the self-confirming search. A function, not a variable, so `declare -f` carries it.
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
'
}

# _house_bm_ref <branch> [remote] — the ref holding that line's tip: the local branch, else the remote's (default
# origin). Exit 1 when neither.
_house_bm_ref() {
  local remote="${2:-origin}"
  if git rev-parse --verify -q "refs/heads/$1" >/dev/null 2>&1; then echo "refs/heads/$1"
  elif git rev-parse --verify -q "refs/remotes/$remote/$1" >/dev/null 2>&1; then echo "refs/remotes/$remote/$1"
  else return 1; fi
}

# house_branch_model — resolve the model of the repository at $PWD. stdout, KEY=VALUE lines:
#   state=declared|undeclared|unreadable    always first
#   source=<ref>|working-tree               declared/unreadable: where the copy was read
#   integration= summary= protected= protectedPatterns= chain= production= preproduction=   declared only
#   reason=…                                unreadable only
#   note=…                                  zero or more, human-facing
house_branch_model() {
  local f='.bespunky/branches.json' top wt='' integ='' remote='' ref='' json='' src='' out cand r t i
  local notes=()
  top="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo 'state=undeclared'; return 0; }
  if [ -f "$top/$f" ]; then
    wt="$(cat "$top/$f")"
    out="$(printf '%s' "$wt" | _house_bm_parse 2>/dev/null || true)"
    integ="$(printf '%s\n' "$out" | sed -n 's/^integration=//p')"
    remote="$(printf '%s\n' "$out" | sed -n 's/^remote=//p')"
  fi
  if [ -n "$integ" ]; then
    ref="$(_house_bm_ref "$integ" "$remote")" || ref=''
  else
    for cand in $(house_branches_undeclared_protected); do
      r="$(_house_bm_ref "$cand")" || continue
      t="$(git show "$r:$f" 2>/dev/null)" || continue
      i="$(printf '%s' "$t" | _house_bm_parse 2>/dev/null | sed -n 's/^integration=//p' || true)"
      if [ "$i" = "$cand" ]; then ref="$r"; integ="$cand"; break; fi
    done
  fi
  if [ -n "$ref" ]; then
    if json="$(git show "$ref:$f" 2>/dev/null)"; then
      src="$ref"
      if [ -n "$wt" ] && [ "$wt" != "$json" ]; then
        notes+=("this tree's copy of $f differs from the one on '$integ' — the integration line's copy is the model in force")
      fi
    else
      echo 'state=undeclared'
      echo "note=this tree carries $f naming '$integ' as its integration line, but '$integ' does not — a declaration is not in force until it lands there"
      return 0
    fi
  elif [ -n "$wt" ]; then
    src='working-tree'; json="$wt"
    [ -n "$integ" ] && notes+=("the integration line '$integ' could not be resolved (no local or ${remote:-origin} branch), so this tree's copy of $f was read")
  else
    echo 'state=undeclared'; return 0
  fi
  if out="$(printf '%s' "$json" | _house_bm_parse)"; then
    echo 'state=declared'; echo "source=$src"; printf '%s\n' "$out"
  else
    echo 'state=unreadable'; echo "source=$src"; printf '%s\n' "$out"
  fi
  for t in "${notes[@]}"; do echo "note=$t"; done
}
