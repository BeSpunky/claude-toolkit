// THE PLATFORM FIREWALL — the root flat ESLint config's platform rule.
//
// FAIL CLOSED. Each platform may depend only on its own and on shared projects (`onlyDependOnLibsWithTags`), and
// may import no package bound to another platform (`bannedExternalImports`, ./externals):
//
//   platform:web     → web | shared       bans the server-only packages
//   platform:server  → server | shared    bans the web-only packages
//   platform:shared  → shared             bans both
//
// ITS OWN RULE INSTANCE. The constraints are not spliced into the project's `@nx/enforce-module-boundaries`
// constraints: @nx/eslint-plugin is registered a second time, under the `platform` namespace, and the firewall is
// `platform/enforce-module-boundaries` with `platformConstraints` as its only constraints. Three things follow:
//   - an UNTAGGED project is checked too. Nx reports a project that matches no constraint of an instance ("A project
//     without tags matching at least one constraint cannot depend on any libraries") — in the project's own
//     instance a `sourceTag: '*'` catch-all always matched, so an untagged project used to import anything;
//   - the firewall can be SCOPED BY FILE (./scopes) without restating the project's own options: ESLint replaces a
//     rule's options wholesale per block, so a block that re-configured `@nx/enforce-module-boundaries` for tests
//     would have had to copy every constraint the project ever wrote. Here a block re-configures only the
//     firewall: the SSR server half of a web app gets the web constraint relaxed, tests and tool configs are off;
//   - the lint message names the rule — `platform/enforce-module-boundaries` — so it says which boundary it is.
// Every project in a web app's graph is then itself web or shared and is checked for its own imports, which is why
// `checkNestedExternalImports` (a whole-graph walk on every lint) is not set.
//
// THE LINT MESSAGE CANNOT BE CUSTOMISED (`depConstraints` carry no message — @nx/eslint-plugin 23), so what to do
// about it is written where the developer — or Claude — looks next: a comment above `platformConstraints`, naming
// the one command that fixes the common case (`platform`, which infers and sets a project's tag).
//
// Two writers, one model: `insertPlatformFirewall` (a workspace gaining the firewall — firebase-emulators) and
// `upgradePlatformFirewall` (a workspace carrying the 0.49 shape — two ban-only constraints inside the project's own
// `depConstraints` — migration 0.50.0). Both splice text located through the TypeScript AST, so the surrounding
// file keeps its formatting. `readDeclaredBans` is the third reader: what the config bans, for the classifier.
import { applyChangesToString, ChangeType, type StringChange } from '@nx/devkit';
import {
  loadTypeScript,
  type ClassicTypeScript,
  type TsArrayLiteralExpression,
  type TsNode,
  type TsSourceFile,
} from '../generators/_utils/typescript-api';
import { type Platform, PLATFORMS, PLATFORM_MEANING, platformTag, reachable } from './platform';
import type { DeclaredBans, PlatformExternals } from './externals';
import { LINTED_FILES, SSR_SERVER_FILES, TEST_FILES, TOOL_CONFIG_FILES } from './scopes';

/** The marker the guidance comment opens with. */
const MARKER = 'THE PLATFORM FIREWALL';
/** The constant the constraints live in — the one list a project edits, and what the readers locate. */
export const CONSTRAINTS = 'platformConstraints';
/** The ESLint namespace the firewall's own instance of @nx/eslint-plugin is registered under. */
export const NAMESPACE = 'platform';
export const RULE = `${NAMESPACE}/enforce-module-boundaries`;
const PLUGIN = '@nx/eslint-plugin';

/**
 * The comment the old generator wrote above its two constraints — every shape it ever shipped, superseded by
 * `guidance`. ≤0.35 named Angular (1ac9b19, from 0d09453); 0.36+ the client framework (c69fbac).
 */
const LEGACY_COMMENTS: readonly (readonly string[])[] = [
  [
    '// by platform: the server-only Firebase Admin/Functions SDKs belong to Cloud',
    '// Functions alone — they must never reach browser/SSR code (they pull in',
    '// Node-native modules and admin credentials). Symmetrically, the browser Firebase',
    '// SDK and the client framework have no place in the functions runtime.',
  ],
  [
    '// by platform: the server-only Firebase Admin/Functions SDKs belong to Cloud',
    '// Functions alone — they must never reach browser/SSR Angular code (they pull in',
    '// Node-native modules and admin credentials). Symmetrically, the browser Firebase',
    '// SDK and Angular have no place in the functions runtime.',
  ],
];

