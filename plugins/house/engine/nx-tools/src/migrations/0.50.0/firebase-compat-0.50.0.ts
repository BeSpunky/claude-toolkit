// THE @angular/fire TABLE AS OF 0.50.0 — FROZEN. A copy of generators/_utils/firebase-compat.ts as projected for this
// release (2026-10-07), for the 0.50.0 rungs: a migration freezes the values it writes, so a later toolkit running this
// rung pins exactly what 0.50.0 would have (its fixture pins that), while the generator that runs right after it judges
// with the live table and names anything newer. Never regenerate it. (It carries the Node needs of each firebase range,
// and of `latest` — firebase 13.0.0, published the day 0.50.0 was cut — so the rung never pins a firebase the project's
// Node cannot install.)
import type { AngularFireTable } from '../../adapters/angular/angularfire-judge';

const BY_MAJOR: AngularFireTable['byMajor'] = {
  17: {
    stable: {
      "angularfire": "17.1.0",
      "firebase": "^10.12.0",
      "firebaseResolves": {
        "firebase": "10.14.1",
        "nodeMajors": [18, 19, 20, 21, 22, 23, 24, 25, 26],
        "nodeNeeds": []
      },
      "angularCore": "^17.0.0",
      "minAngular": "17.0.0",
      "firebaseTools": "^13.0.0",
      "firebaseToolsPin": "13.35.1"
    },
    prerelease: null,
  },
  18: {
    stable: {
      "angularfire": "18.0.1",
      "firebase": "^10.12.0",
      "firebaseResolves": {
        "firebase": "10.14.1",
        "nodeMajors": [18, 19, 20, 21, 22, 23, 24, 25, 26],
        "nodeNeeds": []
      },
      "angularCore": "^18.0.0",
      "minAngular": "18.0.0",
      "firebaseTools": "^13.0.0",
      "firebaseToolsPin": "13.35.1"
    },
    prerelease: null,
  },
  19: {
    stable: {
      "angularfire": "19.2.0",
      "firebase": "^11.8.0",
      "firebaseResolves": {
        "firebase": "11.10.0",
        "nodeMajors": [18, 19, 20, 21, 22, 23, 24, 25, 26],
        "nodeNeeds": []
      },
      "angularCore": "^19.0.0",
      "minAngular": "19.0.0",
      "firebaseTools": "^13.0.0",
      "firebaseToolsPin": "13.35.1"
    },
    prerelease: null,
  },
  20: {
    stable: {
      "angularfire": "20.1.0",
      "firebase": "^11.8.0",
      "firebaseResolves": {
        "firebase": "11.10.0",
        "nodeMajors": [18, 19, 20, 21, 22, 23, 24, 25, 26],
        "nodeNeeds": []
      },
      "angularCore": "^20.0.0",
      "minAngular": "20.0.0",
      "firebaseTools": "^14.0.0 || ^15.0.0",
      "firebaseToolsPin": "15.32.1"
    },
    prerelease: null,
  },
  21: {
    stable: null,
    prerelease: {
      "angularfire": "21.0.0-rc.1",
      "firebase": "^12.18.0",
      "firebaseResolves": {
        "firebase": "12.19.0",
        "nodeMajors": [20, 21, 22, 23, 24, 25, 26],
        "nodeNeeds": [
          {
            "range": ">=20.0.0",
            "nodeMajors": [20, 21, 22, 23, 24, 25, 26],
            "packages": ["@firebase/ai@2.16.0", "@firebase/app-check-compat@0.4.7", "@firebase/app-check@0.13.1", "@firebase/app-compat@0.5.18", "@firebase/app@0.16.2", "@firebase/auth-compat@0.6.11", "@firebase/auth@1.13.6", "@firebase/component@0.7.5", "@firebase/database-compat@2.1.7", "@firebase/database@1.1.5", "@firebase/firestore-compat@0.4.14", "@firebase/firestore@4.17.2", "@firebase/functions-compat@0.5.0", "@firebase/functions@0.14.0", "@firebase/logger@0.5.2", "@firebase/storage-compat@0.4.5", "@firebase/storage@0.14.5", "@firebase/util@1.15.3"]
          }
        ]
      },
      "angularCore": "^21.2.0",
      "minAngular": "21.2.0",
      "firebaseTools": "^14.0.0 || ^15.0.0",
      "firebaseToolsPin": "15.32.1"
    },
  },
  22: {
    stable: null,
    prerelease: null,
  },
};

export const ANGULARFIRE_TABLE_0_50_0: AngularFireTable = {
  asOf: '2026-10-07',
  byMajor: BY_MAJOR,
  newestAngular: 22,
  firebaseTools: '15.32.1',
  firebaseByTag: {
    latest: {
      "firebase": "13.0.0",
      "nodeMajors": [24, 25, 26],
      "nodeNeeds": [
        {
          "range": ">=20.0.0",
          "nodeMajors": [20, 21, 22, 23, 24, 25, 26],
          "packages": ["@firebase/app-check-compat@0.4.7", "@firebase/app-check@0.13.1", "@firebase/component@0.7.5", "@firebase/database-compat@2.1.7", "@firebase/database@1.1.5", "@firebase/functions-compat@0.5.0", "@firebase/functions@0.14.0", "@firebase/logger@0.5.2", "@firebase/util@1.15.3"]
        },
        {
          "range": ">=24.12.0",
          "nodeMajors": [24, 25, 26],
          "packages": ["@firebase/ai@3.0.0", "@firebase/app-compat@0.5.19", "@firebase/app@0.16.3", "@firebase/auth-compat@0.6.12", "@firebase/auth@1.13.7", "@firebase/firestore-compat@0.4.15", "@firebase/firestore@4.18.0", "@firebase/storage-compat@0.4.6", "@firebase/storage@0.14.6"]
        }
      ]
    }
  },
};
