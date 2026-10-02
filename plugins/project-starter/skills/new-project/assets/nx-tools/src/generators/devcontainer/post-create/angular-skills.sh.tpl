# --- Angular agent skills (angular; when @angular/core is in package.json) ---
# Angular ships official agent skills (angular-developer, angular-new-app) at
# github.com/angular/skills, authored in Claude's own SKILL.md format (name/description
# frontmatter + a references/ dir of progressive-disclosure docs). We fetch them FRESH
# into .claude/skills/ on every container build rather than vendoring copies, so they
# track upstream Angular with zero maintenance: the skills repo is itself auto-generated
# from angular/angular, so a fork would silently go stale. The committed `.mcp.json`
# (Angular CLI MCP server) is the always-current *knowledge* channel; these skills are
# the always-loaded, triggerable companion. `.claude/skills/` is gitignored (a
# refreshable cache, like node_modules) — the @bespunky/nx-tools:angular-ai generator
# added that ignore rule. Best-effort with retry: a network blip never fails the build
# (same stance as every other best-effort step here).
if grep -q '"@angular/core"' "$WS/package.json" 2>/dev/null; then
  echo "[post-create] @angular/core detected — fetching Angular agent skills into .claude/skills/"
  skills_ok=0
  for attempt in 1 2 3; do
    ng_skills_tmp="$(mktemp -d)"
    if git clone --depth 1 --quiet https://github.com/angular/skills "$ng_skills_tmp" 2>/dev/null; then
      mkdir -p "$WS/.claude/skills"
      for s in angular-developer angular-new-app; do
        if [ -d "$ng_skills_tmp/$s" ]; then
          rm -rf "$WS/.claude/skills/$s"
          cp -r "$ng_skills_tmp/$s" "$WS/.claude/skills/$s"
        fi
      done
      rm -rf "$ng_skills_tmp"
      skills_ok=1
      break
    fi
    rm -rf "$ng_skills_tmp"
    if [ "$attempt" -lt 3 ]; then
      echo "[post-create] Angular skills fetch attempt $attempt/3 failed (often transient DNS); retrying in $((attempt * 5))s..."
      sleep $((attempt * 5))
    fi
  done
  if [ "$skills_ok" = 1 ]; then
    echo "[post-create] Angular agent skills ready (.claude/skills/{angular-developer,angular-new-app})"
  else
    echo "[post-create] WARNING: Angular skills fetch failed after 3 attempts — likely a transient network issue."
    echo "[post-create]          The container is otherwise ready; refetch this one step once the network settles with:"
    echo "[post-create]            t=\$(mktemp -d); git clone --depth 1 https://github.com/angular/skills \"\$t\" && mkdir -p .claude/skills && cp -r \"\$t\"/angular-developer \"\$t\"/angular-new-app .claude/skills/ && rm -rf \"\$t\""
  fi
fi
