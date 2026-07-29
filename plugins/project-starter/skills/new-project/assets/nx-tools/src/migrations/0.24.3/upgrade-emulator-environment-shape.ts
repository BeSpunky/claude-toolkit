// Migration 0.24.3 — carry a pre-toggle environment bundle onto the PER-SERVICE emulator shape.
//
// THE SILENT FAILURE THIS PREVENTS. `firebase.config.ts` is generator-owned and rewritten IN FULL on every
// sync, and the current one asks each service whether it is emulated by reading a per-service flag:
//
//     auth: environment.emulators?.auth?.default ?? false
//
// The pre-toggle environment file has no such flag — its `emulators` block is bare endpoints
// (`auth: 'http://localhost:9099'`, `firestore: { host, port }`). Against that file every one of those reads
// falls through to `?? false`, so EVERY service silently resolves to the REAL Firebase backend while the app
// still holds `demo-*` credentials. Nothing fails at build time; the app just starts talking to production
// with credentials that cannot work, and the developer sees `auth/api-key-not-valid` with no clue why.
// Where the project also still has the pre-toggle `environment.interface.ts` (which typed `auth` as a bare
// `string`), it is not silent but a build break — `.default` on a `string` is TS2339.
//
// WHY IT HAS TO BE A MIGRATION. Every environment file is WRITE-IF-ABSENT in the firebase-emulators
// generator, and correctly so: they hold real per-project values (the app's web config, its custom emulator
// ports, app-specific top-level blocks). So the generator can never be the thing that upgrades them — it
// would have to overwrite a file it has no right to overwrite. A migration can do what a write-if-absent
// cannot: change the SHAPE in place while leaving every value where it is.
//
// WHAT IT PRESERVES, AND HOW. The edit is SURGICAL, not a re-render from the template: each service entry
// keeps its own source text — host, port, url, comments, and any key this migration has never heard of — and
// gains exactly one property. A project that moved Firestore to :8081 stays on :8081. The only place a whole
// block is replaced is `environment.interface.ts`'s `emulators` member, which is pure generated boilerplate
// with no per-project values in it — and even there an unrecognised member aborts the whole group rather than
// risk deleting something a project added.
//
// `default` IS PER FILE, and that is the one judgement call here. `environment.ts` is the DEV file, whose
// pre-toggle block meant "everything emulated" — so every service it declares becomes `default: true`, which
// is what the file already meant. Every OTHER environment file (`environment.prod.ts` and friends — the
// oldest scaffold shipped the same endpoint block there) meant the opposite: emulator wiring was gated on
// `!environment.production`, so nothing in it was ever emulated. Those become `default: false`, preserving
// behaviour exactly and keeping the file compiling against the upgraded interface.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not add `proxied: true` (the current template's default for auth
// and functions). Proxying routes the emulator through the dev-server's own origin and only works once
// `proxy.conf.mjs` is in place; turning it on here would change RUNTIME ROUTING on a project mid-upgrade,
// which is not a shape change. Direct dialling is what these projects already do, so direct dialling is what
// they keep — the upgraded interface types `proxied?` as optional, so opting in later is one word.
//
// ALL-OR-NOTHING PER BUNDLE. The value files and the interface are one type-checked unit: upgrading the
// values while leaving `auth: string` in the interface trades a silent failure for a build break. So every
// file in one `src/environments` directory is planned first and written only if EVERY plan succeeded;
// anything unreadable leaves the whole directory untouched and says exactly what a human must do.
//
// SELF-CONTAINED by the migration contract: no generator constant is imported, and the canonical shapes below
// are copies of the 0.24.3 templates, not reads of whatever the installed package's templates became.
import { type Tree, logger } from '@nx/devkit';
// The one sanctioned import — the same exception migration 0.24.2 documents. This is not generator BEHAVIOUR
// but a declared structural subset of the decade-stable classic TypeScript compiler API plus a feature probe;
// it cannot drift the way a generator can, and copying an AST type-declaration file into every migration that
// parses source would cost far more than it protects.
import {
  loadTypeScript,
  type ClassicTypeScript,
  type TsNamedNode,
  type TsNode,
  type TsObjectLiteralExpression,
  type TsPropertyAssignment,
  type TsSourceFile,
} from '../../generators/_utils/typescript-api';

