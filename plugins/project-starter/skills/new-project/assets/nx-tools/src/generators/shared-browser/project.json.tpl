{
  "name": "shared-browser",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "library",
  "tags": ["tooling"],
  "targets": {
    "up": {
      "executor": "nx:run-commands",
      "options": { "command": "bash tools/shared-browser/shared-browser up", "cwd": "{workspaceRoot}" }
    },
    "down": {
      "executor": "nx:run-commands",
      "options": { "command": "bash tools/shared-browser/shared-browser down", "cwd": "{workspaceRoot}" }
    },
    "status": {
      "executor": "nx:run-commands",
      "options": { "command": "bash tools/shared-browser/shared-browser status", "cwd": "{workspaceRoot}" }
    },
    "restart": {
      "executor": "nx:run-commands",
      "options": { "command": "bash tools/shared-browser/shared-browser restart", "cwd": "{workspaceRoot}" }
    },
    "clean": {
      "executor": "nx:run-commands",
      "options": { "command": "bash tools/shared-browser/shared-browser clean", "cwd": "{workspaceRoot}" }
    },
    "url": {
      "executor": "nx:run-commands",
      "options": { "command": "bash tools/shared-browser/shared-browser url", "cwd": "{workspaceRoot}" }
    },
    "logs": {
      "executor": "nx:run-commands",
      "options": { "command": "bash tools/shared-browser/shared-browser logs", "cwd": "{workspaceRoot}" }
    }
  }
}
