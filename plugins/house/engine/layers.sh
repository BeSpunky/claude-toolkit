# shellcheck shell=bash
# GENERATED from the @bespunky/nx-tools layer registry (src/layers/*.ts, via `cli.js shell`). DO NOT EDIT.
# Regenerate with:  node tools/test-layers/run.mjs --write   (CI fails when this file drifts from the registry.)
#
# The pure-bash view of the registry for the two readers that cannot load the package: scaffold.sh, which
# validates --ensure before anything is installed, and the SessionStart hook, which must stay a few greps.
# Sourcing it defines variables and functions only; it runs nothing.

HOUSE_LAYERS='nx,agent,node,js,web,angular,design-system,navigation,firebase'
HOUSE_LAYER_FLOOR='nx'
HOUSE_LAYERS_ENSURABLE_SCAFFOLD='nx,agent,node,web,angular,design-system,firebase'
HOUSE_LAYERS_ENSURABLE_SYNC='nx,agent,firebase'
HOUSE_PRESETS='agent,node,angular'
HOUSE_PRESET_DEFAULT='agent'
HOUSE_LAYOUTS='apps-libs,packages'
HOUSE_LAYOUT_DEFAULT_APPS_DIR='apps'
HOUSE_LINKINGS='paths,workspaces'
HOUSE_LINKING_DEFAULT='paths'

# house_layer_title <id> — one line naming the layer.
house_layer_title() {
  case "$1" in
    nx) printf '%s\n' 'Nx workspace (the floor)' ;;
    agent) printf '%s\n' 'Agent DX (Claude settings, devcontainer, window identity)' ;;
    node) printf '%s\n' 'Node project (a root package.json)' ;;
    js) printf '%s\n' 'TypeScript/JavaScript libraries' ;;
    web) printf '%s\n' 'Web dev loop (dev engine, worktree domains, shared browser)' ;;
    angular) printf '%s\n' 'Angular application' ;;
    design-system) printf '%s\n' 'Design system' ;;
    navigation) printf '%s\n' 'Typed reactive navigation' ;;
    firebase) printf '%s\n' 'Firebase' ;;
  esac
}

# house_layer_requires <id> — comma-separated required layers.
house_layer_requires() {
  case "$1" in
    nx) printf '%s\n' '' ;;
    agent) printf '%s\n' '' ;;
    node) printf '%s\n' '' ;;
    js) printf '%s\n' 'nx' ;;
    web) printf '%s\n' 'agent' ;;
    angular) printf '%s\n' 'nx,node' ;;
    design-system) printf '%s\n' 'nx' ;;
    navigation) printf '%s\n' 'angular' ;;
    firebase) printf '%s\n' 'nx,node' ;;
  esac
}

# house_layer_hint <id> — how a human brings the layer into being.
house_layer_hint() {
  case "$1" in
    nx) printf '%s\n' '`scaffold.sh --sync <project>` — the floor is always ensured: `nx init` in place (into node_modules when the repo has a package.json, else through the Nx wrapper, ./nx)' ;;
    agent) printf '%s\n' '`scaffold.sh --sync --ensure=agent <project>`' ;;
    node) printf '%s\n' 'a root package.json (`npm init`) — the next sync then treats the repo as a Node project' ;;
    js) printf '%s\n' '`nx add @nx/js` (or `nx g @bespunky/nx-tools:publishable-lib <name> --stack=js`)' ;;
    web) printf '%s\n' 'declare what the project serves in `.bespunky/dev.json` (e.g. `{"apps":{"site":{"processes":[{"id":"app","cmd":"python3 -m http.server ${PORT:app}","ports":{"app":8000}}]}}}`), or give an Nx app a dev-server target (the `angular` layer: `nx g @bespunky/nx-tools:app --name=<name>`), then sync' ;;
    angular) printf '%s\n' '`nx add @nx/angular`, then `nx g @bespunky/nx-tools:app --name=<name>`' ;;
    design-system) printf '%s\n' '`nx g @bespunky/nx-tools:design-system --scope=<scope>`' ;;
    navigation) printf '%s\n' '`nx g @bespunky/nx-tools:navigation-core`' ;;
    firebase) printf '%s\n' '`scaffold.sh --sync --firebase <project>` (or `nx g @bespunky/nx-tools:firebase-emulators [--project=<app>]`)' ;;
  esac
}