/** The services the house emulator suite has ever had entries for. Anything else is a project's own. */
const SERVICES = ['auth', 'firestore', 'storage', 'functions'] as const;
type Service = (typeof SERVICES)[number];

/** The dev environment file — the ONE whose pre-toggle block meant "emulate everything". */
const DEV_ENV = 'environment.ts';
const INTERFACE = 'environment.interface.ts';

/** Directories a workspace walk must never descend into. Cost, not correctness — but a lot of cost. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.nx',
  '.angular',
  '.firebase',
  'dist',
  'tmp',
  'coverage',
]);

/** Depth bound for the walk: `apps/<app>/src/environments` is 4, and no house layout goes near this. */
const MAX_DEPTH = 12;

/** A single text splice. Collected per file, applied back-to-front so earlier edits can't shift later ones. */
interface Edit {
  start: number;
  end: number;
  text: string;
}

/** One planned file rewrite. `services` is only carried so the log can name what actually changed. */
interface FilePlan {
  path: string;
  content: string;
  services: string[];
}

export default function upgradeEmulatorEnvironmentShape(tree: Tree): void {
  // No root firebase.json, no Firebase layer — the pre-toggle emulator block cannot exist here. Checked
  // first so this migration is provably byte-neutral (and nearly free) on every non-Firebase workspace.
  if (!tree.exists('firebase.json')) return;

  const bundles = environmentBundles(tree);
  if (bundles.length === 0) return;

  // TypeScript is loaded only once a candidate exists, so a workspace with nothing to upgrade never sees the
  // "no usable compiler API" warning — it does not concern them.
  const suspects = bundles.filter((bundle) => bundle.envPaths.some((path) => looksPreToggle(read(tree, path))));
  const ts = suspects.length > 0 ? loadTypeScript() : null;
  if (suspects.length > 0 && !ts) {
    logger.warn(
      `[migrate 0.24.3] Skipped upgrading the pre-toggle emulator shape in ` +
        `${suspects.map((b) => b.dir).join(', ')}: this workspace has no usable TypeScript compiler API (the ` +
        `classic \`createSourceFile\` entry point is missing), and these files are too valuable to edit with a ` +
        `regex. Add a per-service \`default:\` to each entry of the \`emulators\` block BY HAND — without it ` +
        `firebase.config.ts resolves every service to the REAL backend while the app holds demo credentials.`,
    );
    return;
  }

  for (const bundle of bundles) upgradeBundle(tree, ts, bundle);
}

/** One `src/environments` directory: the value files, and the shared shape beside them. */
interface Bundle {
  dir: string;
  envPaths: string[];
  interfacePath: string | null;
}

/**
 * Every `src/environments` directory in the workspace, found by WALKING THE TREE rather than by asking for
 * the project graph.
 *
 * That is deliberate. `getProjects` throws outright on a single unparseable project.json, which would take
 * this migration — and every migration after it in the same ordered pass — down with it, over a file this one
 * never reads. What this migration operates on is environment SOURCE FILES; the project graph was only ever
 * a way to guess where they live, and guessing badly is not worth the shared failure mode.
 */
function environmentBundles(tree: Tree): Bundle[] {
  const dirs = new Set<string>();

  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let children: string[];
    try {
      children = tree.children(dir);
    } catch {
      return; // An unreadable directory is skipped, never fatal.
    }
    for (const child of children) {
      if (SKIP_DIRS.has(child)) continue;
      const path = dir === '.' ? child : `${dir}/${child}`;
      if (tree.isFile(path)) {
        if (/(^|\/)src\/environments\/environment[^/]*\.ts$/.test(path)) {
          dirs.add(path.slice(0, path.lastIndexOf('/')));
        }
      } else {
        walk(path, depth + 1);
      }
    }
  };
  walk('.', 0);

  return [...dirs].map((dir) => {
    const files = tree.children(dir).filter((name) => /^environment.*\.ts$/.test(name));
    return {
      dir,
      envPaths: files.filter((name) => name !== INTERFACE).map((name) => `${dir}/${name}`),
      interfacePath: files.includes(INTERFACE) ? `${dir}/${INTERFACE}` : null,
    };
  });
}

/**
 * Plan every file in one bundle, then write — or write nothing at all.
 *
 * The value files and the interface type each other: an `environment.ts` carrying `default: true` against an
 * interface that still says `auth: string` does not compile, and neither does the reverse. Half an upgrade is
 * strictly worse than none, so a single unreadable file aborts the directory.
 */
