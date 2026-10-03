// Staging environment. Selected at build time via
// `targets.build.configurations.staging.fileReplacements` in project.json, so
// `nx build <app> --configuration=staging` swaps this in for environment.ts. The
// STAGING App Hosting backend runs that build (see apphosting.staging.yaml).
//
// Fill it like environment.prod.ts (from `firebase apps:sdkconfig`) with your STAGING
// config. Two isolation models:
//   • Same project as prod, isolated Firestore DATABASE — set `databaseId` below (e.g.
//     'staging'), create that named DB in the console, and add it to firebase.json's
//     `firestore` array. NOTE this isolates Firestore ONLY: Auth users are shared (same
//     project = one user pool), and the single shared Cloud Functions deployment writes
//     via the Admin SDK's default `getFirestore()` → the `(default)` DB, so anything a
//     callable persists still lands in prod.
//   • Separate Firebase PROJECT for staging — point `firebase` at it (its own Auth pool
//     + data); more operational cost, full isolation.
//
// Do NOT hand-fabricate — the CLI is the source of truth. Empty placeholders stay empty
// so a half-wired staging build fails LOUDLY at bootstrap (provideAppFirebase() throws
// with the recipe).
import type { Environment } from './environment.interface';

// No `emulators` block — like prod, staging talks to the real backend.
export const environment: Environment = {
  production: true,
  firebase: {
    projectId: '{{projectId}}',
    apiKey: '{{apiKey}}',
    appId: '{{appId}}',
    authDomain: '{{authDomain}}',
    // Optional (Firestore multi-database): the named DB staging targets in the SAME
    // project. Uncomment + set, create it in the console, and add it to firebase.json's
    // `firestore` array. Omit → staging shares prod's `(default)` database.
    // databaseId: 'staging',
  },
};