/** What the 0.49 firewall banned, per constraint — how the upgrade tells a project's own edits from the house's list. */
const LEGACY_BANS: Readonly<Record<'web' | 'server', readonly string[]>> = {
  web: ['firebase-admin', 'firebase-admin/*', 'firebase-functions', 'firebase-functions/*'],
  server: ['firebase', 'firebase/*', '@angular/*'],
};

/** What each platform's constraint bans: everything bound to a platform it is not. */
export function bannedFor(platform: Platform, externals: PlatformExternals): string[] {
  if (platform === 'web') return [...externals.server];
  if (platform === 'server') return [...externals.web];
  return [...new Set([...externals.web, ...externals.server, ...externals.unsided])];
}

/** The guidance written above the constraints. `nx` is how this repo runs Nx (`./nx`, `yarn nx`, …). */
export function guidance(nx: string): string[] {
  const width = Math.max(...PLATFORMS.map((platform) => platformTag(platform).length));
  return [
    `// ${MARKER} (house) — every code project carries exactly ONE platform tag:`,
    ...PLATFORMS.map((platform) => `//   ${platformTag(platform).padEnd(width)}  ${PLATFORM_MEANING[platform]}`),
    `// Enforced by its own rule, \`${RULE}\` (the blocks at the end of this config). What lint says:`,
    `//   'A project tagged with "platform:…" can only depend on libs tagged with …' — the project it imports has no`,
    `//     platform (or another one). Classify it — inferred from its imports, or stated:`,
    `//       ${nx} g @bespunky/nx-tools:platform <project> [--platform=web|server|shared]`,
    `//   'A project without tags matching at least one constraint cannot depend on any libraries' — THIS project has`,
    `//     no platform: the same command, for it.`,
    `//   '… is not allowed to import "<package>"' — that package belongs to another platform: move the code into a`,
    `//     project of that platform, or re-classify this one. Never widen these lists to make it pass.`,
    `// Not judged: tests and the tools' own configs (they never ship), and in a platform:web project the server half`,
    `// of SSR (src/server.ts, src/server/**), which runs only in Node.`,
  ];
}

const quoted = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(', ');

const constraintLines = (platform: Platform, banned: readonly string[]): string[] => [
  `{`,
  `  sourceTag: '${platformTag(platform)}',`,
  `  onlyDependOnLibsWithTags: [${quoted(reachable(platform).map(platformTag))}],`,
  `  bannedExternalImports: [`,
  ...banned.map((pkg) => `    '${pkg}',`),
  `  ],`,
  `}`,
];

/** `const platformConstraints = […];` with the guidance above it — top-level statement lines. */
function constraintsDeclaration(bans: Readonly<Record<Platform, readonly string[]>>, nx: string): string[] {
  return [
    ...guidance(nx),
    `const ${CONSTRAINTS} = [`,
    ...PLATFORMS.flatMap((platform) => constraintLines(platform, bans[platform]).map((line, i, all) => `  ${line}${i === all.length - 1 ? ',' : ''}`)),
    `];`,
  ];
}

/** The firewall's config blocks — elements of the exported array, comma-separated, no trailing comma. */
function firewallBlocks(plugin: string): string[] {
  const relaxedWeb = `${CONSTRAINTS}.map((c) => (c.sourceTag === '${platformTag('web')}' ? { sourceTag: c.sourceTag } : c))`;
  return [
    `// ${MARKER} (house) — \`${CONSTRAINTS}\` above, enforced by its own instance of the rule.`,
    `{`,
    `  files: [${quoted(LINTED_FILES)}],`,
    `  plugins: { ${NAMESPACE}: ${plugin} },`,
    `  rules: { '${RULE}': ['error', { depConstraints: ${CONSTRAINTS} }] },`,
    `},`,
    `// The server half of an SSR web app runs only in Node: there, platform:web may reach server code too.`,
    `{`,
    `  files: [${quoted(SSR_SERVER_FILES)}],`,
    `  rules: { '${RULE}': ['error', { depConstraints: ${relaxedWeb} }] },`,
    `},`,
    `// Tests and the tools' own configs never ship: the firewall judges what reaches a runtime.`,
    `{`,
    `  files: [${quoted(TEST_FILES)}],`,
    `  rules: { '${RULE}': 'off' },`,
    `},`,
    `{`,
    `  files: [${quoted(TOOL_CONFIG_FILES.files)}],`,
    `  ignores: [${quoted(TOOL_CONFIG_FILES.ignores)}],`,
    `  rules: { '${RULE}': 'off' },`,
    `}`,
  ];
}

