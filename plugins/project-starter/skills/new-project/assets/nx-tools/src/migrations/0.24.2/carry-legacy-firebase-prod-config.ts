// Migration: rescue the REAL production Firebase credentials a pre-environment-files project still keeps
// inline in `apps/<app>/src/app/firebase.config.ts`, before anything overwrites that file.
//
// THE FAILURE THIS PREVENTS. The legacy shape carried a `productionFirebaseConfig` const with the live
// projectId / apiKey / appId / authDomain written straight into `firebase.config.ts`. The current shape keeps
// them in `environment.prod.ts`, and `firebase.config.ts` became GENERATOR-OWNED — rewritten IN FULL on every
// `--sync --firebase` run, because it holds no per-project values ANY MORE. The word "anymore" is the whole
// problem: on a project that never crossed over, that rewrite deletes the only copy of the production
// credentials in the repo. The firebase-emulators generator does carry them across, but only on the path
// where `environment.prod.ts` is ABSENT — a project whose sync once got as far as writing an empty-placeholder
// `environment.prod.ts` and then failed (or was interrupted) before the values were filled in has already
// lost that path, and the next run silently drops the credentials. Doing the rescue here, ahead of the
// generators, closes that window regardless of which half-way state a project is sitting in.
//
// SCOPE. This migration ONLY moves values that already exist. It never creates an environment bundle, never
// touches a workspace without Firebase, and deliberately does NOT rewrite `firebase.config.ts` — that file
// belongs to the generator, which rewrites it itself immediately afterwards. Rescuing the values is the whole
// job; the demolition is somebody else's and is correct once the values are safe.
import { type Tree, getProjects, logger } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// EXCEPTION to the "migrations import nothing from generators/" rule, and a deliberate one. This module is
// not generator BEHAVIOUR — it is a declared structural subset of the classic TypeScript compiler API plus a
// feature-probing loader, i.e. a description of a decade-stable third-party contract that cannot drift the way
// a generator can. Copying an AST walk's type declarations into every migration that parses source would cost
// more than it protects. What this migration does NOT reuse is the generator's extraction logic: that is
// copied below, because it is behaviour and a project jumping several versions must get the 0.24.2 behaviour.
import {
  loadTypeScript,
  type ClassicTypeScript,
  type TsNamedNode,
  type TsNode,
  type TsObjectLiteralExpression,
  type TsSourceFile,
} from '../../generators/_utils/typescript-api';

/**
 * The four fields the legacy const carried and the current `environment.prod.ts` expects. Fixed, not derived:
 * a legacy file may hold extra keys (messagingSenderId, vapidKey) that the current prod template has no slot
 * for, and inventing slots for them would be this migration creating shape rather than moving values.
 */
const FIELDS = ['projectId', 'apiKey', 'appId', 'authDomain'] as const;
type Field = (typeof FIELDS)[number];
type ProdConfig = Record<Field, string>;

const EMPTY: ProdConfig = { projectId: '', apiKey: '', appId: '', authDomain: '' };

