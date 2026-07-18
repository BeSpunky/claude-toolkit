{
  "name": "worktree-domains",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "library",
  "tags": ["tooling"],
  "targets": {
    "list": {
      "executor": "nx:run-commands",
      "options": { "command": "bash tools/worktree-domains/worktree-domains list", "cwd": "{workspaceRoot}" }
    },
    "reconcile": {
      "executor": "nx:run-commands",
      "options": { "command": "bash tools/worktree-domains/worktree-domains reconcile", "cwd": "{workspaceRoot}" }
    },
    "status": {
      "executor": "nx:run-commands",
      "options": { "command": "bash tools/worktree-domains/worktree-domains status", "cwd": "{workspaceRoot}" }
    },
    "logs": {
      "executor": "nx:run-commands",
      "options": { "command": "bash tools/worktree-domains/worktree-domains logs", "cwd": "{workspaceRoot}" }
    },
    "stop": {
      "executor": "nx:run-commands",
      "options": { "command": "bash tools/worktree-domains/worktree-domains stop", "cwd": "{workspaceRoot}" }
    }
  }
}
