// FROZEN — the house targets @bespunky/nx-tools 0.49.2 wrote, captured from a stock project it scaffolded
// (`house.sh new --preset=angular --firebase --staging coach web`, apps/ + tools/ layout, 2026-10-07) — never edited.
//
// DATA OF ONE RUNG: ./record-house-targets.ts reads it to write the FIRST house-targets record of a project coming
// from before 0.50.0, and nothing else ever does. That is the whole story for later versions: from 0.50.0 the record
// is written by the generators on every run, so no release after this one needs a baseline again — a project with no
// record is then one whose record was deleted, and the merge says what it cannot tell instead of guessing.
//
// Captured in ONE layout, so the rung renders it for the project's own (CAPTURED below → where the functions
// project actually lives and what it is called), and records a value only where the project's still equals it.
// Keyed by the house project's canonical name.
import type { TargetConfiguration } from '@nx/devkit';

/** Where and under what name the functions project was when this was captured. */
export const CAPTURED = { functionsRoot: 'apps/functions', functionsName: 'functions' } as const;

export const HOUSE_TARGETS_AS_OF_0_49_2: Readonly<Record<string, Record<string, TargetConfiguration>>> = {
  "functions": {
    "build": {
      "executor": "@nx/esbuild:esbuild",
      "outputs": [
        "{options.outputPath}"
      ],
      "options": {
        "outputPath": "dist/apps/functions",
        "main": "apps/functions/src/main.ts",
        "tsConfig": "apps/functions/tsconfig.app.json",
        "platform": "node",
        "format": [
          "cjs"
        ],
        "bundle": true,
        "thirdParty": false,
        "generatePackageJson": true,
        "deleteOutputPath": true,
        "assets": [
          {
            "glob": ".env",
            "input": "apps/functions",
            "output": "."
          }
        ],
        "esbuildOptions": {
          "outExtension": {
            ".js": ".js"
          }
        }
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    },
    "deploy": {
      "executor": "nx:run-commands",
      "dependsOn": [
        "build"
      ],
      "options": {
        "command": "firebase deploy --only functions",
        "cwd": "{workspaceRoot}"
      }
    },
    "push-secrets": {
      "executor": "nx:run-commands",
      "options": {
        "command": "bash tools/push-secrets.sh",
        "cwd": "{workspaceRoot}"
      }
    }
  },
  "firebase": {
    "emulators": {
      "continuous": true,
      "executor": "nx:run-commands",
      "options": {
        "command": "bash tools/emulators.sh",
        "cwd": "{workspaceRoot}"
      },
      "dependsOn": [
        {
          "projects": [
            "functions"
          ],
          "target": "build"
        }
      ]
    },
    "emulators:auth": {
      "continuous": true,
      "executor": "nx:run-commands",
      "options": {
        "command": "bash tools/emulators.sh --only auth,ui",
        "cwd": "{workspaceRoot}"
      }
    },
    "emulators:firestore": {
      "continuous": true,
      "executor": "nx:run-commands",
      "options": {
        "command": "bash tools/emulators.sh --only firestore,ui",
        "cwd": "{workspaceRoot}"
      }
    },
    "emulators:storage": {
      "continuous": true,
      "executor": "nx:run-commands",
      "options": {
        "command": "bash tools/emulators.sh --only storage,ui",
        "cwd": "{workspaceRoot}"
      }
    },
    "emulators:functions": {
      "continuous": true,
      "executor": "nx:run-commands",
      "options": {
        "command": "bash tools/emulators.sh --only functions,ui",
        "cwd": "{workspaceRoot}"
      },
      "dependsOn": [
        {
          "projects": [
            "functions"
          ],
          "target": "build"
        }
      ]
    },
    "seed:build": {
      "executor": "nx:run-commands",
      "options": {
        "command": "bash tools/seed/build-seeds.sh",
        "cwd": "{workspaceRoot}"
      }
    },
    "reset": {
      "executor": "nx:run-commands",
      "options": {
        "command": "bash tools/emulator-data.sh reset",
        "cwd": "{workspaceRoot}"
      }
    }
  },
  "shared-browser": {
    "up": {
      "executor": "nx:run-commands",
      "options": {
        "command": "bash tools/shared-browser/shared-browser up",
        "cwd": "{workspaceRoot}"
      }
    },
    "down": {
      "executor": "nx:run-commands",
      "options": {
        "command": "bash tools/shared-browser/shared-browser down",
        "cwd": "{workspaceRoot}"
      }
    },
    "status": {
      "executor": "nx:run-commands",
      "options": {
        "command": "bash tools/shared-browser/shared-browser status",
        "cwd": "{workspaceRoot}"
      }
    },
    "restart": {
      "executor": "nx:run-commands",
      "options": {
        "command": "bash tools/shared-browser/shared-browser restart",
        "cwd": "{workspaceRoot}"
      }
    },
    "clean": {
      "executor": "nx:run-commands",
      "options": {
        "command": "bash tools/shared-browser/shared-browser clean",
        "cwd": "{workspaceRoot}"
      }
    },
    "url": {
      "executor": "nx:run-commands",
      "options": {
        "command": "bash tools/shared-browser/shared-browser url",
        "cwd": "{workspaceRoot}"
      }
    },
    "logs": {
      "executor": "nx:run-commands",
      "options": {
        "command": "bash tools/shared-browser/shared-browser logs",
        "cwd": "{workspaceRoot}"
      }
    }
  },
  "worktree-domains": {
    "list": {
      "executor": "nx:run-commands",
      "options": {
        "command": "bash tools/worktree-domains/worktree-domains list",
        "cwd": "{workspaceRoot}"
      }
    },
    "reconcile": {
      "executor": "nx:run-commands",
      "options": {
        "command": "bash tools/worktree-domains/worktree-domains reconcile",
        "cwd": "{workspaceRoot}"
      }
    },
    "status": {
      "executor": "nx:run-commands",
      "options": {
        "command": "bash tools/worktree-domains/worktree-domains status",
        "cwd": "{workspaceRoot}"
      }
    },
    "logs": {
      "executor": "nx:run-commands",
      "options": {
        "command": "bash tools/worktree-domains/worktree-domains logs",
        "cwd": "{workspaceRoot}"
      }
    },
    "stop": {
      "executor": "nx:run-commands",
      "options": {
        "command": "bash tools/worktree-domains/worktree-domains stop",
        "cwd": "{workspaceRoot}"
      }
    }
  }
};