export default function carryLegacyFirebaseProdConfig(tree: Tree): void {
  // A workspace with no root firebase.json never had the Firebase layer, so there is no legacy config to
  // rescue and nothing here may touch it. Checked FIRST so the common case costs one `exists` call and this
  // migration is provably byte-neutral on every non-Firebase project.
  if (!tree.exists('firebase.json')) return;

  // Candidates are gathered BEFORE TypeScript is loaded so the "no usable TypeScript" warning is only ever
  // printed to someone it actually concerns. A project with no legacy file should see no output at all.
  const candidates: { name: string; configPath: string; envProdPath: string }[] = [];
  for (const [name, root] of projectRoots(tree)) {
    const configPath = `${root}/src/app/firebase.config.ts`;
    if (!tree.exists(configPath)) continue;
    // Narrow detection: the const's NAME is the legacy shape's signature. A current-shape file does not
    // mention it, so this is a text pre-filter that costs nothing and keeps the AST parse off every project.
    if (!(tree.read(configPath, 'utf8') ?? '').includes('productionFirebaseConfig')) continue;
    candidates.push({ name, configPath, envProdPath: `${root}/src/environments/environment.prod.ts` });
  }
  if (candidates.length === 0) return;

  // No usable compiler API (a workspace whose `typescript` resolves to the 7.x native port, whose main entry
  // no longer exposes `createSourceFile`) means we cannot read the values without regexing source code, and a
  // regex that mis-reads a credential is worse than not trying. Leave every project completely untouched and
  // say exactly what was skipped and why, so the values can be moved by hand before the generator runs.
  const ts = loadTypeScript();
  if (!ts) {
    logger.warn(
      `[migrate 0.24.2] Skipped carrying the legacy \`productionFirebaseConfig\` in ` +
        `${candidates.map((c) => c.configPath).join(', ')}: this workspace has no usable TypeScript compiler ` +
        `API (the classic \`createSourceFile\` entry point is missing), and these values are too important to ` +
        `parse with a regex. Copy projectId/apiKey/appId/authDomain into the matching ` +
        `src/environments/environment.prod.ts BY HAND before running \`--sync --firebase\`, which rewrites ` +
        `firebase.config.ts and would drop them.`,
    );
    return;
  }

  for (const { name, configPath, envProdPath } of candidates) {
    const legacy = extractLegacyProdConfig(ts, tree.read(configPath, 'utf8') ?? '');
    // All-empty is the legacy shape with unfilled placeholders — there is nothing to rescue, and writing an
    // environment.prod.ts full of empty strings would only pre-empt the generator's own write-if-absent.
    if (!FIELDS.some((f) => legacy[f])) continue;

    const carried = tree.exists(envProdPath)
      ? fillEmptyFirebaseFields(ts, tree, envProdPath, legacy)
      : writeProdEnvFromTemplate(tree, envProdPath, legacy);

    // Field NAMES only, never values: a migration log is pasted into issues and CI transcripts, and an apiKey
    // is a credential even when it is a public one.
    if (carried.length > 0) {
      logger.info(
        `[migrate 0.24.2] ${name}: carried ${carried.join(', ')} from the legacy productionFirebaseConfig in ` +
          `${configPath} into ${envProdPath}. Verify before committing — firebase.config.ts is generator-owned ` +
          `now and is rewritten on every sync.`,
      );
    }
  }
}

/**
 * Every project root in the workspace, as `[name, root]`.
 *
 * `getProjects` throws on the FIRST project file it cannot parse, and Nx runs the whole migration set in ONE
 * ordered pass — so that throw would not merely skip this migration, it would stop every LATER one too, over
 * a file this migration never reads. When the graph refuses, fall back to looking for the file this migration
 * is actually about (`<root>/src/app/firebase.config.ts`), which needs no graph at all.
 */
function projectRoots(tree: Tree): Array<[string, string]> {
  try {
    return [...getProjects(tree)].map(([name, project]) => [name, project.root]);
  } catch (error) {
    logger.warn(
      `[migrate 0.24.2] Nx could not read this workspace's projects ` +
        `(${error instanceof Error ? error.message : String(error)}) — normally one project file that does not ` +
        `parse. Falling back to a direct scan for \`src/app/firebase.config.ts\`, which finds the legacy ` +
        `configs regardless. Fix the reported file and re-run \`nx migrate\` for a complete sweep.`,
    );
    return scanForFirebaseConfigs(tree).map((root) => [root, root]);
  }
}

/** Directories the fallback scan never descends into. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.nx', '.angular', '.firebase', 'dist', 'tmp', 'coverage']);

/** Depth bound for the fallback scan: `apps/<app>/src/app/firebase.config.ts` is 5. */
const MAX_DEPTH = 12;

/** Every directory `<root>` for which `<root>/src/app/firebase.config.ts` exists. */
function scanForFirebaseConfigs(tree: Tree): string[] {
  const roots: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let children: string[];
    try {
      children = tree.children(dir);
    } catch {
      return;
    }
    for (const child of children) {
      if (SKIP_DIRS.has(child)) continue;
      const path = dir === '.' ? child : `${dir}/${child}`;
      if (tree.isFile(path)) {
        if (path.endsWith('/src/app/firebase.config.ts')) roots.push(path.slice(0, -'/src/app/firebase.config.ts'.length));
      } else {
        walk(path, depth + 1);
      }
    }
  };
  walk('.', 0);
  return roots;
}

