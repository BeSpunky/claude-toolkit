// The seed APPLIER — turns a declarative world (tools/seed/world.mjs) into emulator writes. Generator-owned:
// rewritten on every upgrade, so a fix here reaches every project. Your data lives in world.mjs; nothing in
// this file needs touching to add accounts, docs, collections or worlds.
//
// Zero dependencies on purpose: this talks to the emulators' REST APIs directly (Node's global fetch), so
// the workspace root needs no firebase-admin and this tool stays decoupled from the functions package.
// Accounts are created through the Auth emulator; Firestore docs are written with the emulator's
// `Bearer owner` admin bypass, so the app's real security rules are irrelevant to seeding.
//
// IT ONLY EVER WRITES WHERE IT IS TOLD — hosts AND project. The emulator hosts come from FIREBASE_AUTH_EMULATOR_HOST
// and FIRESTORE_EMULATOR_HOST, the project from GCLOUD_PROJECT — all three set by `firebase emulators:exec`, which is
// how tools/seed/build-seeds.sh runs it against a throwaway emulator pair. With any of them unset it REFUSES rather
// than guessing: `localhost:9099` / `localhost:8080` are the base suite's ports, so a guessed host writes into
// whichever stack happens to own them, and a guessed project writes where that stack's app never looks (its Auth
// keeps accounts per project id).

/** Marker: resolve to the uid of the account created under `key`. Use for ids or fields. */
export const ref = (key) => ({ __ref: key });
/** Marker: a Firestore timestamp from an ISO string (a bare string stays a string field). */
export const at = (iso) => ({ __ts: iso });

/** The emulator endpoints to write to — resolved when a world is applied, never at import (build-seeds.sh
 *  imports world.mjs, and with it this file, just to list the worlds). */
function emulatorTargets() {
  const auth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestore = process.env.FIRESTORE_EMULATOR_HOST;
  const project = process.env.GCLOUD_PROJECT;
  if (!auth || !firestore || !project) {
    const missing = [
      !auth && 'FIREBASE_AUTH_EMULATOR_HOST',
      !firestore && 'FIRESTORE_EMULATOR_HOST',
      !project && 'GCLOUD_PROJECT',
    ].filter(Boolean);
    throw Object.assign(new Error(
      `${missing.join(', ')} not set — refusing to guess which emulators, and which project, to write to.\n` +
        '  To rebuild the committed seeds (the usual case):  nx run firebase:seed:build\n' +
        '    — it boots its own throwaway emulators, applies every world, and exports them to tools/emulator-seeds/.\n' +
        '  To load a seed into the stack you are serving:     nx run firebase:reset, then restart the serve.\n' +
        '  To write into a RUNNING stack on purpose, name it:  FIREBASE_AUTH_EMULATOR_HOST=localhost:<auth port> \\\n' +
        '    FIRESTORE_EMULATOR_HOST=localhost:<firestore port> GCLOUD_PROJECT=<its project, from its banner> \\\n' +
        '    node tools/seed/build.mjs <world>',
    ), { name: 'SeedTargetError' });
  }
  return { auth, firestore, project };
}

/** Create an Auth-emulator account for an email and return its uid (localId). */
async function createAccount(host, email) {
  const res = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // A password fully forms the account; passwordless/magic-link sign-in with the same
    // email still resolves to THIS account (email is the identity), inheriting its uid.
    body: JSON.stringify({ email, password: 'seed-password', returnSecureToken: true }),
  });
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
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  throw new Error(`Cannot encode seed value of type ${typeof value}: ${String(value)}`);
}

function requireUid(uids, key) {
  const uid = uids[key];
  if (!uid) throw new Error(`Seed references unknown account "${key}" — add it to the world's accounts.`);
  return uid;
}

/** Write (create-or-overwrite) one Firestore doc, with already-encoded typed fields. */
async function writeDoc({ firestore, project }, path, fields) {
  const res = await fetch(`http://${firestore}/v1/projects/${project}/databases/(default)/documents/${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Firestore write(${path}) failed: ${res.status} ${await res.text()}`);
}

/** Apply a declarative world: create its accounts, then write every doc it describes. */
export async function applyWorld(name, world) {
  const targets = emulatorTargets();
  const accounts = Object.entries(world.accounts ?? {});
  const uids = {};
  for (const [key, account] of accounts) {
    uids[key] = await createAccount(targets.auth, account.email);
  }
  for (const { collection, id, fields } of world.docs ?? []) {
    const docId = id && typeof id === 'object' && '__ref' in id ? requireUid(uids, id.__ref) : id;
    const encoded = Object.fromEntries(Object.entries(fields ?? {}).map(([k, v]) => [k, encode(v, uids)]));
    await writeDoc(targets, `${collection}/${docId}`, encoded);
  }
  const docs = (world.docs ?? []).length;
  console.log(
    accounts.length
      ? `[seed] '${name}' world ready (${docs} doc${docs === 1 ? '' : 's'}) — sign in as: ` +
          accounts.map(([, a]) => (a.name ? `${a.email} (${a.name})` : a.email)).join(' · ')
      : `[seed] '${name}' world ready (${docs} doc${docs === 1 ? '' : 's'}) — no accounts seeded; sign up through the Auth emulator.`,
  );
}
