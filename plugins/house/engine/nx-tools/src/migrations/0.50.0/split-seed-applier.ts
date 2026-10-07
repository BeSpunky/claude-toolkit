// 0.50.0 — the seed APPLIER leaves the project-owned tools/seed/world.mjs for the generator-owned tools/seed/apply.mjs.
//
// WHY. world.mjs was seeded once and never regenerated (it holds the project's data), yet it also carried the
// generic machinery that applies a world: the encoder, the REST calls, the banner, and the emulator hosts. So every
// fix to that machinery was frozen out of every existing project — notably the host fallback to `localhost:9099` /
// `localhost:8080`, which made a bare `node tools/seed/build.mjs` write into whichever suite owned the base ports
// (another worktree's, or a full suite whose triggers then fired real side effects), and a banner that printed
// "sign in as: " with nothing after it for a world without accounts. The applier now lives in apply.mjs, rewritten
// on every upgrade; world.mjs keeps only the worlds.
//
// WHAT IT DOES, to a world.mjs whose applier is still the house's own (byte-for-byte, modulo trailing whitespace —
// it never changed between the template's first release and 0.49):
//   - removes the applier section (from its `── The applier` banner to the end of the file);
//   - removes the stock `ref` / `at` marker definitions and imports them from apply.mjs instead (a project that
//     rewrote them keeps its own — they emit the same markers apply.mjs reads);
//   - removes the stock AUTH_HOST / FS_HOST / PROJECT constants, which only the applier read — unless something
//     left in the file still uses one, in which case it stays and is reported;
//   - refreshes the file's stock header comment, which described the machinery that just left.
// It then writes build.mjs + apply.mjs (the generator's own writer), so a bare `nx migrate` leaves a world.mjs
// that imports from a file which exists, and a build.mjs that uses it.
//
// WHAT IT REFUSES. A world.mjs whose applier was CUSTOMISED is left exactly as it is and reported: build.mjs now
// applies every world through apply.mjs, so that customisation no longer runs, and only its author can say which
// part of it still matters. A world.mjs with no applier at all (already split, or never the template's) is left
// alone silently.
import { type Tree, logger } from '@nx/devkit';
import { writeSeedTooling } from '../../generators/firebase-emulators/generator';
import { workspaceIdentity } from '../../generators/_utils/workspace-identity';

const TAG = '[0.50.0 split-seed-applier]';
const WORLD = 'tools/seed/world.mjs';
const APPLIER_BANNER = '// ── The applier (generic; never needs touching to add data)';

/** The 0.49 template's header — the part of it that described the applier — and its replacement. */
const STOCK_HEAD = `// The seed worlds — the single source of truth for what a "known good" emulator
// state contains. Run inside \`firebase emulators:exec\` (see tools/seed/build-seeds.sh),
// which sets the emulator host env vars and exports the resulting state to a seed dir.
//
// Zero dependencies on purpose: this talks to the emulators' REST APIs directly (Node's
// global fetch), so the workspace root needs no firebase-admin and this tool stays
// decoupled from the functions package. Accounts are created through the Auth emulator;
// Firestore docs are written with the emulator's \`Bearer owner\` admin bypass, so the
// app's real security rules are irrelevant to seeding.
//
`;
const NEW_HEAD = `// The seed worlds — the single source of truth for what a "known good" emulator
// state contains. YOURS: written once, never regenerated. The generic machinery that
// applies a world (encoder, REST calls, the emulator-host guard) is tools/seed/apply.mjs,
// which the house owns and keeps current; tools/seed/build-seeds.sh runs both inside
// \`firebase emulators:exec\` and exports the resulting state to a seed dir.
//
`;

const STOCK_MARKERS = `/** Marker: resolve to the uid of the account created under \`key\`. Use for ids or fields. */
export const ref = (key) => ({ __ref: key });
/** Marker: a Firestore timestamp from an ISO string (a bare string stays a string field). */
export const at = (iso) => ({ __ts: iso });
`;

/** The stock host constants, one per line — PROJECT's default carries the workspace name. */
const STOCK_HOSTS: ReadonlyArray<{ name: string; line: RegExp }> = [
  { name: 'AUTH_HOST', line: /^const AUTH_HOST = process\.env\.FIREBASE_AUTH_EMULATOR_HOST \|\| 'localhost:9099';\n/m },
  { name: 'FS_HOST', line: /^const FS_HOST = process\.env\.FIRESTORE_EMULATOR_HOST \|\| 'localhost:8080';\n/m },
  { name: 'PROJECT', line: /^const PROJECT = process\.env\.GCLOUD_PROJECT \|\| '(demo-[^']*)';\n/m },
];

/** The 0.49 template's applier section, verbatim — the only shape this migration will remove. */
const STOCK_APPLIER = `${APPLIER_BANNER} ────────────────────

/** Create an Auth-emulator account for an email and return its uid (localId). */
async function createAccount(email) {
  const res = await fetch(
    \`http://\${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo\`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // A password fully forms the account; passwordless/magic-link sign-in with the same
      // email still resolves to THIS account (email is the identity), inheriting its uid.
      body: JSON.stringify({ email, password: 'seed-password', returnSecureToken: true }),
    },
  );
  if (!res.ok) throw new Error(\`Auth signUp(\${email}) failed: \${res.status} \${await res.text()}\`);
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
  throw new Error(\`Cannot encode seed value of type \${typeof value}: \${String(value)}\`);
}

function requireUid(uids, key) {
  const uid = uids[key];
  if (!uid) throw new Error(\`Seed references unknown account "\${key}" — add it to the world's accounts.\`);
  return uid;
}

/** Write (create-or-overwrite) one Firestore doc, with already-encoded typed fields. */
async function writeDoc(path, fields) {
  const res = await fetch(
    \`http://\${FS_HOST}/v1/projects/\${PROJECT}/databases/(default)/documents/\${path}\`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ fields }),
    },
  );
  if (!res.ok) throw new Error(\`Firestore write(\${path}) failed: \${res.status} \${await res.text()}\`);
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
    await writeDoc(\`\${collection}/\${docId}\`, encoded);
  }
  const who = Object.values(world.accounts)
    .map((a) => \`\${a.email} (\${a.name})\`)
    .join(' · ');
  console.log(\`[seed] '\${name}' world ready — sign in as: \${who}\`);
}
`;