/**
 * Render the current `environment.prod.ts` from the generator's OWN template, filled with the rescued values.
 *
 * Reading the .tpl rather than embedding a copy of it is right here even though it means this migration emits
 * whatever the newest template says — because the alternative is worse in exactly the way that matters. The
 * generator writes this file WRITE-IF-ABSENT, so once this migration has written it the generator will never
 * touch it again; an embedded 0.24.2 copy would therefore freeze the project on a stale prod-environment shape
 * forever. Emitting the current template makes this migration's output identical to what the generator would
 * have produced on the path where it does carry the values across, which is the whole point.
 */
function writeProdEnvFromTemplate(tree: Tree, envProdPath: string, config: ProdConfig): Field[] {
  const tplPath = join(__dirname, '..', '..', 'generators', 'firebase-emulators', 'environment.prod.ts.tpl');
  let tpl: string;
  try {
    tpl = readFileSync(tplPath, 'utf8');
  } catch {
    // The template is missing from the installed package — the firebase-emulators generator is equally broken
    // in that state, so there is no useful fallback. Refuse loudly rather than hand-writing an approximation
    // of a file whose shape this migration is not the author of.
    logger.warn(
      `[migrate 0.24.2] Could not read ${tplPath}, so ${envProdPath} was not created. The legacy values are ` +
        `still in firebase.config.ts — copy them out BEFORE running \`--sync --firebase\`.`,
    );
    return [];
  }

  // The template's placeholders sit inside single-quoted string literals, so a value is escaped for that
  // context — the same contract the generator's own `.split('{{x}}').join(value)` substitution assumes.
  const rendered = FIELDS.reduce(
    (text, field) => text.split(`{{${field}}}`).join(escapeForQuote(config[field], "'")),
    tpl,
  );
  tree.write(envProdPath, rendered);
  return FIELDS.filter((f) => config[f]);
}

/**
 * Fill ONLY the empty `firebase` fields of an existing `environment.prod.ts`, in place.
 *
 * Two rules meet here. IDEMPOTENCY: a field that already holds a real value is left alone, so a re-run — and
 * the runner guarantees re-runs, because the HOUSE.md stamp only moves at the END of a sync — changes nothing.
 * NOT DESTROYING USER VALUES: the file is spliced rather than re-rendered from the template, because a project
 * legitimately extends its environment (an app-specific `google: { oauthClientId }` block, a completed
 * `firebase` block with messagingSenderId) and a wholesale rewrite would silently delete all of it.
 *
 * Returns the fields actually written, so the caller only reports a real change.
 */
