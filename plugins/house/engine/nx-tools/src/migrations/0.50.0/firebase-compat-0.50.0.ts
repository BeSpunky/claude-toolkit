// THE @angular/fire TABLE AS OF 0.50.0 — FROZEN. A copy of generators/_utils/firebase-compat.ts as projected for this
// release (2026-10-07), for the 0.50.0 rungs: a migration freezes the values it writes, so a later toolkit running this
// rung pins exactly what 0.50.0 would have (its fixture pins that), while the generator that runs right after it judges
// with the live table and names anything newer. Never regenerate it.
import type { AngularFireTable } from '../../adapters/angular/angularfire-judge';

const BY_MAJOR: AngularFireTable['byMajor'] = {
  17: {
    stable: {
      "angularfire": "17.1.0",
      "firebase": "^10.12.0",
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
};