# house_layer_brings <id> — what its house tooling brings (hook drift notice).
house_layer_brings() {
  case "$1" in
    nx) printf '%s\n' 'the Nx floor every house generator and migration runs on' ;;
    agent) printf '%s\n' 'the devcontainer, the Claude settings and the window identity' ;;
    node) printf '%s\n' 'the typescript-node devcontainer image, the node_modules volume and the package-manager install' ;;
    js) printf '%s\n' 'the publishable-library and tool-extraction conventions in HOUSE.md, @playwright/test (pinned)' ;;
    web) printf '%s\n' 'the stack-free dev engine (tools/dev/dev serve), worktree domains, the shared co-driven browser, :80' ;;
    angular) printf '%s\n' 'the Angular editor extensions, the dev-server leaf, the Angular CLI MCP + agent skills' ;;
    design-system) printf '%s\n' 'the design-system config, STRUCTURE.md, and every app'\''s sass/provider wiring' ;;
    navigation) printf '%s\n' 'nothing per-sync (its generators are on-demand), but HOUSE.md gains the typed-navigation conventions' ;;
    firebase) printf '%s\n' 'the emulator wiring, the JDK step, and the forwarded emulator ports' ;;
  esac
}

# house_layer_ensurable_scaffold <id> — yes | no | via:<id>.
house_layer_ensurable_scaffold() {
  case "$1" in
    nx) printf '%s\n' 'yes' ;;
    agent) printf '%s\n' 'yes' ;;
    node) printf '%s\n' 'yes' ;;
    js) printf '%s\n' 'no' ;;
    web) printf '%s\n' 'via:angular' ;;
    angular) printf '%s\n' 'yes' ;;
    design-system) printf '%s\n' 'yes' ;;
    navigation) printf '%s\n' 'no' ;;
    firebase) printf '%s\n' 'yes' ;;
  esac
}

# house_layer_ensurable_sync <id> — yes | no | via:<id>.
house_layer_ensurable_sync() {
  case "$1" in
    nx) printf '%s\n' 'yes' ;;
    agent) printf '%s\n' 'yes' ;;
    node) printf '%s\n' 'no' ;;
    js) printf '%s\n' 'no' ;;
    web) printf '%s\n' 'no' ;;
    angular) printf '%s\n' 'no' ;;
    design-system) printf '%s\n' 'no' ;;
    navigation) printf '%s\n' 'no' ;;
    firebase) printf '%s\n' 'yes' ;;
  esac
}

# house_layer_nx_plugin <id> — the Nx plugin a scaffold `nx add`s to create it (or nothing).
house_layer_nx_plugin() {
  case "$1" in
    angular) printf '%s\n' '@nx/angular' ;;
  esac
}

# house_layer_app_stack <id> — the stack adapter that creates the first app when a scaffold ensures this layer (or nothing).
house_layer_app_stack() {
  case "$1" in
    angular) printf '%s\n' 'angular' ;;
  esac
}

# house_layer_evidence <id> — `file <path>` | `dependency <fixed string>` | `project-json <grep BRE>` lines.
house_layer_evidence() {
  case "$1" in
    nx) printf '%s\n' 'file nx.json' ;;
    agent) printf '%s\n' 'file .devcontainer/.bespunky-devcontainer.json
file .vscode/.window-identity.json' ;;
    node) printf '%s\n' 'file package.json' ;;
    js) printf '%s\n' 'dependency "@nx/js"
project-json "executor"[[:space:]]*:[[:space:]]*"@nx/js:' ;;
    web) printf '%s\n' 'file .bespunky/dev.json
project-json "dev-server"[[:space:]]*:
project-json "executor"[[:space:]]*:[[:space:]]*"@bespunky/nx-tools:serve
project-json "executor"[[:space:]]*:[[:space:]]*"@angular/build:dev-server
project-json "executor"[[:space:]]*:[[:space:]]*"@angular-devkit/build-angular:dev-server
project-json "executor"[[:space:]]*:[[:space:]]*"@nx/angular:dev-server' ;;
    angular) printf '%s\n' 'dependency "@angular/core"
dependency "@nx/angular"
project-json "executor"[[:space:]]*:[[:space:]]*"@angular/build:
project-json "executor"[[:space:]]*:[[:space:]]*"@angular-devkit/build-angular:
project-json "executor"[[:space:]]*:[[:space:]]*"@nx/angular:' ;;
    design-system) printf '%s\n' 'project-json "type:design-system"' ;;
    navigation) printf '%s\n' 'project-json "type:navigation"' ;;
    firebase) printf '%s\n' 'file firebase.json' ;;
  esac
}

# house_preset_title <preset> — one line naming the preset.
house_preset_title() {
  case "$1" in
    agent) printf '%s\n' 'the house DX on the Nx floor — no package.json, no framework (Nx through its wrapper)' ;;
    node) printf '%s\n' 'a Node workspace — root package.json (create-nx-workspace), the toolkit as exact devDependencies' ;;
    angular) printf '%s\n' 'the house web app — Angular app, dev loop, design system (add --firebase for Firebase)' ;;
  esac
}

# house_preset_layers <preset> — its ensure set, comma-separated.
house_preset_layers() {
  case "$1" in
    agent) printf '%s\n' 'nx,agent' ;;
    node) printf '%s\n' 'nx,agent,node' ;;
    angular) printf '%s\n' 'nx,agent,node,web,angular,design-system' ;;
  esac
}

