// THE PLATFORM — where a project's code runs, and so which code it may reach.
//
// Every project in a house workspace carries exactly ONE `platform:` tag:
//
//   platform:web     browser / SSR code (an Angular app or library, the design system, the navigation kernel)
//   platform:server  server-only code (Cloud Functions, the emulator suite, anything on firebase-admin)
//   platform:shared  isomorphic code — runs anywhere, so it may use nothing that belongs to one platform
//
// The three form a tiny lattice with `shared` at the bottom: code built only from shared parts is shared; add
// one web part and it is web; parts of BOTH is not a platform at all — it is the leak the firewall exists to stop
// (firebase-admin reaching a browser bundle). `join` is that rule, and the classifier is just `join` over the
// evidence. The ESLint firewall that enforces it is ./firewall; the classifier that infers it is ./classify.
//
// Why a tag and not a convention: `@nx/enforce-module-boundaries` keys every constraint on a tag. A project
// without one matches no platform constraint, and was — before 0.50.0 — silently outside the firewall.
import { type Tree, joinPathFragments, readProjectConfiguration } from '@nx/devkit';
import { updateJsonInPlace } from '../generators/_utils/json-edits';

export const PLATFORMS = ['web', 'server', 'shared'] as const;
export type Platform = (typeof PLATFORMS)[number];

const PREFIX = 'platform:';

/** `platform:<id>` — the tag the ESLint firewall keys on. */
export const platformTag = (platform: Platform): string => `${PREFIX}${platform}`;

export const isPlatform = (value: unknown): value is Platform => PLATFORMS.includes(value as Platform);

/** What each platform is, in one line — the ESLint comment, HOUSE.md and the generator's messages all say it so. */
export const PLATFORM_MEANING: Readonly<Record<Platform, string>> = {
  web: 'browser / SSR code — may depend on web and shared projects',
  server: 'server-only code (Cloud Functions, Node) — may depend on server and shared projects',
  shared: 'isomorphic code — may depend on shared projects only, and import no platform-specific package',
};

/** The platforms a project of `platform` may depend on. */
export const reachable = (platform: Platform): Platform[] => (platform === 'shared' ? ['shared'] : [platform, 'shared']);

/** A comma-separated tag option (`--tags=a,b`) as a list. */
export const csvTags = (tags: string | undefined): string[] => (tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean);

/** The platform a tag list declares — undefined when none; throws when it declares two (a project has ONE). */
export function platformOf(tags: readonly string[] | undefined): Platform | undefined {
  const declared = [...new Set((tags ?? []).filter((tag) => tag.startsWith(PREFIX)).map((tag) => tag.slice(PREFIX.length)))];
  if (declared.length > 1) throw new Error(`A project has exactly one platform, but these tags declare ${declared.join(' and ')}.`);
  return declared[0] as Platform | undefined;
}

/** `tags` with `platform` as its one platform tag (any other platform tag replaced; the rest kept, in order). */
export function withPlatform(tags: readonly string[] | undefined, platform: Platform): string[] {
  return [...new Set([...(tags ?? []).filter((tag) => !tag.startsWith(PREFIX)), platformTag(platform)])];
}

/**
 * Join two pieces of evidence: shared is the bottom, two different platforms are a conflict (`null`). `null` is
 * absorbing — once a project mixes platforms, nothing it imports can make it whole again.
 */
export function join(a: Platform | null, b: Platform | null): Platform | null {
  if (a === null || b === null) return null;
  if (a === 'shared') return b;
  if (b === 'shared' || a === b) return a;
  return null;
}

/**
 * Classify a project: set its ONE platform tag in its own definition file — project.json, or package.json's `nx`
 * block. Written to the file's own `tags` and nothing else: round-tripping a package.json-defined project through
 * `updateProjectConfiguration` would write everything Nx INFERS for it (targets from scripts, `npm:` tags) back
 * into its `nx` block. Edited in place (../generators/_utils/json-edits.ts): a hand-written compact file keeps its form,
 * and only the tag changes. Returns whether anything changed.
 */
export function setProjectPlatform(tree: Tree, project: string, platform: Platform): boolean {
  const { root } = readProjectConfiguration(tree, project);
  const projectJson = joinPathFragments(root, 'project.json');
  const file = tree.exists(projectJson) ? projectJson : joinPathFragments(root, 'package.json');
  if (!tree.exists(file)) throw new Error(`\`${project}\` has no project.json or package.json at ${root} to tag.`);
  return updateJsonInPlace<{ tags?: string[]; nx?: { tags?: string[] } }>(tree, file, (json) => {
    const holder = file === projectJson ? json : (json.nx ??= {});
    holder.tags = withPlatform(holder.tags, platform);
  });
}
