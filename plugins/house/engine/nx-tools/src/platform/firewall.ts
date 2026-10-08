// THE PLATFORM FIREWALL — the platform constraints of the root flat ESLint config.
//
// FAIL CLOSED. Each platform may depend only on its own and on shared projects (`onlyDependOnLibsWithTags`), and
// may import no package bound to another platform (`bannedExternalImports`, ./externals):
//
//   platform:web     → web | shared       bans the server-only packages
//   platform:server  → server | shared    bans the web-only packages
//   platform:shared  → shared             bans both
//
// ONE RULE INSTANCE. The constraints join the workspace's own `@nx/enforce-module-boundaries`. A second instance of
// the rule (0.50.0's first design) re-ran every generic check it makes — relative or absolute project imports,
// circular dependencies, lazy-load imports — so each violation was reported twice, and the workspace's exemptions
// (`allow`, `ignoredCircularDependencies`, …) never reached it. Two things are written instead:
//   - the workspace's own options are HOISTED into `moduleBoundaryOptions`, and every block that configures the rule
//     builds its entry with `moduleBoundaries(<platform constraints>)`. ESLint replaces a rule's options wholesale per
//     config block, so this is how a block scoped by file (./scopes) changes ONLY the platform part: the SSR server
//     half of a web app gets the web constraint relaxed, tests and tool configs get none — while the workspace's own
//     options reach every block from one place;
//   - Nx's stock catch-all `{ sourceTag: '*', onlyDependOnLibsWithTags: ['*'] }` is REMOVED from those options. It
//     forbids nothing; its only effect is that every project matches some constraint, which exempts an UNTAGGED
//     project from Nx's "A project without tags matching at least one constraint cannot depend on any libraries" —
//     the hole a fail-closed firewall exists to close. The test and tool-config blocks restate it, so nothing that
//     never ships is newly judged.
//
// THE LIMIT, stated rather than papered over: Nx selects a constraint by the tags a project HAS, never by one it
// lacks. So a project with no platform tag but another tag one of the workspace's own constraints matches (say
// `scope:billing`) is not caught by that message. Its importers still are — a tagged project may depend only on
// platform-tagged ones — and the classifier reports it. A catch-all the workspace wrote with more than the stock
// content is kept, and reported, for the same reason.
//
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
  type TsObjectLiteralExpression,
  type TsPropertyAssignment,
  type TsSourceFile,
} from '../generators/_utils/typescript-api';
import { type Platform, PLATFORMS, PLATFORM_MEANING, platformTag, reachable } from './platform';
import type { DeclaredBans, PlatformExternals } from './externals';
import { LINTED_FILES, SSR_SERVER_FILES, TEST_FILES, TOOL_CONFIG_FILES } from './scopes';

/** The marker the guidance comment opens with. */
const MARKER = 'THE PLATFORM FIREWALL';
/** The constant the constraints live in — the one list a project edits, and what the readers locate. */
export const CONSTRAINTS = 'platformConstraints';
/** The constant the workspace's own options for the rule are hoisted into — where an exemption goes. */
export const OPTIONS = 'moduleBoundaryOptions';
/** The function every block builds the rule's entry with: the workspace's options plus that block's platform part. */
export const ENTRY = 'moduleBoundaries';
/** The ONE rule the firewall's constraints join. */
export const RULE = '@nx/enforce-module-boundaries';
const PLUGIN = '@nx/eslint-plugin';
/** Nx's stock catch-all constraint, as text — and its reading. */
const ANY_PROJECT = `{ sourceTag: '*', onlyDependOnLibsWithTags: ['*'] }`;

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
    `// Enforced by \`${RULE}\`: these join the workspace's own (\`${OPTIONS}\`).`,
    `// What lint says:`,
    `//   'A project tagged with "platform:…" can only depend on libs tagged with …' — the project it imports has no`,
    `//     platform (or another one). Classify it — inferred from its imports, or stated:`,
    `//       ${nx} g @bespunky/nx-tools:platform <project> [--platform=web|server|shared]`,
    `//   'A project without tags matching at least one constraint cannot depend on any libraries' — THIS project has`,
    `//     no platform: the same command, for it. \`${nx} sync\` classifies every project whose evidence settles it.`,
    `//   '… is not allowed to import "<package>"' — that package belongs to another platform: move the code into a`,
    `//     project of that platform, or re-classify this one. Never widen these lists to make it pass.`,
    `// Not judged: tests and the tools' own configs (they never ship), and in a platform:web project the server half`,
    `// of SSR (src/server.ts, src/server/**), which runs only in Node — the blocks at the end of this config.`,
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

