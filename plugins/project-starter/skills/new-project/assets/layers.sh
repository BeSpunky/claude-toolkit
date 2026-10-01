# shellcheck shell=bash
# GENERATED from the @bespunky/nx-tools layer registry (src/layers/*.ts, via `cli.js shell`). DO NOT EDIT.
# Regenerate with:  node tools/test-layers/run.mjs --write   (CI fails when this file drifts from the registry.)
#
# The pure-bash view of the registry for the two readers that cannot load the package: scaffold.sh, which
# validates --ensure before anything is installed, and the SessionStart hook, which must stay a few greps.
# Sourcing it defines variables and functions only; it runs nothing.

HOUSE_LAYERS='nx,agent,js,web,angular,design-system,navigation,firebase'
HOUSE_LAYER_FLOOR='nx'
HOUSE_LAYERS_ENSURABLE_SCAFFOLD='nx,agent,web,angular,design-system,firebase'
HOUSE_LAYERS_ENSURABLE_SYNC='nx,agent,firebase'

# house_layer_title <id> — one line naming the layer.
house_layer_title() {
  case "$1" in
    nx) printf '%s\n' 'Nx workspace (the floor)' ;;
    agent) printf '%s\n' 'Agent DX (Claude settings, devcontainer, window identity)' ;;
    js) printf '%s\n' 'TypeScript/JavaScript libraries' ;;
    web) printf '%s\n' 'Web dev loop (serve, worktree domains, shared browser)' ;;
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
    js) printf '%s\n' 'nx' ;;
    web) printf '%s\n' 'agent' ;;
    angular) printf '%s\n' 'nx' ;;
    design-system) printf '%s\n' 'nx' ;;
    navigation) printf '%s\n' 'angular' ;;
    firebase) printf '%s\n' 'nx' ;;
  esac
}

# house_layer_hint <id> — how a human brings the layer into being.
house_layer_hint() {
  case "$1" in
    nx) printf '%s\n' '`scaffold.sh --sync <project>` — the floor is always ensured: `nx init` in place (into node_modules when the repo has a package.json, else through the Nx wrapper, ./nx)' ;;
    agent) printf '%s\n' '`scaffold.sh --sync --ensure=agent <project>`' ;;
    js) printf '%s\n' '`nx add @nx/js` (or `nx g @bespunky/nx-tools:publishable-lib <name> --stack=js`)' ;;
    web) printf '%s\n' 'an app with a dev-server target (e.g. the `angular` layer: `nx g @bespunky/nx-tools:app apps/<name>`)' ;;
    angular) printf '%s\n' '`nx add @nx/angular`, then `nx g @bespunky/nx-tools:app apps/<name>`' ;;
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
    js) printf '%s\n' 'the publishable-library and tool-extraction conventions in HOUSE.md' ;;
    web) printf '%s\n' 'the serve composer, worktree domains, the shared co-driven browser, Playwright, :80' ;;
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
    js) printf '%s\n' 'no' ;;
    web) printf '%s\n' 'no' ;;
    angular) printf '%s\n' 'no' ;;
    design-system) printf '%s\n' 'no' ;;
    navigation) printf '%s\n' 'no' ;;
    firebase) printf '%s\n' 'yes' ;;
  esac
}

# house_layer_evidence <id> — `file <path>` | `dependency <fixed string>` | `project-json <grep BRE>` lines.
house_layer_evidence() {
  case "$1" in
    nx) printf '%s\n' 'file nx.json' ;;
    agent) printf '%s\n' 'file .devcontainer/.bespunky-devcontainer.json
file .vscode/.window-identity.json' ;;
    js) printf '%s\n' 'dependency "@nx/js"
project-json "executor"[[:space:]]*:[[:space:]]*"@nx/js:' ;;
    web) printf '%s\n' 'project-json "dev-server"[[:space:]]*:
project-json "serve"[[:space:]]*:' ;;
    angular) printf '%s\n' 'dependency "@angular/core"
dependency "@nx/angular"
project-json "executor"[[:space:]]*:[[:space:]]*"@angular/build:
project-json "executor"[[:space:]]*:[[:space:]]*"@angular-devkit/build-angular:' ;;
    design-system) printf '%s\n' 'project-json "type:design-system"' ;;
    navigation) printf '%s\n' 'project-json "type:navigation"' ;;
    firebase) printf '%s\n' 'file firebase.json' ;;
  esac
}

# house_layers_evident <dir> — the registered layers whose evidence <dir> carries, comma-separated.
house_layers_evident() {
  local dir="$1" id kind pat found='' pj
  pj="$(find "$dir" \( -name node_modules -o -name .git -o -name dist -o -name .nx -o -name .angular -o -name tmp \
         -o -name vendor -o -name target -o -name build -o -name out -o -name coverage -o -name .venv \) -prune -o \
         -name project.json -exec cat {} + 2>/dev/null)"
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
