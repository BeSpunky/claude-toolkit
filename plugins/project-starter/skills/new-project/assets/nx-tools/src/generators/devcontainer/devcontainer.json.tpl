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

  // No `forwardPorts` — VS Code auto-detects every container binding and forwards
  // each to a free host port. Essential when running multiple devcontainers in
  // parallel: explicit `forwardPorts` would all claim the same host port and
  // collide; auto-forward picks a unique free port per container (visible in the
  // Ports panel). `portsAttributes` labels still apply to auto-detected ports;
  // `onAutoForward` controls per-port notification behavior — backend emulators
  // are silenced (you rarely click into them), the dev server opens in the
  // preview pane.
  "portsAttributes": {
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
    "source=${localWorkspaceFolderBasename}-angular,target=${containerWorkspaceFolder}/.angular,type=volume"
  ]
}
