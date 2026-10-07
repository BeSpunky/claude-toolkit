// THE PLATFORM FIREWALL — the `platform:` constraints in the root flat ESLint config's
// `@nx/enforce-module-boundaries` `depConstraints`.
//
// FAIL CLOSED. Each platform may depend only on its own and on shared projects (`onlyDependOnLibsWithTags`), and
// may import no package bound to another platform (`bannedExternalImports`, ./externals):
//
//   platform:web     → web | shared       bans the server-only packages
//   platform:server  → server | shared    bans the web-only packages
//   platform:shared  → shared             bans both
//
// Before 0.50.0 only the bans existed, keyed on web and server. A constraint applies to the IMPORTING project's
// own source, so an untagged library matched none of them: it could import firebase-admin, and a web app importing
// that library carried firebase-admin into its bundle with lint passing. Now a tagged project cannot depend on an
// untagged one at all, so every project in a web app's graph is itself web or shared and is checked for its own
// imports. That is why `checkNestedExternalImports` (a rule-wide option that walks every project's external
// dependencies on every lint) is not set: with the graph closed under tags it would find nothing new.
//
// THE LINT MESSAGE CANNOT BE CUSTOMISED (`depConstraints` carry no message — @nx/eslint-plugin 23), so what to do
// about it is written where the developer — or Claude — looks next: a comment above the constraints, naming the
// one command that fixes the common case (`platform`, which infers and sets a project's tag).
//
// Two writers, one model: `insertPlatformFirewall` (a workspace gaining the firewall — firebase-emulators) and
// `upgradePlatformFirewall` (a workspace carrying the pre-0.50.0 shape — migration 0.50.0). Both splice text
// located through the TypeScript AST, so the surrounding file keeps its formatting.
import { applyChangesToString, ChangeType, type StringChange } from '@nx/devkit';
import { loadTypeScript, type TsArrayLiteralExpression, type TsNode, type TsSourceFile } from '../generators/_utils/typescript-api';
import { type Platform, PLATFORMS, PLATFORM_MEANING, platformTag, reachable } from './platform';
import type { PlatformExternals } from './externals';

/** The marker the guidance comment opens with — how a writer knows it is already there. */
const MARKER = 'THE PLATFORM FIREWALL';

/** The comment the pre-0.50.0 generator wrote above its two constraints; superseded by `guidance`. */
const LEGACY_COMMENT = [
  '// by platform: the server-only Firebase Admin/Functions SDKs belong to Cloud',
  '// Functions alone — they must never reach browser/SSR code (they pull in',
  '// Node-native modules and admin credentials). Symmetrically, the browser Firebase',
  '// SDK and the client framework have no place in the functions runtime.',
];

/** What each platform's constraint bans: everything bound to a platform it is not. */
export function bannedFor(platform: Platform, externals: PlatformExternals): string[] {
  if (platform === 'web') return [...externals.server];
  if (platform === 'server') return [...externals.web];
  return [...new Set([...externals.web, ...externals.server])];
}

/** The guidance written above the constraints. `nx` is how this repo runs Nx (`./nx`, `yarn nx`, …). */
export function guidance(nx: string): string[] {
  const width = Math.max(...PLATFORMS.map((platform) => platformTag(platform).length));
  return [
    `// ${MARKER} (house) — every project carries exactly ONE platform tag:`,
    ...PLATFORMS.map((platform) => `//   ${platformTag(platform).padEnd(width)}  ${PLATFORM_MEANING[platform]}`),
    `// Lint says 'A project tagged with "platform:…" can only depend on libs tagged with …'? The project it`,
    `// imports has no platform (or another one). Classify it — inferred from its imports, or stated:`,
    `//   ${nx} g @bespunky/nx-tools:platform <project> [--platform=web|server|shared]`,
    `// Lint says '… is not allowed to import "<package>"'? That package belongs to another platform: move the`,
    `// code into a project of that platform, or re-classify this one. Never widen these lists to make it pass.`,
  ];
}

const constraintLines = (platform: Platform, banned: readonly string[]): string[] => [
  `{`,
  `  sourceTag: '${platformTag(platform)}',`,
  `  onlyDependOnLibsWithTags: [${reachable(platform).map((p) => `'${platformTag(p)}'`).join(', ')}],`,
  `  bannedExternalImports: [${banned.map((pkg) => `'${pkg}'`).join(', ')}],`,
  `}`,
];