function upgradeBundle(tree: Tree, ts: ClassicTypeScript | null, bundle: Bundle): void {
  const plans: FilePlan[] = [];

  for (const path of bundle.envPaths) {
    const source = read(tree, path);
    if (!looksPreToggle(source)) continue;
    // The dev file's bare block meant "emulate everything"; every other environment file's meant the
    // opposite (emulator wiring was gated on `!environment.production`). Preserve what each one MEANT.
    const emulatedByDefault = path.endsWith(`/${DEV_ENV}`);
    // `ts` is non-null whenever a suspect exists — the caller returns otherwise — but the plan is guarded
    // rather than asserted, because a null here must abort the bundle, not throw mid-workspace.
    const plan = ts ? planValueFile(ts, path, source, emulatedByDefault) : null;
    // `undefined` is the ONLY skip, and planValueFile only returns it when it could read the file and there
    // was provably nothing to do. Everything it could not read comes back as `null` and takes the directory
    // with it — half an upgrade (values behind, interface ahead) does not compile.
    if (plan === undefined) continue;
    if (plan === null) return; // Unreadable — planValueFile has said why. Leave the whole directory alone.
    plans.push(plan);
  }

  if (bundle.interfacePath) {
    const plan = planInterfaceFile(read(tree, bundle.interfacePath), bundle.interfacePath);
    if (plan === null) return;
    if (plan) plans.push(plan);
  } else if (plans.length > 0) {
    // No shared shape file to upgrade alongside the values. The values still had to be fixed (that is the
    // silent-failure half), but whatever types them is this project's own and we cannot reach it.
    logger.warn(
      `[migrate 0.24.3] ${bundle.dir} has no ${INTERFACE}, so only the environment VALUES were upgraded. If ` +
        `this project types its environment elsewhere, add \`default: boolean\` to each emulator service ` +
        `there too (and \`url\` instead of a bare string for auth), or it will not compile.`,
    );
  }

  for (const plan of plans) {
    tree.write(plan.path, plan.content);
    logger.info(
      plan.services.length > 0
        ? `[migrate 0.24.3] ${plan.path}: upgraded ${plan.services.join(', ')} to the per-service emulator ` +
            `toggle (each entry now carries \`default\`, which firebase.config.ts reads). Hosts, ports and ` +
            `URLs were carried over unchanged.`
        : `[migrate 0.24.3] ${plan.path}: upgraded the \`emulators\` shape to the per-service toggle.`,
    );
  }
}

/**
 * Pre-filter: does this file still have an emulator SERVICE without a `default` flag?
 *
 * PER-SERVICE, and comment-aware, because the whole-file substring test this replaces
 * (`/emulators:/ && !/default:/`) had the failure mode of a gate that can only fail closed. Any `default:`
 * ANYWHERE in the file declared the whole thing current — a comment such as
 * `// NOTE: firestore default: (default) database`, or a user who had hand-fixed ONE service exactly as this
 * migration's own warning tells them to. The file was then skipped, every service resolved to the REAL
 * Firebase backend behind demo credentials, and the skip was silent. Worse, the `default:` this migration
 * once spliced into a trailing comment (see `appendProperty`) made the file permanently un-upgradeable by
 * this very test.
 *
 * Still text, not AST — this runs before TypeScript is loaded and its only job is to decide whether loading
 * it is warranted. But it reads the emulator block's own members on a comment- and string-masked copy, so it
 * cannot be fooled by prose, and the authoritative per-service answer still comes from `planValueFile`.
 */
function looksPreToggle(source: string): boolean {
  const members = emulatorMembers(mask(source, true));
  if (!members) return false;
  return members.some((member) => SERVICES.includes(member.name as Service) && !declaresDefault(member.value));
}

/** Does this member's own body carry a `default` flag? Its text is already comment- and string-masked. */
function declaresDefault(value: string): boolean {
  return /\bdefault\s*:/.test(value);
}

/**
 * The top-level members of the `emulators` block, or `null` when the file has no such block.
 *
 * Input must be MASKED (comments and strings blanked to spaces): the brace matching and the member split
 * both depend on every `{`, `}`, `,` and `;` in the text being real syntax.
 */