function fillEmptyFirebaseFields(
  ts: ClassicTypeScript,
  tree: Tree,
  envProdPath: string,
  config: ProdConfig,
): Field[] {
  const source = tree.read(envProdPath, 'utf8') ?? '';
  const sf = ts.createSourceFile(envProdPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const environment = findVariableObject(ts, sf, 'environment');
  const firebase = environment && readObjectProp(ts, environment, 'firebase');
  if (!firebase) {
    // Nothing recognisable to fill. Say so instead of guessing at a shape: the values are still safe in the
    // legacy file at this instant, and a human is the right resolver for an environment file we cannot read.
    logger.warn(
      `[migrate 0.24.2] ${envProdPath} has no recognisable \`environment.firebase\` object, so the legacy ` +
        `production config was NOT carried into it. Move projectId/apiKey/appId/authDomain across by hand ` +
        `before the next \`--sync --firebase\`.`,
    );
    return [];
  }

  const edits: { start: number; end: number; text: string }[] = [];
  const filled: Field[] = [];
  // Fields the file does not declare are collected and added in ONE splice. Appending them one at a time
  // would aim every insertion at the same offset — the point just after the block's last real member — and
  // the second insertion would land beside the first with no separator between them.
  const missing: Field[] = [];
  for (const field of FIELDS) {
    if (!config[field]) continue; // Nothing rescued for this field — leave whatever is there.
    const literal = readStringProp(ts, firebase, field);
    // A FIELD THE CURRENT FILE DOES NOT DECLARE IS ADDED, not skipped. "The template declares all four, so
    // an absent one is a customisation" was true of the template this migration was written beside — and
    // false of the prod templates the toolkit actually shipped for a stretch, which had no `authDomain`
    // slot at all. Skipping meant a legacy config carrying a real `authDomain` lost it: the log named only
    // the fields it carried, and the generator then rewrote firebase.config.ts over the last copy. Without
    // `authDomain` no OAuth sign-in works at all (popup and redirect both refuse to start), so this is a
    // credential silently dropped, not a customisation respected.
    if (!literal) {
      missing.push(field);
      continue;
    }
    // ALREADY REAL — the idempotency check, and also the "user already did this by hand" check. An unfilled
    // slot is either the empty placeholder the template ships or a literal `{{projectId}}` left by a
    // substitution that never ran; both mean "no value here".
    if (!(literal.text === '' || /^\{\{.*\}\}$/.test(literal.text))) continue;

    const span = literalSpan(source, literal);
    // The span is derived arithmetically from the node's end offset and its parsed text (the declared compiler
    // subset exposes `getEnd()` but no `getStart()`), so it is VERIFIED against the source before anything is
    // spliced. Any mismatch — an escape sequence, a concatenation, anything unexpected — means the arithmetic
    // does not describe this literal, and the only safe response is to leave the file alone.
    if (!span) continue;

    edits.push({ start: span.start, end: span.end, text: `${span.quote}${escapeForQuote(config[field], span.quote)}${span.quote}` });
    filled.push(field);
  }

  if (missing.length > 0) {
    const insertion = appendProperty(
      source,
      firebase,
      missing.map((field) => `${field}: '${escapeForQuote(config[field], "'")}'`),
    );
    if (insertion) {
      edits.push(insertion);
      filled.push(...missing);
    } else {
      // A rescued credential that goes nowhere and is never mentioned is the failure this migration exists
      // to prevent, one step further along. Name it.
      logger.warn(
        `[migrate 0.24.2] ${envProdPath}: could not add ${missing.join(', ')} to its \`firebase\` block (its ` +
          `source does not end where the parser says it does), so ${missing.length === 1 ? 'that value is' : 'those values are'} ` +
          `still only in the legacy firebase.config.ts. Copy ${missing.length === 1 ? 'it' : 'them'} across BY ` +
          `HAND before running \`--sync --firebase\`, which rewrites that file.`,
      );
    }
  }

  if (edits.length === 0) return [];

  // Applied back-to-front so each splice's offsets stay valid — earlier edits cannot shift later ones.
  const updated = edits
    .sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
  tree.write(envProdPath, updated);
  return filled;
}

/**
 * The field values of the legacy `productionFirebaseConfig` const.
 *
 * COPIED from firebase-emulators' `extractLegacyProdConfig` rather than imported, per the self-containment
 * rule: a project jumping several versions must get the walk this migration was written and tested against,
 * not whatever that generator's private helper has become by then. Returns empty strings for any field that is
 * absent, non-literal, or itself empty — the caller treats all-empty as "nothing to rescue".
 */
function extractLegacyProdConfig(ts: ClassicTypeScript, source: string): ProdConfig {
  if (!source.includes('productionFirebaseConfig')) return { ...EMPTY };

  const sf = ts.createSourceFile('firebase.config.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const prod = findVariableObject(ts, sf, 'productionFirebaseConfig');
  if (!prod) return { ...EMPTY };

  const result = { ...EMPTY };
  for (const field of FIELDS) result[field] = readStringProp(ts, prod, field)?.text ?? '';
  return result;
}

/** The object literal initialising `const <name> = { … }`, anywhere in the file. */
function findVariableObject(
  ts: ClassicTypeScript,
  root: TsSourceFile,
  name: string,
): TsObjectLiteralExpression | null {
  // The result is held on an object rather than in a bare `let` because TypeScript's control-flow analysis
  // does not track assignments made inside a callback: a `let` would be narrowed to `null` after the walk and
  // every use would need a non-null assertion. A property read is re-widened by the intervening call.
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

/** The object-literal value of `<object>.<name>`, or null when the property is absent or not an object. */
function readObjectProp(
  ts: ClassicTypeScript,
  object: TsObjectLiteralExpression,
  name: string,
): TsObjectLiteralExpression | null {
  for (const prop of object.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === name &&
      ts.isObjectLiteralExpression(prop.initializer)
    ) {
      return prop.initializer;
    }
  }
  return null;
}

/** The string-literal value node of `<object>.<name>` — the NODE, because callers need its source offsets. */
function readStringProp(
  ts: ClassicTypeScript,
  object: TsObjectLiteralExpression,
  name: string,
): TsNamedNode | null {
  for (const prop of object.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === name &&
      ts.isStringLiteral(prop.initializer)
    ) {
      return prop.initializer;
    }
  }
  return null;
}

/**
 * The exact source span of a string literal, including its quotes — or null when the source does not match
 * what the parsed node claims.
 *
 * The compiler subset this toolkit declares exposes `getEnd()` and nothing else positional, so the start is
 * computed as `end - (text.length + 2)`. That arithmetic is only true for a literal with no escape sequences,
 * which is why the caller must treat a null here as "leave this alone": every credential field the house
 * template ships is a plain alphanumeric literal, and anything else is a file we should not be splicing.
 */
function literalSpan(source: string, literal: TsNamedNode): { start: number; end: number; quote: string } | null {
  const end = literal.getEnd();
  const start = end - (literal.text.length + 2);
  if (start < 0 || end > source.length) return null;
  const quote = source[start];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  if (source[end - 1] !== quote) return null;
  if (source.slice(start + 1, end - 1) !== literal.text) return null;
  return { start, end, quote };
}

/**
 * An edit that adds one property to an object literal, just inside its closing brace — or null when the
 * source does not actually end in `}` where the parser says the node does (the same "verify before splicing"
 * rule the rest of this file follows).
 *
 * The backward scan runs over a COMMENT-MASKED copy, not the raw source. The house prod template ends its
 * `firebase` block with a comment ("Only for FCM web push — add …"), and a scan that only skips whitespace
 * would splice the new property INTO that comment: syntactically gone, and the credential lost exactly as
 * silently as before. Masking is comment-only — blanking string literals too would make the scan walk back
 * over `appId: 'abc'` and land after the colon.
 */
function appendProperty(
  source: string,
  object: TsObjectLiteralExpression,
  properties: string[],
): { start: number; end: number; text: string } | null {
  const end = object.getEnd();
  if (source[end - 1] !== '}') return null;

  const masked = maskComments(source);
  let last = end - 2;
  while (last >= 0 && /\s/.test(masked[last])) last--;
  if (last < 0) return null;

  const list = properties.join(', ');
  // An empty literal takes the properties bare; anything else keeps the block's existing comma style.
  if (masked[last] === '{') return { start: last + 1, end: last + 1, text: ` ${list} ` };
  const text = masked[last] === ',' ? ` ${list},` : `, ${list}`;
  return { start: last + 1, end: last + 1, text };
}

/**
 * The source with every COMMENT blanked to spaces, character-for-character (newlines kept, so offsets and
 * lines both survive). String literals are walked over but left intact — the walk is what stops a `//` inside
 * `'http://…'` from swallowing the rest of the line.
 */
function maskComments(source: string): string {
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
      i = j; // Skipped, not blanked — the caller needs the literal's own characters.
    }
  }
  return out.join('');
}

/**
 * A value made safe to sit inside a `<quote>…<quote>` literal. Firebase web-config values are alphanumeric
 * with dashes, so this never fires in practice — but the input is a string read out of a file this code did
 * not write, and emitting source that does not parse is a far worse outcome than an unnecessary backslash.
 */
function escapeForQuote(value: string, quote: string): string {
  return value.split('\\').join('\\\\').split(quote).join(`\\${quote}`);
}