/** The whole firewall as text a human can paste — for the report when the config cannot be edited automatically. */
export function firewallSnippet(externals: PlatformExternals, nx: string): string {
  return [
    `import nx from '${PLUGIN}';`,
    '',
    ...constraintsDeclaration(tableBans(externals), nx),
    '',
    'export default [',
    '  // … your config …',
    ...firewallBlocks('nx').map((line) => `  ${line}`),
    '];',
  ].join('\n');
}

const tableBans = (externals: PlatformExternals): Record<Platform, string[]> => ({
  web: bannedFor('web', externals),
  server: bannedFor('server', externals),
  shared: bannedFor('shared', externals),
});

/** Is the 0.50 firewall (its constant or its rule) already in this config? */
export const hasPlatformFirewall = (source: string): boolean => source.includes(RULE) || new RegExp(`\\b${CONSTRAINTS}\\b`).test(source);

/**
 * Insert the whole firewall into a config that declares none. Returns the updated source; the original when the
 * firewall — or the 0.49 shape, which is the migration's to upgrade — is already there; `null` when the config has
 * no `export default [ … ]` (or `export default fn([ … ])`) this can extend, or no usable TypeScript — the caller
 * then says what to add (`firewallSnippet`).
 */
export function insertPlatformFirewall(source: string, sourcePath: string, externals: PlatformExternals, nx: string): string | null {
  if (hasPlatformFirewall(source) || legacyConstraints(source, sourcePath)?.length) return source;
  return spliceFirewall(source, sourcePath, tableBans(externals), nx, [])?.source ?? null;
}

export interface FirewallUpgrade {
  source: string;
  /** What changed, one line each — for the migration's log. Empty: nothing to upgrade. */
  changes: string[];
  /** What the project had declared that the house carried or could not carry — for the migration's report. */
  notes: string[];
}

/**
 * Bring a 0.49 firewall (two ban-only constraints, web and server, inside the project's own `depConstraints`) to the
 * 0.50 shape: those constraints are REMOVED from the project's rule (with the old comment) and the firewall is
 * written as its own instance. The project's own edits to the old ban lists are carried: what it added stays banned,
 * what it removed stays allowed (both reported); any other key it gave those constraints is reported, not guessed at.
 * `null` when the config carries no 0.49 platform constraint (nothing to upgrade), or cannot be read.
 */
export function upgradePlatformFirewall(source: string, sourcePath: string, externals: PlatformExternals, nx: string): FirewallUpgrade | null {
  if (hasPlatformFirewall(source)) return null;
  const legacy = legacyConstraints(source, sourcePath);
  if (!legacy?.length) return null;

  const notes: string[] = [];
  const table = tableBans(externals);
  const bans: Record<Platform, string[]> = { ...table };
  for (const side of ['web', 'server'] as const) {
    const declared = legacy.find((c) => c.platform === side);
    if (!declared?.banned) continue;
    const added = declared.banned.filter((pkg) => !LEGACY_BANS[side].includes(pkg));
    const removed = LEGACY_BANS[side].filter((pkg) => !declared.banned!.includes(pkg));
    bans[side] = [...new Set([...table[side].filter((pkg) => !removed.includes(pkg)), ...added])];
    if (added.length) notes.push(`carried this project's own ${platformTag(side)} bans: ${added.join(', ')}`);
    if (removed.length) notes.push(`kept allowed what this project had removed from ${platformTag(side)}'s bans: ${removed.join(', ')} — say so in ${CONSTRAINTS} if that is still meant`);
  }
  bans.shared = [...new Set([...bans.web, ...bans.server])];
  for (const constraint of legacy) {
    if (constraint.otherKeys.length) {
      notes.push(
        `${platformTag(constraint.platform)} declared ${constraint.otherKeys.join(', ')} — not carried (the firewall's own model decides them); ` +
          `restate it in ${CONSTRAINTS} if it is still meant`,
      );
    }
  }

  const removals: StringChange[] = legacy.map((constraint) => ({ type: ChangeType.Delete, start: constraint.start, length: constraint.end - constraint.start }));
  const span = legacyCommentSpan(source);
  if (span) removals.push({ type: ChangeType.Delete, start: span.start, length: span.length });
  const spliced = spliceFirewall(source, sourcePath, bans, nx, removals);
  if (!spliced) return null;
  return {
    source: spliced.source,
    changes: [
      `moved the platform constraints out of @nx/enforce-module-boundaries into their own rule, ${RULE} (${CONSTRAINTS})`,
      `each platform now depends only on its own and shared projects; platform:shared added; an untagged project is checked too`,
      `tests, tool configs and the SSR server half of a web app are scoped (not judged / server-relaxed)`,
    ],
    notes,
  };
}