/** The workspace's own options, hoisted, and the one function every block builds the rule's entry with. */
function optionsDeclaration(options: string, severity: string): string[] {
  return [
    `// ${RULE} — ONE rule instance, and these are this workspace's own options for it: an`,
    `// exemption (\`allow\`, \`ignoredCircularDependencies\`, …) or a constraint of its own goes HERE. Every`,
    `// block that configures the rule builds its entry with \`${ENTRY}(…)\`, which adds the platform`,
    `// constraints for that block's files — so these options hold in all of them.`,
    `const ${OPTIONS} = ${options};`,
    `const ${ENTRY} = (platform) => [${severity}, { ...${OPTIONS}, depConstraints: [...(${OPTIONS}.depConstraints ?? []), ...platform] }];`,
  ];
}

/** The rule's entry for the files that ship — what replaces the workspace's own entry. */
const SHIPPING_ENTRY = `${ENTRY}(${CONSTRAINTS})`;

/**
 * The block that holds every linted file to the firewall — the FIRST element of the exported array, so any block of
 * the workspace's own after it (its entry for the rule, an override for one folder) still decides for its files. It
 * is what makes the firewall cover every extension Nx lints (`.mts`, `.cjs`, …) even where the workspace's own block
 * lists fewer. `plugin` (the plugin's local name) when the config registers the rule's plugin nowhere it can see.
 */
function coverageBlock(plugin?: string): string[] {
  return [
    `// ${MARKER} (house) — \`${CONSTRAINTS}\` on every linted file; a block below may still narrow it.`,
    `{`,
    `  files: [${quoted(LINTED_FILES)}],`,
    ...(plugin ? [`  plugins: { '@nx': ${plugin} },`] : []),
    `  rules: { '${RULE}': ${SHIPPING_ENTRY} },`,
    `}`,
  ];
}

/** The file-scoped blocks — the LAST elements of the exported array, comma-separated, no trailing comma. */
function scopedBlocks(): string[] {
  const relaxedWeb = `${CONSTRAINTS}.map((c) => (c.sourceTag === '${platformTag('web')}' ? { sourceTag: c.sourceTag } : c))`;
  return [
    `// ${MARKER} (house) — the same rule, scoped by file (\`${ENTRY}\` keeps the own options).`,
    `// The server half of an SSR web app runs only in Node: there, platform:web may reach server code too.`,
    `{`,
    `  files: [${quoted(SSR_SERVER_FILES)}],`,
    `  rules: { '${RULE}': ${ENTRY}(${relaxedWeb}) },`,
    `},`,
    `// Tests and the tools' own configs never ship: the firewall does not judge them (any project may reach any).`,
    `{`,
    `  files: [${quoted(TEST_FILES)}],`,
    `  rules: { '${RULE}': ${ENTRY}([${ANY_PROJECT}]) },`,
    `},`,
    `{`,
    `  files: [${quoted(TOOL_CONFIG_FILES.files)}],`,
    `  ignores: [${quoted(TOOL_CONFIG_FILES.ignores)}],`,
    `  rules: { '${RULE}': ${ENTRY}([${ANY_PROJECT}]) },`,
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
    ...optionsDeclaration(`{ /* your options for ${RULE}, without ${ANY_PROJECT} */ }`, `'error'`),
    '',
    'export default [',
    ...coverageBlock().map((line, i, all) => `  ${line}${i === all.length - 1 ? ',' : ''}`),
    '  // … your config — where it configures the rule, the entry becomes:',
    `  //   rules: { '${RULE}': ${SHIPPING_ENTRY} },`,
    ...scopedBlocks().map((line) => `  ${line}`),
    '];',
  ].join('\n');
}

const tableBans = (externals: PlatformExternals): Record<Platform, string[]> => ({
  web: bannedFor('web', externals),
  server: bannedFor('server', externals),
  shared: bannedFor('shared', externals),
});

/** Is the 0.50 firewall already in this config? */
export const hasPlatformFirewall = (source: string): boolean => new RegExp(`\\b${CONSTRAINTS}\\b`).test(source);

