// BeSpunky-standard devcontainer. Node from the base image; Claude CLI (feature) + Claude VS Code extension.
// Conditional blocks (`{{#flag}}...{{/flag}}`) are expanded by the devcontainer generator before writing.
{
  "name": "{{name}}",
  "image": "mcr.microsoft.com/devcontainers/typescript-node:{{nodeMajor}}",

  "features": {
    "ghcr.io/devcontainers-extra/features/claude-code": {},
    "ghcr.io/devcontainers/features/github-cli": {}{{#firebase}},
    "ghcr.io/devcontainers-extra/features/firebase-cli": {},
    "ghcr.io/jajera/features/gcloud-cli": {}{{/firebase}}
    // Note: the JDK required by the Firebase emulators (Firestore / RTDB / Storage all run
    // on the JVM) is installed via apt in .devcontainer/post-create.sh — NOT as a
    // devcontainer feature. The canonical `ghcr.io/devcontainers/features/java` is
    // SDKMAN-based and structurally fragile (its install fetches from github.com, which
    // intermittently fails: TLS errors / "Could not connect to server"). apt pulls from
    // Debian's package mirrors which are far more reliable, and apt runs in the container's
    // runtime network stack rather than the buildx build phase.
  },

  "customizations": {
    "vscode": {
      "extensions": [
        "Anthropic.claude-code",
        "nrwl.angular-console",
        "Angular.ng-template",
        "dbaeumer.vscode-eslint",
        "esbenp.prettier-vscode",
        "EditorConfig.EditorConfig",
        "eamodio.gitlens",
        "GitHub.vscode-github-actions",
        "Tobermory.es6-string-html",
        "christian-kohler.path-intellisense",
        "formulahendry.auto-rename-tag",
        "usernamehw.errorlens"{{#firebase}},
        "toba.vsfire"{{/firebase}}
      ],
      "settings": {
        "claude-code.dangerouslySkipPermissions": true,
        "editor.formatOnSave": false,
        "editor.codeActionsOnSave": {
          "source.fixAll.eslint": "explicit"
        },
        "eslint.validate": ["javascript", "typescript", "html"],
        "typescript.preferences.importModuleSpecifier": "relative",
        "typescript.updateImportsOnFileMove.enabled": "always",
        "files.associations": {
          "*.mdc": "markdown"
        }
      }
    }
  },

  // All post-create setup (yarn install, claude-toolkit plugin pre-install, Firebase
  // prerequisites when firebase.json is present) lives in .devcontainer/post-create.sh
  // so this stays a one-liner. The script is self-adapting — no mustache conditional needed.
  "postCreateCommand": "bash .devcontainer/post-create.sh",
  "remoteUser": "node",

  // Let the non-root `node` user bind privileged ports: the worktree-domains reverse proxy binds :80 so
  // each worktree gets a pretty http://<slug>.localhost/ domain. This namespaced sysctl is applied at
  // container start, so the proxy binds :80 with no runtime sudo.
  "runArgs": ["--sysctl", "net.ipv4.ip_unprivileged_port_start=0"],

  // Forward :80 (the worktree-domains reverse proxy → pretty http://<slug>.localhost/ URLs, reachable
  // from a HOST browser too) and the shared-browser noVNC port (6080) in EVERY scaffold. The
  // shared-browser stack (tools/shared-browser, started on demand) serves its noVNC web client on 6080,
  // the ONLY shared-browser port forwarded — CDP 9223 and VNC 5900 stay bound to loopback, so full
  // browser control never leaves the container. Always present, firebase or not; the Firebase
  // dev-server + emulator ports are appended below when applicable.
{{#firebase}}  //
  // Firebase also forwards the dev server + emulator ports to the SAME host port. This is
  // REQUIRED for the app to work in a *host* browser: the page loads over forwarded
  // :4200, then the Firebase SDK *inside that page* calls the emulators at the
  // hardcoded localhost:9099 / localhost:8080 (environment.ts) — addresses that only
  // resolve from the host if those container ports are forwarded to the identical
  // host port. Auto-forward alone may map a container port to a *different* free host
  // port, which the browser SDK can't discover → the page hammers localhost:9099 and
  // gets ERR_CONNECTION_REFUSED (auth token refresh fails → Firestore writes hang).
  //
  // Tradeoff: running SEVERAL Firebase devcontainers in parallel collides on these
  // host ports. If you ever do, remap one container's ports here AND in
  // environment.ts + firebase.json together (they must agree). For the normal
  // single-container case, same-port is correct.
{{/firebase}}  "forwardPorts": [80, 6080{{#firebase}}, 4200, 4000, 9099, 8080, 9150, 9199, 5001{{/firebase}}],
  // `portsAttributes` labels the (forwarded or auto-detected) ports; `onAutoForward`
  // controls per-port notification behavior — backend emulators are silenced (you
  // rarely click into them), the dev server opens in the preview pane.
  "portsAttributes": {
    "80": { "label": "Worktree domains (pretty <slug>.localhost URLs)", "onAutoForward": "silent" },
    "6080": { "label": "Shared Browser (noVNC)", "onAutoForward": "notify" },
    "4200": { "label": "Angular Dev Server", "onAutoForward": "openPreview" }{{#firebase}},
    "4000": { "label": "Firebase Emulator UI", "onAutoForward": "notify" },
    "9099": { "label": "Auth Emulator", "onAutoForward": "silent" },
    "8080": { "label": "Firestore Emulator", "onAutoForward": "silent" },
    "9150": { "label": "Firestore WebSocket", "onAutoForward": "silent" },
    "9199": { "label": "Storage Emulator", "onAutoForward": "silent" },
    "5001": { "label": "Functions Emulator", "onAutoForward": "silent" }{{/firebase}}
  },
  "otherPortsAttributes": {
    "onAutoForward": "silent"
  },
  "remoteEnv": {
    "PATH": "${containerWorkspaceFolder}/node_modules/.bin:${containerEnv:PATH}",
    "CLAUDE_CODE_BYPASS_ALL_PERMISSIONS": "1",
    // Reliable file-watching for chokidar-based watchers over WSL/Docker mounts.
    // (Replaces the legacy `poll` option on serve targets, which the modern @angular/build:dev-server schema rejects.)
    "CHOKIDAR_USEPOLLING": "true",
    "CHOKIDAR_INTERVAL": "1000"
  },
  "mounts": [
    "source=${localWorkspaceFolder}/.claude/data,target=/home/node/.claude,type=bind,consistency=cached",
    "source=${localWorkspaceFolderBasename}-node_modules,target=${containerWorkspaceFolder}/node_modules,type=volume",
    "source=${localWorkspaceFolderBasename}-nx,target=${containerWorkspaceFolder}/.nx,type=volume",
    "source=${localWorkspaceFolderBasename}-angular,target=${containerWorkspaceFolder}/.angular,type=volume",
    // Playwright browser binaries (~150 MB Chromium). Mounted as a per-workspace
    // volume so rebuilds reuse the cached browser instead of re-downloading on
    // every postCreate. Populated by post-create.sh when @playwright/test is in
    // package.json.
    "source=${localWorkspaceFolderBasename}-playwright-cache,target=/home/node/.cache/ms-playwright,type=volume"
  ]
}