/** The whole firewall as config lines — the guidance, then one constraint per platform (no trailing comma). */
export function firewallBlock(externals: PlatformExternals, nx: string): string[] {
  return [...guidance(nx), ...PLATFORMS.flatMap((platform, i) => {
    const block = constraintLines(platform, bannedFor(platform, externals));
    return i < PLATFORMS.length - 1 ? [...block.slice(0, -1), '},'] : block;
  })];
}

/**
 * Insert the whole firewall into a config that declares none. Returns the updated source; the original when any
 * `platform:` constraint is already declared (a workspace carrying the old shape is the migration's to upgrade);
 * `null` when no `depConstraints` array literal (or no usable TypeScript) is found — the caller says what to add.
 */
export function insertPlatformFirewall(source: string, sourcePath: string, externals: PlatformExternals, nx: string): string | null {
  if (source.includes("'platform:") || source.includes('"platform:')) return source;
  const located = locate(source, sourcePath);
  if (!located) return null;
  const { sf, array } = located;
  const elements = array.elements;
  const last = elements.length ? elements[elements.length - 1] : null;
  const indent = last ? indentOfLineAt(source, last.getStart(sf)) : `${indentOfLineAt(source, array.getStart(sf))}  `;
  const block = firewallBlock(externals, nx).map((line) => `${indent}${line}`).join('\n');
  // Spliced after the last element (past its trailing comma, if any) at its own indentation; into an empty array,
  // one level inside it — never just before `]`, which leaves `}\n   ,` wherever prettier is absent.
  const afterLast = last ? (elements.hasTrailingComma ? source.indexOf(',', last.getEnd()) + 1 : last.getEnd()) : -1;
  const change: StringChange = last
    ? { type: ChangeType.Insert, index: afterLast, text: `${elements.hasTrailingComma ? '' : ','}\n${block}${elements.hasTrailingComma ? ',' : ''}` }
    : { type: ChangeType.Insert, index: array.getStart(sf) + 1, text: `\n${block},\n${indentOfLineAt(source, array.getStart(sf))}` };
  return applyChangesToString(source, [change]);
}

export interface FirewallUpgrade {
  source: string;
  /** What changed, one line each — for the migration's log. Empty: already current. */
  changes: string[];
}

/**
 * Bring a pre-0.50.0 firewall (bans only, web and server) to the fail-closed shape: every platform constraint gains
 * its `onlyDependOnLibsWithTags`, a `platform:shared` constraint is added, and the old comment gives way to the
 * guidance. The bans a project already declares are KEPT as written (they may carry its own additions); the shared
 * constraint bans their union — what the project itself says is web-only plus what it says is server-only.
 * `null` when the config declares no platform constraint at all (no firewall: nothing to upgrade).
 */