/** What a writer did to the config — or why it would not touch it (the caller then prints `firewallSnippet`). */
export type FirewallEdit =
  | {
      source: string;
      /** What changed, one line each — for the log. Empty: the config already carries the firewall. */
      changes: string[];
      /** What the project had declared that the house carried, removed or could not carry — for the report. */
      notes: string[];
    }
  | { refused: string };

/**
 * Insert the whole firewall into a config that declares none. Unchanged (no `changes`) when the firewall — or the
 * 0.49 shape, which is the migration's to upgrade — is already there; `refused` when the config cannot be edited
 * safely (no `export default [ … ]`, the rule configured in more than one place or by an expression, no usable
 * TypeScript) — the reason says which.
 */
export function insertPlatformFirewall(source: string, sourcePath: string, externals: PlatformExternals, nx: string): FirewallEdit {
  if (hasPlatformFirewall(source) || legacyConstraints(source, sourcePath)?.length) return { source, changes: [], notes: [] };
  return spliceFirewall(source, sourcePath, tableBans(externals), nx, []);
}

/**
 * Bring a 0.49 firewall (two ban-only constraints, web and server, inside the project's own `depConstraints`) to the
 * 0.50 shape: those constraints and the old comment are REMOVED, and the firewall is written into the same rule. The
 * project's own edits to the old ban lists are carried: what it added stays banned, what it removed stays allowed
 * (both reported); any other key it gave those constraints is reported, not guessed at. `null` when the config
 * carries no 0.49 platform constraint (nothing to upgrade).
 */