/**
 * What the project's firewall bans, per platform constraint — the 0.50 `platformConstraints`, else the 0.49
 * constraints — or null when the config has neither (or cannot be read).
 */
export function readDeclaredBans(source: string, sourcePath: string): DeclaredBans | null {
  const ts = loadTypeScript();
  if (!ts) return null;
  const sf = parse(ts, source, sourcePath);
  let array: TsArrayLiteralExpression | null = null;
  const visit = (node: TsNode): void => {
    if (array) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === CONSTRAINTS && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      array = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const constraints = array ? readConstraints(ts, array as TsArrayLiteralExpression) : legacyConstraints(source, sourcePath) ?? [];
  if (!constraints.length) return null;
  const banned = (platform: Platform) => constraints.find((c) => c.platform === platform)?.banned ?? [];
  return { web: banned('web'), server: banned('server'), shared: banned('shared') };
}

interface DeclaredConstraint {
  platform: Platform;
  banned: string[] | null;
  /** Keys other than sourceTag / bannedExternalImports / onlyDependOnLibsWithTags. */
  otherKeys: string[];
  /** The element's removable span — its own line(s), its trailing comma. */
  start: number;
  end: number;
}

function readConstraints(ts: ClassicTypeScript, array: TsArrayLiteralExpression, source = '', sf?: TsSourceFile): DeclaredConstraint[] {
  const found: DeclaredConstraint[] = [];
  for (const element of array.elements) {
    if (!ts.isObjectLiteralExpression(element)) continue;
    let platform: Platform | undefined;
    let banned: string[] | null = null;
    const otherKeys: string[] = [];
    for (const property of element.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : '';
      if (key === 'sourceTag' && ts.isStringLiteral(property.initializer)) platform = PLATFORMS.find((p) => platformTag(p) === (property.initializer as { text: string }).text);
      else if (key === 'bannedExternalImports' && ts.isArrayLiteralExpression(property.initializer)) {
        banned = property.initializer.elements.filter((e) => ts.isStringLiteral(e)).map((e) => (e as { text: string }).text);
      } else if (key !== 'sourceTag' && key !== 'onlyDependOnLibsWithTags') otherKeys.push(key);
    }
    if (!platform) continue;
    const span = sf ? removableSpan(source, element.getStart(sf), element.getEnd()) : { start: 0, end: 0 };
    found.push({ platform, banned, otherKeys, ...span });
  }
  return found;
}

/** The 0.49 constraints: `platform:` constraints inside the project's own `depConstraints` array. */
function legacyConstraints(source: string, sourcePath: string): DeclaredConstraint[] | null {
  const ts = loadTypeScript();
  if (!ts) return null;
  const sf = parse(ts, source, sourcePath);
  const found: DeclaredConstraint[] = [];
  const visit = (node: TsNode): void => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'depConstraints' && ts.isArrayLiteralExpression(node.initializer)) {
      found.push(...readConstraints(ts, node.initializer, source, sf));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/**
 * Write the firewall: the `platformConstraints` declaration above the `export default` statement, the plugin import
 * when the config has none to reuse, and the blocks after the exported array's last element — plus any `extra`
 * changes (the upgrade's removals), applied in the same pass.
 */
function spliceFirewall(
  source: string,
  sourcePath: string,
  bans: Readonly<Record<Platform, readonly string[]>>,
  nx: string,
  extra: StringChange[],
): { source: string } | null {
  const ts = loadTypeScript();
  if (!ts) return null;
  const sf = parse(ts, source, sourcePath);
  const exported = exportedArray(ts, sf);
  if (!exported) return null;
  const { statement, array } = exported;

  const changes: StringChange[] = [...extra];
  const pluginImport = defaultImportOf(ts, sf, PLUGIN);
  const plugin = pluginImport ?? (identifierUsed(ts, sf, 'nx') ? 'nxPlatform' : 'nx');
  if (!pluginImport) {
    const imports = sf.statements.filter((s) => ts.isImportDeclaration(s));
    const at = imports.length ? imports[imports.length - 1].getEnd() : 0;
    changes.push({ type: ChangeType.Insert, index: at, text: imports.length ? `\nimport ${plugin} from '${PLUGIN}';` : `import ${plugin} from '${PLUGIN}';\n\n` });
  }

  const statementStart = lineStart(source, statement.getStart(sf));
  const blankBefore = statementStart === 0 || /\n[ \t]*\n$/.test(source.slice(0, statementStart)) ? '' : '\n';
  changes.push({ type: ChangeType.Insert, index: statementStart, text: `${blankBefore}${constraintsDeclaration(bans, nx).join('\n')}\n\n` });

  // Spliced after the last element (past its trailing comma, if any) at its own indentation; into an empty array,
  // one level inside it — never just before `]`, which leaves `}\n   ,` wherever prettier is absent.
  const elements = array.elements;
  const last = elements.length ? elements[elements.length - 1] : null;
  const indent = last ? indentOfLineAt(source, last.getStart(sf)) : `${indentOfLineAt(source, array.getStart(sf))}  `;
  const block = firewallBlocks(plugin).map((line) => `${indent}${line}`).join('\n');
  const afterLast = last ? (elements.hasTrailingComma ? source.indexOf(',', last.getEnd()) + 1 : last.getEnd()) : -1;
  changes.push(
    last
      ? { type: ChangeType.Insert, index: afterLast, text: `${elements.hasTrailingComma ? '' : ','}\n${block}${elements.hasTrailingComma ? ',' : ''}` }
      : { type: ChangeType.Insert, index: array.getStart(sf) + 1, text: `\n${block},\n${indentOfLineAt(source, array.getStart(sf))}` },
  );
  return { source: applyChangesToString(source, changes) };
}

/** `export default [ … ]`, or `export default someConfig([ … ], …)` (defineConfig and the like) — its array. */
function exportedArray(ts: ClassicTypeScript, sf: TsSourceFile): { statement: TsNode; array: TsArrayLiteralExpression } | null {
  for (const statement of sf.statements) {
    if (!ts.isExportAssignment(statement)) continue;
    const expression = statement.expression;
    if (ts.isArrayLiteralExpression(expression)) return { statement, array: expression };
    if (ts.isCallExpression(expression) && expression.arguments[0] && ts.isArrayLiteralExpression(expression.arguments[0])) {
      return { statement, array: expression.arguments[0] };
    }
  }
  return null;
}

/** The local name of `module`'s default import, if the config has one. */
function defaultImportOf(ts: ClassicTypeScript, sf: TsSourceFile, module: string): string | undefined {
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === module) {
      const name = statement.importClause?.name?.text;
      if (name) return name;
    }
  }
  return undefined;
}

