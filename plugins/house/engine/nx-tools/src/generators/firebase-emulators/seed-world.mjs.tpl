// The seed worlds — the single source of truth for what a "known good" emulator
// state contains. YOURS: written once, never regenerated. The generic machinery that
// applies a world (encoder, REST calls, the emulator-host guard) is tools/seed/apply.mjs,
// which the house owns and keeps current; tools/seed/build-seeds.sh runs both inside
// `firebase emulators:exec` and exports the resulting state to a seed dir.
//
// ─────────────────────────────────────────────────────────────────────────────
// SCALING THE SEED — read this before changing the data model.
//
// A world is described DECLARATIVELY below (`WORLDS`): a set of accounts and a flat
// list of Firestore docs. The applier turns that description into REST calls. This is
// deliberate so the seed scales by EXTENSION, never by rewriting write logic:
//
//   • Add a field to a doc        → add a key to its `fields` (any JS value; the
//                                    encoder maps strings/numbers/booleans/arrays/
//                                    nested objects/null to Firestore types for you).
//   • Add a collection / doc      → push another `{ collection, id, fields }` entry.
//                                    `collection` is a full path, so SUBCOLLECTIONS
//                                    work too: 'teams/demo-team/messages'.
//   • Reference an account's uid  → use ref('<accountKey>') for a doc id or a field
//                                    value; it resolves to the created account's uid.
//   • Add a whole new seed        → add a key to `WORLDS` (build-seeds.sh picks it up
//                                    automatically) and, if you want one-command resets
//                                    to it, a `reset:<name>` target on the `firebase` project.
//
// DIRECTIVE — the seed is part of the schema contract. The doc shapes below must
// MIRROR the app's real backend (wherever your app defines its Firestore document
// shapes). Whenever a document shape changes or a feature gains a backend, update the
// matching world here and rebuild — `yarn nx run firebase:seed:build` — committing
// tools/emulator-seeds/, so the seed never drifts from the code. The starter `default`
// world below is a placeholder: replace its accounts/docs with your app's real model
// as soon as one exists.
// ─────────────────────────────────────────────────────────────────────────────

import { ref, at } from './apply.mjs';

// A fixed timestamp keeps exported seeds byte-stable across rebuilds (no spurious diffs
// from "now"). Only cosmetic for dev data.
const CREATED_AT = '2026-01-01T00:00:00.000Z';

// ── The worlds (the declarative source of truth) ───────────────────────────────
// Sign in with one of an account's emails (against the Auth emulator) and you land
// straight in its world — the emulator matches the existing account by email, so you
// inherit the seeded uid (and thus its docs). No re-onboarding every serve.
export const WORLDS = {
  // The starter world: one signed-up user with a user doc. Replace with your app's
  // real accounts + document shapes (see the SCALING THE SEED directive above).
  default: {
    accounts: {
      demo: { email: 'demo@demo.test', name: 'Demo' },
    },
    docs: [
      {
        collection: 'users',
        id: ref('demo'),
        fields: { displayName: 'Demo', createdAt: at(CREATED_AT) },
      },
    ],
  },
};
