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

  "postCreateCommand": "yarn install && (claude plugin marketplace add BeSpunky/claude-toolkit && claude plugin install project-starter@claude-toolkit --scope project && claude plugin install engineering@claude-toolkit --scope project || echo 'NOTE: Claude plugin pre-install skipped; .claude/settings.json will offer install on first run')",
  "remoteUser": "node",{{#firebase}}

  // Firebase emulator port-forwards (added when scaffolded with --firebase).
  "forwardPorts": [4000, 9099, 8080, 9199, 5001],
  "portsAttributes": {
    "4000": { "label": "Firebase Emulator UI" },
    "9099": { "label": "Auth Emulator" },
    "8080": { "label": "Firestore Emulator" },
    "9199": { "label": "Storage Emulator" },
    "5001": { "label": "Functions Emulator" }
  },{{/firebase}}
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