# house_layout_title <layout> — one line naming the layout.
house_layout_title() {
  case "$1" in
    apps-libs) printf '%s\n' 'apps under apps/, libraries under libs/ — the classic integrated Nx convention' ;;
    packages) printf '%s\n' 'every project under packages/ — the package-based convention' ;;
  esac
}

# house_layout_apps_dir <layout> — where it keeps applications (a scaffold's first app lands there).
house_layout_apps_dir() {
  case "$1" in
    apps-libs) printf '%s\n' 'apps' ;;
    packages) printf '%s\n' 'packages' ;;
  esac
}

# house_linking_title <linking> — one line naming the linking strategy.
house_linking_title() {
  case "$1" in
    paths) printf '%s\n' 'project.json projects reached through tsconfig `paths` aliases' ;;
    workspaces) printf '%s\n' 'a TS-solution workspace — package.json projects, package-manager workspaces, TS project references' ;;
  esac
}

# house_workspace_globs <dir> — the package-manager workspace globs <dir> declares, one per line (`!` kept).
house_workspace_globs() {
  local dir="$1"
  [ -f "$dir/package.json" ] && tr -d '\n\r' < "$dir/package.json" \
    | grep -o '"workspaces"[[:space:]]*:[[:space:]]*[[{][^]}]*' | head -1 \
    | sed 's/^"workspaces"[[:space:]]*:[[:space:]]*//; s/^{[[:space:]]*"packages"[[:space:]]*:[[:space:]]*//' \
    | grep -o '"[^"]*"' | tr -d '"'
  [ -f "$dir/pnpm-workspace.yaml" ] && sed -n '/^packages:/,/^[^[:space:]-]/s/^[[:space:]]*-[[:space:]]*//p' "$dir/pnpm-workspace.yaml" \
    | sed 's/[[:space:]]*#.*$//' | tr -d "\"'"
  return 0
}

# house_project_jsons <dir> — every project configuration Nx would read under <dir> (project.json files and the
# package.json of each workspace member), concatenated.
house_project_jsons() {
  local dir="$1" scratch='' glob
  set -- -z --cached --others --exclude-standard -- project.json '*/project.json'
  while IFS= read -r glob; do
    glob="${glob#./}"; glob="${glob%/}"
    case "$glob" in
      ''|'.') ;;
      '!'*) set -- "$@" ":(exclude,glob)${glob#!}/package.json" ;;
      *)    set -- "$@" ":(glob)$glob/package.json" ;;
    esac
  done <<HOUSE_WORKSPACES
$(house_workspace_globs "$dir")
HOUSE_WORKSPACES
  if git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    ( cd "$dir" && git ls-files "$@" 2>/dev/null | xargs -0 cat 2>/dev/null )
  elif scratch="$(mktemp -d 2>/dev/null)" && git init -q --bare "$scratch" >/dev/null 2>&1; then
    # Not a work tree — but Nx still honours .gitignore there, so lend git a throwaway repository to read it with.
    ( cd "$dir" && git --git-dir="$scratch" --work-tree=. ls-files "$@" 2>/dev/null | xargs -0 cat 2>/dev/null )
    rm -rf "$scratch"
  else
    # No git at all: the usual build/dependency dirs, the house worktree home and nested work trees, pruned.
    [ -z "$scratch" ] || rm -rf "$scratch"
    find "$dir" -mindepth 1 \( -name node_modules -o -name .git -o -name dist -o -name .nx -o -name .angular -o -name tmp \
           -o -name vendor -o -name target -o -name build -o -name out -o -name coverage -o -name .venv \
           -o -path '*/.claude/worktrees' -o \( -type d -exec test -e '{}/.git' \; \) \) -prune -o \
           -name project.json -exec cat {} + 2>/dev/null
  fi
}

# house_layers_evident <dir> — the registered layers whose evidence <dir> carries, comma-separated.
house_layers_evident() {
  local dir="$1" id kind pat found='' pj
  pj="$(house_project_jsons "$dir")"
  for id in $(printf '%s' "$HOUSE_LAYERS" | tr ',' ' '); do
    while IFS=' ' read -r kind pat; do
      [ -n "$kind" ] || continue
      case "$kind" in
        file)         [ -f "$dir/$pat" ] ;;
        dependency)   grep -qF -- "$pat" "$dir/package.json" 2>/dev/null ;;
        project-json) printf '%s' "$pj" | grep -q -- "$pat" ;;
        *)            false ;;
      esac && { found="${found:+$found,}$id"; break; }
    done <<HOUSE_EVIDENCE
$(house_layer_evidence "$id")
HOUSE_EVIDENCE
  done
  printf '%s\n' "$found"
}
