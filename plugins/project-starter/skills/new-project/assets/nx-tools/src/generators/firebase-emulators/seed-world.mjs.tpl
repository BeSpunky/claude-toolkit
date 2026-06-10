// The seed worlds — the single source of truth for what a "known good" emulator
// state contains. Run inside `firebase emulators:exec` (see tools/seed/build-seeds.sh),
// which sets the emulator host env vars and exports the resulting state to a seed dir.
//
// Zero dependencies on purpose: this talks to the emulators' REST APIs directly (Node's
// global fetch), so the workspace root needs no firebase-admin and this tool stays
// decoupled from the functions package. Accounts are created through the Auth emulator;
// Firestore docs are written with the emulator's `Bearer owner` admin bypass, so the
// app's real security rules are irrelevant to seeding.
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
//                                    to it, a `reset:<name>` target in firebase/project.json.
//
// DIRECTIVE — the seed is part of the schema contract. The doc shapes below must
// MIRROR the app's real backend (wherever your app defines its Firestore document
// shapes). Whenever a document shape changes or a feature gains a backend, update the
// matching world here and rebuild — `yarn nx run firebase:seed:build` — committing
// tools/emulator-seeds/, so the seed never drifts from the code. The starter `default`
// world below is a placeholder: replace its accounts/docs with your app's real model
// as soon as one exists.
// ─────────────────────────────────────────────────────────────────────────────

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-{{workspaceName}}';

// A fixed timestamp keeps exported seeds byte-stable across rebuilds (no spurious diffs
// from "now"). Only cosmetic for dev data.
const CREATED_AT = '2026-01-01T00:00:00.000Z';

/** Marker: resolve to the uid of the account created under `key`. Use for ids or fields. */
export const ref = (key) => ({ __ref: key });
/** Marker: a Firestore timestamp from an ISO string (a bare string stays a string field). */
export const at = (iso) => ({ __ts: iso });

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

// ── The applier (generic; never needs touching to add data) ────────────────────

/** Create an Auth-emulator account for an email and return its uid (localId). */
async function createAccount(email) {
  const res = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // A password fully forms the account; passwordless/magic-link sign-in with the same
      // email still resolves to THIS account (email is the identity), inheriting its uid.
      body: JSON.stringify({ email, password: 'seed-password', returnSecureToken: true }),
    },
  );
  if (!res.ok) throw new Error(`Auth signUp(${email}) failed: ${res.status} ${await res.text()}`);
  return (await res.json()).localId;
}

/** Encode any JS value as a Firestore REST typed value, resolving ref()/at() markers. */
function encode(value, uids) {
  if (value && typeof value === 'object') {
    if ('__ref' in value) return { stringValue: requireUid(uids, value.__ref) };
    if ('__ts' in value) return { timestampValue: value.__ts };
    if (Array.isArray(value)) return { arrayValue: { values: value.map((v) => encode(v, uids)) } };
    const fields = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v, uids)]));
    return { mapValue: { fields } };
  }
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number')
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  throw new Error(`Cannot encode seed value of type ${typeof value}: ${String(value)}`);
}

function requireUid(uids, key) {
  const uid = uids[key];
  if (!uid) throw new Error(`Seed references unknown account "${key}" — add it to the world's accounts.`);
  return uid;
}

/** Write (create-or-overwrite) one Firestore doc, with already-encoded typed fields. */
async function writeDoc(path, fields) {
  const res = await fetch(
    `http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ fields }),
    },
  );
  if (!res.ok) throw new Error(`Firestore write(${path}) failed: ${res.status} ${await res.text()}`);
}

/** Apply a declarative world: create its accounts, then write every doc it describes. */
export async function applyWorld(name, world) {
  const uids = {};
  for (const [key, account] of Object.entries(world.accounts)) {
    uids[key] = await createAccount(account.email);
  }
  for (const { collection, id, fields } of world.docs) {
    const docId = id && typeof id === 'object' && '__ref' in id ? requireUid(uids, id.__ref) : id;
    const encoded = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encode(v, uids)]));
    await writeDoc(`${collection}/${docId}`, encoded);
  }
  const who = Object.values(world.accounts)
    .map((a) => `${a.email} (${a.name})`)
    .join(' · ');
  console.log(`[seed] '${name}' world ready — sign in as: ${who}`);
}