/** Compare as text, ignoring trailing whitespace on every line and at the end. */
const normalized = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trimEnd();

/** Is `name` used anywhere in `text` as an identifier (not merely inside a longer one)? */
const uses = (text: string, name: string) => new RegExp(`(^|[^A-Za-z0-9_$])${name}([^A-Za-z0-9_$]|$)`).test(text);

export default async function splitSeedApplier(tree: Tree): Promise<void> {
  if (!tree.exists(WORLD)) return;
  const original = tree.read(WORLD, 'utf8') ?? '';
  const crlf = original.includes('\r\n');
  let text = crlf ? original.replace(/\r\n/g, '\n') : original;

  const at = text.indexOf(APPLIER_BANNER);
  if (at < 0) {
    if (/export\s+(async\s+)?function\s+applyWorld\b|export\s+const\s+applyWorld\b/.test(text)) reportCustomised();
    return; // no applier here: already split, or never the template's
  }
  // The banner's own trailing rule may have been trimmed or widened; compare from the banner's line on.
  const applier = text.slice(at);
  const stockFromBanner = STOCK_APPLIER;
  const sameBody = normalized(applier.slice(applier.indexOf('\n'))) === normalized(stockFromBanner.slice(stockFromBanner.indexOf('\n')));
  if (!sameBody) {
    reportCustomised();
    return;
  }
  text = `${text.slice(0, at).trimEnd()}\n`;

  const imports: string[] = [];
  if (text.includes(STOCK_MARKERS)) {
    text = text.replace(`${STOCK_MARKERS}\n`, '').replace(STOCK_MARKERS, '');
    imports.push('ref', 'at');
  }

  // The host constants: each one goes unless something still in the file reads it. The import takes the
  // place of the first one removed, so it lands where the file's set-up already was.
  let projectDefault: string | undefined;
  let importAt = -1;
  const keptHosts: string[] = [];
  for (const { name, line } of STOCK_HOSTS) {
    const match = line.exec(text);
    if (!match) continue;
    if (name === 'PROJECT') projectDefault = match[1];
    const without = text.slice(0, match.index) + text.slice(match.index + match[0].length);
    if (uses(without, name)) {
      keptHosts.push(name);
      continue;
    }
    if (importAt < 0 || match.index < importAt) importAt = match.index;
    text = without;
  }

  if (text.startsWith(STOCK_HEAD)) {
    const shift = NEW_HEAD.length - STOCK_HEAD.length;
    text = NEW_HEAD + text.slice(STOCK_HEAD.length);
    if (importAt >= 0) importAt += shift;
  }

  if (imports.length) {
    const statement = `import { ${imports.join(', ')} } from './apply.mjs';\n`;
    if (importAt < 0) importAt = afterLeadingComments(text);
    text = text.slice(0, importAt) + statement + text.slice(importAt);
  }
  text = text.replace(/\n{3,}/g, '\n\n');

  tree.write(WORLD, crlf ? text.replace(/\n/g, '\r\n') : text);
  writeSeedTooling(tree, projectDefault?.replace(/^demo-/, '') ?? workspaceIdentity(tree));

  logger.info(
    `${TAG} ${WORLD}: moved the seed applier out to the generator-owned tools/seed/apply.mjs (regenerated on every ` +
      `upgrade; it now refuses to run without emulator hosts instead of guessing the base ports). world.mjs keeps your worlds` +
      (imports.length ? ` and imports ${imports.join(' / ')} from apply.mjs.` : '.'),
  );
  if (keptHosts.length) {
    logger.warn(
      `${TAG} ${WORLD}: kept ${keptHosts.join(', ')} — your worlds still read ${keptHosts.length > 1 ? 'them' : 'it'}, but the applier ` +
        `no longer does: apply.mjs takes its hosts from the emulator environment only. Remove ${keptHosts.length > 1 ? 'them' : 'it'} once nothing needs ${keptHosts.length > 1 ? 'them' : 'it'}.`,
    );
  }
}

/** The offset just past the file's leading comment block (and the blank lines after it). */
function afterLeadingComments(text: string): number {
  const lines = text.split('\n');
  let offset = 0;
  for (const line of lines) {
    if (!/^\s*(\/\/.*)?$/.test(line)) break;
    offset += line.length + 1;
  }
  return Math.min(offset, text.length);
}

function reportCustomised(): void {
  logger.warn(
    `${TAG} ${WORLD} carries its own, customised seed applier, so it was left exactly as it is. From 0.50.0, ` +
      `tools/seed/build.mjs applies every world through the generator-owned tools/seed/apply.mjs, so that customisation no ` +
      `longer runs. Compare it with apply.mjs, keep what your data still needs (a world can build any value apply.mjs encodes), ` +
      `then delete the applier section and the AUTH_HOST / FS_HOST / PROJECT constants, and \`import { ref, at } from './apply.mjs'\` ` +
      `if your worlds use them and the file does not define them.`,
  );
}