function identifierUsed(ts: ClassicTypeScript, sf: TsSourceFile, name: string): boolean {
  let used = false;
  const visit = (node: TsNode): void => {
    if (used) return;
    if (ts.isIdentifier(node) && node.text === name) used = true;
    else ts.forEachChild(node, visit);
  };
  visit(sf);
  return used;
}

/** The old generator's comment (any shipped shape), at whatever indentation — its exact text, line for line, or nothing. */
function legacyCommentSpan(source: string): { start: number; length: number } | null {
  for (const comment of LEGACY_COMMENTS) {
    const pattern = new RegExp(comment.map((line) => `[ \\t]*${line.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\r?\\n`).join(''));
    const match = pattern.exec(source);
    if (match) return { start: match.index, length: match[0].length };
  }
  return null;
}

/**
 * The span that removes an array element cleanly: from its line's start when only indentation precedes it, through
 * its trailing comma, and through the end of the line when only whitespace follows.
 */
function removableSpan(source: string, start: number, end: number): { start: number; end: number } {
  const from = lineStart(source, start);
  let to = end;
  const comma = /^\s*,/.exec(source.slice(to));
  if (comma) to += comma[0].length;
  const rest = /^[ \t]*\r?\n/.exec(source.slice(to));
  const ownLine = /^[ \t]*$/.test(source.slice(from, start));
  return ownLine && rest ? { start: from, end: to + rest[0].length } : { start, end: to };
}

const parse = (ts: ClassicTypeScript, source: string, sourcePath: string): TsSourceFile =>
  ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.JS);

const lineStart = (source: string, pos: number): number => source.lastIndexOf('\n', pos - 1) + 1;
const indentOfLineAt = (source: string, pos: number): string => /^[ \t]*/.exec(source.slice(lineStart(source, pos)))![0];