export function upgradePlatformFirewall(source: string, sourcePath: string, externals: PlatformExternals, nx: string): FirewallEdit | null {
  if (hasPlatformFirewall(source)) return null;
  const legacy = legacyConstraints(source, sourcePath);
  if (legacy === null) return { refused: 'no usable TypeScript to read it with' };
  if (!legacy.length) return null;

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
  const edit = spliceFirewall(source, sourcePath, bans, nx, removals);
  if ('refused' in edit) return edit;
  return {
    source: edit.source,
    changes: [
      `replaced the two ban-only platform constraints in ${RULE} with the firewall, ${CONSTRAINTS}: each platform now depends only on its own and shared projects, platform:shared added`,
      ...edit.changes,
    ],
    notes: [...notes, ...edit.notes],
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

const keyOf = (ts: ClassicTypeScript, property: TsPropertyAssignment): string =>
  ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : '';

function readConstraints(ts: ClassicTypeScript, array: TsArrayLiteralExpression, source = '', sf?: TsSourceFile): DeclaredConstraint[] {
  const found: DeclaredConstraint[] = [];
  for (const element of array.elements) {
    if (!ts.isObjectLiteralExpression(element)) continue;
    let platform: Platform | undefined;
    let banned: string[] | null = null;
    const otherKeys: string[] = [];
    for (const property of element.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = keyOf(ts, property);
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
    if (ts.isPropertyAssignment(node) && keyOf(ts, node) === 'depConstraints' && ts.isArrayLiteralExpression(node.initializer)) {
      found.push(...readConstraints(ts, node.initializer, source, sf));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** The workspace's own entry for the rule: its severity's text and its options object, if it has one. */
interface RuleEntry {
  /** The entry's value — the span the firewall replaces with `moduleBoundaries(platformConstraints)`. */
  value: TsNode;
  severity: string;
  options: TsObjectLiteralExpression | null;
}

/** Every `'@nx/enforce-module-boundaries': …` in the config — or the reason one of them cannot be read. */
function ruleEntries(ts: ClassicTypeScript, sf: TsSourceFile, source: string): RuleEntry[] | { refused: string } {
  const entries: RuleEntry[] = [];
  let refused: string | undefined;
  const text = (node: TsNode) => source.slice(node.getStart(sf), node.getEnd());
  const visit = (node: TsNode): void => {
    if (ts.isPropertyAssignment(node) && keyOf(ts, node) === RULE) {
      const value = node.initializer;
      if (ts.isStringLiteral(value)) entries.push({ value, severity: text(value), options: null });
      else if (ts.isArrayLiteralExpression(value) && value.elements.length >= 1 && value.elements.length <= 2) {
        const options = value.elements[1];
        if (options && !ts.isObjectLiteralExpression(options)) refused = `its ${RULE} options are an expression (\`${text(options)}\`), not an object this can extend`;
        else entries.push({ value, severity: text(value.elements[0]), options: options && ts.isObjectLiteralExpression(options) ? options : null });
      } else refused = `its ${RULE} entry is \`${text(value)}\`, not a [severity, options] pair this can extend`;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (refused) return { refused };
  if (entries.length > 1) return { refused: `it configures ${RULE} in ${entries.length} places — one entry is what the firewall joins` };
  return entries;
}

/** Is this constraint Nx's stock catch-all — `sourceTag: '*'`, `onlyDependOnLibsWithTags: ['*']`, nothing else? */
function isStockCatchAll(ts: ClassicTypeScript, element: TsNode): boolean {
  if (!ts.isObjectLiteralExpression(element) || element.properties.length !== 2) return false;
  const values = new Map<string, TsNode>();
  for (const property of element.properties) if (ts.isPropertyAssignment(property)) values.set(keyOf(ts, property), property.initializer);
  const source = values.get('sourceTag');
  const only = values.get('onlyDependOnLibsWithTags');
  return (
    !!source && ts.isStringLiteral(source) && source.text === '*' &&
    !!only && ts.isArrayLiteralExpression(only) && only.elements.length === 1 && ts.isStringLiteral(only.elements[0]) && only.elements[0].text === '*'
  );
}

/** Does a constraint match EVERY project (`sourceTag: '*'`)? — then an untagged project is never "without tags". */
function matchesEveryProject(ts: ClassicTypeScript, element: TsNode): boolean {
  if (!ts.isObjectLiteralExpression(element)) return false;
  return element.properties.some((p) => ts.isPropertyAssignment(p) && keyOf(ts, p) === 'sourceTag' && ts.isStringLiteral(p.initializer) && p.initializer.text === '*');
}

/** The `depConstraints` array of an options object, if it is a literal one. */
function constraintsOf(ts: ClassicTypeScript, options: TsObjectLiteralExpression): TsArrayLiteralExpression | null {
  for (const property of options.properties) {
    if (ts.isPropertyAssignment(property) && keyOf(ts, property) === 'depConstraints' && ts.isArrayLiteralExpression(property.initializer)) return property.initializer;
  }
  return null;
}

/**
 * Write the firewall: the `platformConstraints` declaration and the workspace's hoisted options above the
 * `export default` statement, the workspace's entry for the rule replaced by `moduleBoundaries(platformConstraints)`
 * (or, when it configures the rule nowhere, a block of the firewall's own), the scoped blocks after the exported
 * array's last element — plus any `extra` removals (the upgrade's), applied in the same pass, inside the hoisted
 * options or elsewhere.
 */
function spliceFirewall(
  source: string,
  sourcePath: string,
  bans: Readonly<Record<Platform, readonly string[]>>,
  nx: string,
  extra: StringChange[],
): FirewallEdit {
  const ts = loadTypeScript();
  if (!ts) return { refused: 'no usable TypeScript to read it with' };
  const sf = parse(ts, source, sourcePath);
  const exported = exportedArray(ts, sf);
  if (!exported) return { refused: 'it has no `export default [ … ]` (or `export default fn([ … ])`) to extend' };
  for (const name of [OPTIONS, ENTRY]) {
    if (identifierUsed(ts, sf, name)) return { refused: `it already uses the name \`${name}\`, which the firewall declares` };
  }
  const entries = ruleEntries(ts, sf, source);
  if ('refused' in entries) return entries;
  const entry = entries[0];
  const { statement, array } = exported;

  const changes: string[] = [];
  const notes: string[] = [];
  const edits: StringChange[] = [];
  let severity = `'error'`;
  let options = '{}';
  let plugin: string | undefined;

  if (entry) {
    const value = { start: entry.value.getStart(sf), end: entry.value.getEnd() };
    const inValue = (change: StringChange) => change.type === ChangeType.Delete && change.start >= value.start && change.start + change.length <= value.end;
    edits.push(...extra.filter((change) => !inValue(change)));
    if (/^(['"]off['"]|0)$/.test(entry.severity)) notes.push(`${RULE} was off; the firewall turns it on ('error') with this workspace's own options`);
    else severity = entry.severity;
    if (entry.options) {
      const at = entry.options.getStart(sf);
      const inner: StringChange[] = extra.filter(inValue).map((change) => ({ ...change, start: (change as { start: number }).start - at }) as StringChange);
      const constraints = constraintsOf(ts, entry.options);
      for (const element of constraints?.elements ?? []) {
        if (isStockCatchAll(ts, element)) {
          const span = removableSpan(source, element.getStart(sf), element.getEnd());
          inner.push({ type: ChangeType.Delete, start: span.start - at, length: span.end - span.start });
          changes.push(
            `removed Nx's stock catch-all ${ANY_PROJECT} from ${OPTIONS}: it forbade nothing and exempted every untagged project from the firewall (tests and tool configs keep it)`,
          );
        } else if (matchesEveryProject(ts, element)) {
          notes.push(
            `kept this workspace's own \`sourceTag: '*'\` constraint (\`${source.slice(element.getStart(sf), element.getEnd())}\`) — every project matches it, so an ` +
              `untagged one is not reported as having no platform; the classifier's report is then the only place that says so`,
          );
        }
      }
      // An emptied list collapses to `[]` rather than keeping the lines its constraints stood on.
      options = dedent(applyChangesToString(source.slice(at, entry.options.getEnd()), inner), indentOfLineAt(source, at)).replace(/(depConstraints:\s*)\[\s*\]/, '$1[]');
    }
    edits.push({ type: ChangeType.Delete, start: value.start, length: value.end - value.start }, { type: ChangeType.Insert, index: value.start, text: SHIPPING_ENTRY });
    changes.unshift(`hoisted this workspace's own ${RULE} options into ${OPTIONS}; its entry is now ${SHIPPING_ENTRY} — one rule instance, every exemption honoured`);
  } else {
    edits.push(...extra);
    const pluginImport = defaultImportOf(ts, sf, PLUGIN);
    plugin = pluginImport ?? (identifierUsed(ts, sf, 'nx') ? 'nxPlugin' : 'nx');
    if (!pluginImport) {
      const imports = sf.statements.filter((s) => ts.isImportDeclaration(s));
      const at = imports.length ? imports[imports.length - 1].getEnd() : 0;
      edits.push({ type: ChangeType.Insert, index: at, text: imports.length ? `\nimport ${plugin} from '${PLUGIN}';` : `import ${plugin} from '${PLUGIN}';\n\n` });
    }
    changes.unshift(`configured ${RULE} (it was configured nowhere) with the firewall's constraints on every linted file`);
  }
  changes.push(`scoped by file: tests and tool configs are not judged; the SSR server half of a web app may reach server code`);

  const statementStart = lineStart(source, statement.getStart(sf));
  const blankBefore = statementStart === 0 || /\n[ \t]*\n$/.test(source.slice(0, statementStart)) ? '' : '\n';
  const declarations = [...constraintsDeclaration(bans, nx), '', ...optionsDeclaration(options, severity)];
  edits.push({ type: ChangeType.Insert, index: statementStart, text: `${blankBefore}${declarations.join('\n')}\n\n` });

  // The coverage block goes before the first element, at its indentation; the scoped blocks after the last element
  // (past its trailing comma, if any). Into an empty array, all of them one level inside it — never just before `]`,
  // which leaves `}\n   ,` wherever prettier is absent.
  const elements = array.elements;
  const first = elements.length ? elements[0] : null;
  const last = elements.length ? elements[elements.length - 1] : null;
  const indent = first ? indentOfLineAt(source, first.getStart(sf)) : `${indentOfLineAt(source, array.getStart(sf))}  `;
  const lines = (block: string[]) => block.map((line) => `${indent}${line}`).join('\n');
  if (first && last) {
    edits.push({ type: ChangeType.Insert, index: first.getStart(sf), text: `${lines(coverageBlock(plugin)).trimStart()},\n${indent}` });
    const afterLast = elements.hasTrailingComma ? source.indexOf(',', last.getEnd()) + 1 : last.getEnd();
    edits.push({ type: ChangeType.Insert, index: afterLast, text: `${elements.hasTrailingComma ? '' : ','}\n${lines(scopedBlocks())}${elements.hasTrailingComma ? ',' : ''}` });
  } else {
    const all = [...coverageBlock(plugin).map((line, i, block) => (i === block.length - 1 ? `${line},` : line)), ...scopedBlocks()];
    edits.push({ type: ChangeType.Insert, index: array.getStart(sf) + 1, text: `\n${lines(all)},\n${indentOfLineAt(source, array.getStart(sf))}` });
  }
  return { source: applyChangesToString(source, edits), changes, notes };
}

/** Move a nested block of text to the top level: every line after the first loses `indent`. */
function dedent(text: string, indent: string): string {
  return text
    .split('\n')
    .map((line, i) => (i > 0 && line.startsWith(indent) ? line.slice(indent.length) : line))
    .join('\n');
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
