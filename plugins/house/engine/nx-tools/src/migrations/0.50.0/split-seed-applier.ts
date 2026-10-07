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
// WHAT IT DOES, to a world.mjs whose applier is still the house's own — compared TOKEN BY TOKEN, so a file a
// formatter rewrote (quotes, semicolons, trailing commas, wrapping, comments) is still recognised; the code never
// changed between the template's first release and 0.49:
//   - removes the applier section (from its `── The applier` banner to the end of the file);
//   - removes the stock `ref` / `at` marker definitions and imports them from apply.mjs instead (a project that
//     rewrote them keeps its own — they emit the same markers apply.mjs reads);
//   - removes the stock AUTH_HOST / FS_HOST / PROJECT constants, which only the applier read — unless something
//     left in the file still uses one, in which case it stays and is reported;
//   - refreshes the file's stock header comment, which described the machinery that just left.
// It then writes build.mjs + apply.mjs (the generator's own writer), so a bare `nx migrate` leaves a world.mjs
// that imports from a file which exists, and a build.mjs that uses it.
//
// WHAT IT REFUSES. A world.mjs whose applier was CUSTOMISED (it seeds Storage, say) is left exactly as it is, and
// it KEEPS RUNNING: build.mjs applies a world through world.mjs's own `applyWorld` whenever world.mjs exports one —
// the seam for a project whose worlds need more than apply.mjs writes. The report is advice (what the house applier
// now guards that the project's does not), never a behaviour change. A world.mjs with no applier at all (already
// split, or never the template's) is left alone silently.
import { type Tree, logger } from '@nx/devkit';
import { writeSeedTooling } from '../../generators/firebase-emulators/generator';

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

/** The stock `ref` / `at` marker definitions, each with its doc line — whitespace, quotes and `;` free. */
const STOCK_MARKERS: ReadonlyArray<{ name: string; line: RegExp }> = [
  {
    name: 'ref',
    line: /^(?:\/\*\*[^\n]*\*\/[ \t]*\n)?export const ref\s*=\s*\(?\s*key\s*\)?\s*=>\s*\(\s*\{\s*__ref\s*:\s*key\s*,?\s*\}\s*\)\s*;?[ \t]*\n/m,
  },
  {
    name: 'at',
    line: /^(?:\/\*\*[^\n]*\*\/[ \t]*\n)?export const at\s*=\s*\(?\s*iso\s*\)?\s*=>\s*\(\s*\{\s*__ts\s*:\s*iso\s*,?\s*\}\s*\)\s*;?[ \t]*\n/m,
  },
];