function emulatorMembers(masked: string): Array<{ name: string; value: string }> | null {
  const member = /(^|[\s;,{])emulators\s*\??\s*:\s*\{/.exec(masked);
  if (!member) return null;

  const open = member.index + member[0].length - 1;
  const close = matchBrace(masked, open);
  if (close < 0) return null;
  return topLevelMembers(masked.slice(open + 1, close));
}

/**
 * `name: value` pairs at the TOP level of a (masked) object-literal or type-literal body.
 *
 * Splits on `,` AND `;` at depth zero, so one function reads both an environment value object and an
 * interface's type literal — the two places this migration has to tell "already per-service" from "not yet".
 */
function topLevelMembers(body: string): Array<{ name: string; value: string }> {
  const members: Array<{ name: string; value: string }> = [];
  let depth = 0;
  let start = 0;

  const push = (piece: string): void => {
    const match = /^\s*([A-Za-z_$][\w$]*)\s*\??\s*:\s*([\s\S]*)$/.exec(piece);
    if (match) members.push({ name: match[1], value: match[2] });
  };

  for (let i = 0; i <= body.length; i++) {
    const character = body[i];
    if (i === body.length || ((character === ',' || character === ';') && depth === 0)) {
      push(body.slice(start, i));
      start = i + 1;
      continue;
    }
    if (character === '{' || character === '[' || character === '(') depth++;
    else if (character === '}' || character === ']' || character === ')') depth--;
  }
  return members;
}

/**
 * Plan the edits for one environment VALUE file.
 *
 * THREE ANSWERS, and the line between the last two is what makes the all-or-nothing rule real:
 *   - a PLAN — the file is the legacy shape and here is how to fix it;
 *   - `undefined` — CONFIDENTLY nothing to do. Reserved for the one case we can prove: a readable
 *     `environment` object that simply has no `emulators` block (the text pre-filter is loose on purpose),
 *     or one whose every service already carries the flag;
 *   - `null` — it IS legacy and cannot be edited safely, INCLUDING "there is no `environment` object I can
 *     read". That last case used to answer `undefined`, i.e. "nothing to do here" — and the interface beside
 *     it was upgraded anyway, which is the half-upgraded bundle this file's header promises never to write.
 *     The reason is reported before returning, and the caller must leave the whole bundle alone.
 *
 * SURGICAL BY DESIGN. Every service entry keeps its own source text and gains one property, so custom ports,
 * inline comments and any key this migration never heard of survive untouched. Only the historic
 * `auth: '<url>'` string form is restructured, because it has no other way to carry a flag.
 */
function planValueFile(
  ts: ClassicTypeScript,
  path: string,
  source: string,
  emulatedByDefault: boolean,
): FilePlan | null | undefined {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const environment = findVariableObject(ts, sf, 'environment');
  if (!environment) {
    // THE FILE IS THE LEGACY SHAPE AND WE CANNOT READ IT. The pre-filter found an emulator service with no
    // `default`, so there IS work here — we just cannot see where. `const base = { … }; export const
    // environment: Environment = base;` is enough to land here.
    //
    // This used to return `undefined`, which the caller skips — and skipping is precisely the half-upgrade
    // the all-or-nothing rule at the top of this file forbids: the values stayed pre-toggle while
    // `environment.interface.ts` was still rewritten to require `default: boolean`, so the project stopped
    // compiling (TS2741) on the strength of a migration that reported success. Abort the directory instead.
    logger.warn(
      `[migrate 0.24.3] ${path}: has an emulator entry with no \`default\` flag, but no \`const environment ` +
        `= { … }\` object this migration can read (an indirection, a spread, a re-export). Nothing in ` +
        `${path.slice(0, path.lastIndexOf('/'))} was changed — add \`default: <boolean>\` to each entry of ` +
        `the \`emulators\` block by hand (and \`default: boolean\` to ${INTERFACE} beside it).`,
    );
    return null;
  }

  const emulators = findProperty(ts, environment, 'emulators');
  if (!emulators) return undefined; // A file with no emulator block is already in a valid current shape.
  if (!ts.isObjectLiteralExpression(emulators.initializer)) {
    logger.warn(
      `[migrate 0.24.3] ${path}: \`environment.emulators\` is not an object literal, so the per-service ` +
        `\`default\` flags could not be added. Add them by hand — firebase.config.ts reads ` +
        `\`emulators?.<service>?.default\` and treats a missing flag as "use the REAL backend".`,
    );
    return null;
  }

  const edits: Edit[] = [];
  const upgraded: string[] = [];
  const flag = `default: ${emulatedByDefault}`;

  for (const service of SERVICES) {
    const entry = findProperty(ts, emulators.initializer, service);
    if (!entry) continue; // Absent means "this project never emulated it" — inventing an entry would change
    // behaviour, so an absent service stays absent.

    if (ts.isObjectLiteralExpression(entry.initializer)) {
      if (findProperty(ts, entry.initializer, 'default')) continue; // Already current — idempotency.
      const edit = appendProperty(source, entry.initializer, flag);
      if (!edit) {
        logger.warn(
          `[migrate 0.24.3] ${path}: could not add \`${flag}\` to the \`${service}\` emulator entry (its ` +
            `source does not end where the parser says it does). The whole ${path.slice(0, path.lastIndexOf('/'))} ` +
            `directory was left untouched — add the per-service \`default\` flags by hand.`,
        );
        return null;
      }
      edits.push(edit);
      upgraded.push(service);
      continue;
    }

    if (ts.isStringLiteral(entry.initializer)) {
      // The oldest shape: `auth: 'http://localhost:9099'`. The current one is an object, because the flag has
      // to live somewhere — so the URL becomes `url` and keeps its exact literal, quotes and all.
      const span = literalSpan(source, entry.initializer);
      if (!span) {
        logger.warn(
          `[migrate 0.24.3] ${path}: the \`${service}\` emulator entry is a string this migration could not ` +
            `re-read from the source, so nothing in ${path.slice(0, path.lastIndexOf('/'))} was changed. ` +
            `Rewrite it as \`{ url: <the url>, ${flag} }\` by hand.`,
        );
        return null;
      }
      edits.push({
        start: entry.name.getEnd(),
        end: entry.initializer.getEnd(),
        text: `: { url: ${source.slice(span.start, span.end)}, ${flag} }`,
      });
      upgraded.push(service);
      continue;
    }

    // An identifier, a call, a spread — something this migration has no business rewriting.
    logger.warn(
      `[migrate 0.24.3] ${path}: the \`${service}\` emulator entry is not a literal, so it was not upgraded ` +
        `and nothing in ${path.slice(0, path.lastIndexOf('/'))} was changed. It needs a \`default: boolean\` ` +
        `(firebase.config.ts reads \`emulators?.${service}?.default\` and a missing flag means "REAL backend").`,
    );
    return null;
  }

  if (edits.length === 0) return undefined;
  return { path, content: applyEdits(source, edits), services: upgraded };
}

/**
 * Plan the replacement of `environment.interface.ts`'s `emulators` member.
 *
 * Returns the plan, `undefined` when the member is already current (or absent), or `null` when it carries
 * something this migration did not write — the one case where replacing the block could DELETE a project's
 * own declaration, so it refuses and reports instead.
 *
 * This is the only whole-block replacement here, and it is safe for the reason the value files are not: the
 * member is pure generated boilerplate. It is located by a comment- and string-aware scan rather than the
 * AST, because the declared compiler subset covers expressions, not type members — and widening that subset
 * would mean editing a file this migration is not allowed to own.
 */
function planInterfaceFile(source: string, path: string): FilePlan | null | undefined {
  const masked = mask(source, true);
  const member = /(^|[\s;,{])emulators\s*\??\s*:\s*\{/.exec(masked);
  if (!member) return undefined;

  const nameStart = member.index + member[1].length;
  const open = member.index + member[0].length - 1;
  const close = matchBrace(masked, open);
  if (close < 0) return undefined; // Unbalanced — not something to splice blind.

  const body = masked.slice(open + 1, close);
  // ALREADY THE PER-SERVICE SHAPE — the idempotency check, and PER MEMBER for the same reason the value
  // files' pre-filter is: "the word `default:` appears somewhere in this block" also answers yes to an
  // interface where a human upgraded ONE service by hand, leaving the other three typed as bare endpoints
  // while their values gain the flag. Every declared member must carry it, or the block is not current.
  const members = topLevelMembers(body);
  if (members.length > 0 && members.every((entry) => declaresDefault(entry.value))) return undefined;

  const unknown = topLevelKeys(body).filter((key) => !SERVICES.includes(key as Service));
  if (unknown.length > 0) {
    logger.warn(
      `[migrate 0.24.3] ${path}: the \`emulators\` type declares ${unknown.join(', ')}, which this migration ` +
        `did not write — replacing the block could delete it, so ${path.slice(0, path.lastIndexOf('/'))} was ` +
        `left untouched. Update the block by hand: each service becomes ` +
        `\`{ …endpoint…; default: boolean }\` and \`auth\` becomes \`{ url: string; default: boolean }\`.`,
    );
    return null;
  }

  const indent = indentOf(source, nameStart);
  return {
    path,
    content: source.slice(0, nameStart) + interfaceMemberText(indent) + source.slice(close + 1),
    services: [],
  };
}

/**
 * The current shared shape for `emulators`, rendered at the file's own indentation.
 *
 * A COPY of the 0.24.3 `environment.interface.ts.tpl` block, not a read of it — per the self-containment
 * rule, a project jumping several versions must land on the shape this migration was written against rather
 * than whatever the newest installed template says. `proxied` is declared but never written into a value
 * file: opting in is a routing decision, and the type is what makes it a one-word change.
 */
function interfaceMemberText(indent: string): string {
  const inner = `${indent}  `;
  return [
    `emulators?: {`,
    `${inner}// PER-SERVICE, and the whole block is optional (a production env file omits it → every service`,
    `${inner}// talks to the real backend). Each service carries its local endpoint AND its committed`,
    `${inner}// \`default\` — whether it is emulated out of the box. firebase.config.ts resolves`,
    `${inner}// \`default ⊕ runtime-override\` (see src/app/emulator-overrides.ts) and connects a service to`,
    `${inner}// its emulator only when the result is ON, and only in dev. A service that resolves OFF (or has`,
    `${inner}// no entry here) uses the real project in \`firebase\`.`,
    `${inner}// \`proxied\` (auth + functions): reach the emulator through the dev-server's OWN origin`,
    `${inner}// (proxy.conf.mjs relays it, offset-shifted) instead of dialing host:port directly.`,
    `${inner}auth?: { url: string; default: boolean; proxied?: boolean };`,
    `${inner}firestore?: { host: string; port: number; default: boolean };`,
    `${inner}storage?: { host: string; port: number; default: boolean };`,
    `${inner}functions?: { host: string; port: number; default: boolean; proxied?: boolean };`,
    `${indent}}`,
  ].join('\n');
}

/**
 * An edit that appends one property to an object literal, placed after its last real member.
 *
 * Returns null when the source does not actually end in `}` where the parser says the node does — the same
 * "verify before splicing" rule the rest of this file follows. The existing trailing comma (or its absence)
 * decides where the new text goes, so both `{ a: 1 }` and a multi-line block with a dangling comma come out
 * as valid source.
 *
 * THE BACKWARD SCAN RUNS OVER A COMMENT-MASKED COPY, and that is not a nicety. Scanning back over whitespace
 * alone, an entry that ends in a comment —
 *
 *     firestore: { host: 'localhost', port: 8080 // moved off 8080 in staging
 *     },
 *
 * — put the new `default: true` INSIDE that comment: syntactically absent, so every service still resolved
 * to the real backend, while the migration reported success and the interface beside it was upgraded to
 * require the flag. And because the pre-filter then saw the word `default:` in the comment text, a re-run
 * was a permanent no-op. Masking is COMMENT-ONLY: blanking string literals too would make the scan walk back
 * over `url: 'http://localhost:9099'` and land after the colon.
 */
function appendProperty(source: string, object: TsObjectLiteralExpression, property: string): Edit | null {
  const end = object.getEnd();
  if (source[end - 1] !== '}') return null;

  const masked = mask(source, false);
  let last = end - 2;
  while (last >= 0 && /\s/.test(masked[last])) last--;
  if (last < 0) return null;

  if (masked[last] === '{') return { start: last + 1, end: last + 1, text: ` ${property} ` }; // Empty literal.
  // Insert straight after the last real character — before any trailing comment, and before whatever
  // whitespace or newline preceded the closing brace. A block that already ends in a comma keeps that
  // style; one that doesn't gains one.
  const text = masked[last] === ',' ? ` ${property},` : `, ${property}`;
  return { start: last + 1, end: last + 1, text };
}

/** Apply splices back-to-front, so no edit invalidates the offsets of another. */
function applyEdits(source: string, edits: Edit[]): string {
  return edits
    .slice()
    .sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
}

/** The object literal initialising `const <name> = { … }`, anywhere in the file. */
function findVariableObject(
  ts: ClassicTypeScript,
  root: TsSourceFile,
  name: string,
): TsObjectLiteralExpression | null {
  // Held on an object rather than in a `let`: TypeScript's control-flow analysis does not track assignments
  // made inside a callback, so a `let` would be narrowed to `null` for every use after the walk.
  const found: { node: TsObjectLiteralExpression | null } = { node: null };
  const visit = (node: TsNode): void => {
    if (found.node) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      found.node = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found.node;
}

/** The `<name>: …` property assignment of an object literal — the NODE, because callers splice by offset. */
function findProperty(
  ts: ClassicTypeScript,
  object: TsObjectLiteralExpression,
  name: string,
): TsPropertyAssignment | null {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name) {
      return property;
    }
  }
  return null;
}

/**
 * The exact source span of a string literal, quotes included — or null when the source does not match what
 * the parsed node claims.
 *
 * The declared compiler subset exposes `getEnd()` and nothing else positional, so the start is computed as
 * `end - (text.length + 2)`. That arithmetic only holds for a literal with no escape sequences, which is why
 * a null here means "leave this file alone": an emulator URL is a plain literal, and anything else is a file
 * this migration should not be splicing.
 */
function literalSpan(source: string, literal: TsNamedNode): { start: number; end: number } | null {
  const end = literal.getEnd();
  const start = end - (literal.text.length + 2);
  if (start < 0 || end > source.length) return null;
  const quote = source[start];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  if (source[end - 1] !== quote) return null;
  if (source.slice(start + 1, end - 1) !== literal.text) return null;
  return { start, end };
}

/**
 * The source with every comment — and, when `blankStrings`, every string LITERAL — blanked to spaces,
 * character-for-character.
 *
 * Length is preserved so every offset found in the masked text addresses the same character in the original.
 * This is what makes the brace matching below trustworthy: a `{` inside a comment or a string is exactly the
 * thing that would otherwise make a naive scan cut a type declaration in half.
 *
 * The two modes exist because the two callers need opposite things from a string literal. Brace matching and
 * member splitting must not see `{` inside `'…'`, so they blank strings. `appendProperty` scans BACKWARD for
 * the last real character and must land after `url: 'http://localhost:9099'`, not inside it — so it keeps
 * strings and only loses the comments. Either way the walk must understand strings, because the `//` in that
 * URL is not a comment.
 */
function mask(source: string, blankStrings: boolean): string {
  const out = source.split('');
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== '\n') out[i] = ' ';
  };

  for (let i = 0; i < source.length; i++) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const end = source.indexOf('\n', i);
      const stop = end < 0 ? source.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    const quote = source[i];
    if (quote === "'" || quote === '"' || quote === '`') {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '\\') j += 2;
        else if (source[j] === quote) break;
        else j++;
      }
      if (blankStrings) blank(i, Math.min(j + 1, source.length));
      i = j;
    }
  }
  return out.join('');
}

/** The index of the `}` closing the `{` at `open`, or -1 when the braces do not balance. */
function matchBrace(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/**
 * The property names declared at the TOP level of a (masked) type-literal body.
 *
 * Nested braces are collapsed away first, innermost-first, so only the outer members remain to be matched.
 * Crude on purpose: its only job is to notice a member this migration did not write, and a false positive
 * costs a skipped file with an explanation while a false negative would cost a deleted declaration.
 */
function topLevelKeys(body: string): string[] {
  let flat = body;
  for (let previous = ''; flat !== previous; ) {
    previous = flat;
    flat = flat.replace(/\{[^{}]*\}/g, ' ');
  }
  return [...flat.matchAll(/([A-Za-z_$][\w$]*)\s*\??\s*:/g)].map((match) => match[1]);
}

/** The indentation of the line `index` sits on — or two spaces when `index` is not the line's first token. */
function indentOf(source: string, index: number): string {
  const lineStart = source.lastIndexOf('\n', index) + 1;
  const before = source.slice(lineStart, index);
  return /^[ \t]*$/.test(before) ? before : '  ';
}

/** File text, or an empty string for a file that vanished between the walk and the read. */
function read(tree: Tree, path: string): string {
  return tree.read(path, 'utf8') ?? '';
}