export function upgradePlatformFirewall(source: string, sourcePath: string, externals: PlatformExternals, nx: string): FirewallUpgrade | null {
  const located = locate(source, sourcePath);
  if (!located) return null;
  const { ts, sf, array } = located;

  const found = new Map<Platform, { node: TsNode; sourceTag: TsNode; hasOnly: boolean; banned: string[] | null }>();
  for (const element of array.elements) {
    if (!ts.isObjectLiteralExpression(element)) continue;
    let tag: string | undefined;
    let sourceTagNode: TsNode | undefined;
    let hasOnly = false;
    let banned: string[] | null = null;
    for (const property of element.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : '';
      if (key === 'sourceTag' && ts.isStringLiteral(property.initializer)) {
        tag = property.initializer.text;
        sourceTagNode = property;
      }
      if (key === 'onlyDependOnLibsWithTags') hasOnly = true;
      if (key === 'bannedExternalImports' && ts.isArrayLiteralExpression(property.initializer)) {
        banned = property.initializer.elements.filter((e) => ts.isStringLiteral(e)).map((e) => (e as { text: string }).text);
      }
    }
    const platform = PLATFORMS.find((p) => platformTag(p) === tag);
    if (platform && sourceTagNode && !found.has(platform)) found.set(platform, { node: element, sourceTag: sourceTagNode, hasOnly, banned });
  }
  if (!found.has('web') && !found.has('server')) return null;

  const changes: StringChange[] = [];
  const log: string[] = [];
  for (const [platform, constraint] of found) {
    if (constraint.hasOnly) continue;
    const indent = indentOfLineAt(source, constraint.sourceTag.getStart(sf));
    const only = `onlyDependOnLibsWithTags: [${reachable(platform).map((p) => `'${platformTag(p)}'`).join(', ')}]`;
    const end = constraint.sourceTag.getEnd();
    const next = source.slice(end).search(/\S/);
    const comma = next >= 0 && source[end + next] === ',' ? end + next + 1 : -1;
    changes.push(
      comma >= 0
        ? { type: ChangeType.Insert, index: comma, text: `\n${indent}${only},` }
        : { type: ChangeType.Insert, index: end, text: `,\n${indent}${only}` },
    );
    log.push(`${platformTag(platform)} may now depend only on ${reachable(platform).map(platformTag).join(' and ')} projects`);
  }

  const platformNodes = [...found.values()].map((c) => c.node).sort((a, b) => a.getStart(sf) - b.getStart(sf));
  if (!found.has('shared')) {
    const declaredBans = [...(found.get('web')?.banned ?? []), ...(found.get('server')?.banned ?? [])];
    const banned = declaredBans.length ? [...new Set(declaredBans)] : bannedFor('shared', externals);
    const lastNode = platformNodes[platformNodes.length - 1];
    const indent = indentOfLineAt(source, lastNode.getStart(sf));
    const end = lastNode.getEnd();
    const next = source.slice(end).search(/\S/);
    const hasComma = next >= 0 && source[end + next] === ',';
    const block = constraintLines('shared', banned).map((line) => `${indent}${line}`).join('\n');
    changes.push(
      hasComma
        ? { type: ChangeType.Insert, index: end + next + 1, text: `\n${block},` }
        : { type: ChangeType.Insert, index: end, text: `,\n${block}` },
    );
    log.push(`added platform:shared — isomorphic code: may depend only on shared projects, imports none of ${banned.join(', ')}`);
  }

  if (!source.includes(MARKER)) {
    const first = platformNodes[0];
    const indent = indentOfLineAt(source, first.getStart(sf));
    const text = guidance(nx).map((line) => `${indent}${line}`).join('\n');
    const legacy = legacyCommentSpan(source);
    // Delete the old comment and insert the new one right AFTER its span — two changes at distinct offsets.
    if (legacy) changes.push({ type: ChangeType.Delete, start: legacy.start, length: legacy.length }, { type: ChangeType.Insert, index: legacy.start + legacy.length, text: `${text}\n` });
    else {
      const lineStart = source.lastIndexOf('\n', first.getStart(sf) - 1) + 1;
      changes.push({ type: ChangeType.Insert, index: lineStart, text: `${text}\n` });
    }
    log.push(legacy ? 'replaced the old firewall comment with the guidance (what each platform means, how to fix a violation)' : 'wrote the guidance comment above the constraints');
  }

  return { source: changes.length ? applyChangesToString(source, changes) : source, changes: log };
}

/** The old generator's comment, at whatever indentation — its exact text, line for line, or nothing. */
function legacyCommentSpan(source: string): { start: number; length: number } | null {
  const pattern = new RegExp(LEGACY_COMMENT.map((line) => `[ \\t]*${line.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\r?\\n`).join(''));
  const match = pattern.exec(source);
  return match ? { start: match.index, length: match[0].length } : null;
}

function locate(source: string, sourcePath: string) {
  const ts = loadTypeScript();
  if (!ts) return null;
  const sf: TsSourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.JS);
  let array: TsArrayLiteralExpression | null = null;
  const visit = (node: TsNode): void => {
    if (array) return;
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'depConstraints' && ts.isArrayLiteralExpression(node.initializer)) {
      array = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return array ? { ts, sf, array: array as TsArrayLiteralExpression } : null;
}

const indentOfLineAt = (source: string, pos: number): string => /^[ \t]*/.exec(source.slice(source.lastIndexOf('\n', pos - 1) + 1))![0];