/** The stock host constants, one per line (either quote, `;` optional). */
const STOCK_HOSTS: ReadonlyArray<{ name: string; line: RegExp }> = [
  { name: 'AUTH_HOST', line: /^const AUTH_HOST\s*=\s*process\.env\.FIREBASE_AUTH_EMULATOR_HOST\s*\|\|\s*['"]localhost:9099['"]\s*;?[ \t]*\n/m },
  { name: 'FS_HOST', line: /^const FS_HOST\s*=\s*process\.env\.FIRESTORE_EMULATOR_HOST\s*\|\|\s*['"]localhost:8080['"]\s*;?[ \t]*\n/m },
  { name: 'PROJECT', line: /^const PROJECT\s*=\s*process\.env\.GCLOUD_PROJECT\s*\|\|\s*['"]demo-[^'"]*['"]\s*;?[ \t]*\n/m },
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

/**
 * The code's TOKENS, in a form no formatter changes: comments and whitespace dropped, every string literal reduced to
 * its value (so either quote style is the same token), `;` dropped (semicolon style), a `,` before a closing bracket
 * dropped (trailing commas), and `(x) =>` read as `x =>` (arrow parens). Two texts with the same tokens are the same
 * program for this migration's purpose. Template literals are kept raw (formatters leave them alone).
 */
export function codeTokens(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      let value = '';
      while (j < n && text[j] !== c) {
        if (text[j] === '\\' && j + 1 < n) {
          value += text[j + 1] === c ? c : text.slice(j, j + 2);
          j += 2;
        } else value += text[j++];
      }
      out.push(`str:${value}`);
      i = j + 1;
    } else if (c === '`') {
      let j = i + 1;
      let depth = 0;
      while (j < n && !(text[j] === '`' && depth === 0)) {
        if (text[j] === '\\') j++;
        else if (text[j] === '$' && text[j + 1] === '{') {
          depth++;
          j++;
        } else if (text[j] === '}' && depth > 0) depth--;
        j++;
      }
      out.push(`tpl:${text.slice(i, j + 1)}`);
      i = j + 1;
    } else if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(text[j])) j++;
      out.push(text.slice(i, j));
      i = j;
    } else {
      const three = text.slice(i, i + 3);
      const two = text.slice(i, i + 2);
      const op = ['===', '!==', '...'].includes(three) ? three : ['=>', '||', '&&', '??', '==', '!=', '<=', '>=', '?.'].includes(two) ? two : c;
      out.push(op);
      i += op.length;
    }
  }
  const tokens: string[] = [];
  for (let k = 0; k < out.length; k++) {
    const t = out[k];
    if (t === ';') continue;
    if (t === ',' && [')', ']', '}'].includes(out[k + 1])) continue;
    // `( x ) =>` → `x =>`
    if (t === '(' && /^[A-Za-z_$][\w$]*$/.test(out[k + 1] ?? '') && out[k + 2] === ')' && out[k + 3] === '=>') {
      tokens.push(out[k + 1]);
      k += 2;
      continue;
    }
    tokens.push(t);
  }
  return tokens;
}

/** The same program, by its tokens. */
const sameCode = (a: string, b: string) => codeTokens(a).join('\u0000') === codeTokens(b).join('\u0000');

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
  if (!sameCode(applier.slice(applier.indexOf('\n')), STOCK_APPLIER.slice(STOCK_APPLIER.indexOf('\n')))) {
    reportCustomised();
    return;
  }
  text = `${text.slice(0, at).trimEnd()}\n`;

  // The stock markers go only as a pair (one import line replaces both); a project that rewrote either keeps its own
  // — they emit the same markers apply.mjs reads.
  const imports: string[] = [];
  const markers = STOCK_MARKERS.map(({ name, line }) => ({ name, match: line.exec(text) }));
  if (markers.every(({ match }) => match)) {
    for (const { line } of [...STOCK_MARKERS].reverse()) text = text.replace(line, '');
    imports.push(...markers.map(({ name }) => name));
  }

  // The host constants: each one goes unless something still in the file reads it. The import takes the
  // place of the first one removed, so it lands where the file's set-up already was.
  let importAt = -1;
  const keptHosts: string[] = [];
  for (const { name, line } of STOCK_HOSTS) {
    const match = line.exec(text);
    if (!match) continue;
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
  writeSeedTooling(tree);

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
    `${TAG} ${WORLD} carries its own, customised seed applier, so it was left exactly as it is — and it keeps running: ` +
      `tools/seed/build.mjs applies a world through world.mjs's own applyWorld whenever world.mjs exports one. The ` +
      `house's applier (tools/seed/apply.mjs, regenerated on every upgrade) now refuses to write without the emulator ` +
      `hosts AND project it is given (FIREBASE_AUTH_EMULATOR_HOST, FIRESTORE_EMULATOR_HOST, GCLOUD_PROJECT), where the old ` +
      `one fell back to localhost:9099 / :8080 — a bare run wrote into whichever stack owned the base ports. Compare yours ` +
      `with it; if apply.mjs covers what your worlds need, delete your applier section and the AUTH_HOST / FS_HOST / ` +
      `PROJECT constants (and \`import { ref, at } from './apply.mjs'\` if the file does not define them).`,
  );
}
