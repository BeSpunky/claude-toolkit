// FROZEN — the house targets @bespunky/nx-tools 0.49.2 wrote, captured from a stock project it scaffolded
// (`house.sh new --preset=angular --firebase --staging coach web`, apps/ + tools/ layout, 2026-10-07) — never edited.
//
// WHY. The three-way merge (./house-targets.ts) needs a base: what the house last wrote. From 0.50.0 that is the
// committed record (.bespunky/house-targets.json). A project upgrading from 0.49.x has none, so a key the HOUSE
// changed since looked exactly like a hand edit, and every such project was told its value was "replaced" — crying
// wolf on the very report meant to catch a lost edit. 0.49.2 is the last release that wrote no record, so its
// output is the base of the first record-less run: a value equal to it is the house's own, replaced silently.
// Anything else is still reported. Keyed by the house project's canonical name.
import type { TargetConfiguration } from '@nx/devkit';

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
