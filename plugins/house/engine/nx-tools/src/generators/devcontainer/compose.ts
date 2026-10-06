// THE COMPOSER — layer fragments in, devcontainer.json text and post-create.sh text out.
//
// The devcontainer used to be one mustache template with a conditional block per layer flag (`web`, `angular`,
// `firebase`) and a static post-create script that sniffed the workspace at run time. Every new stack meant an
// edit in both, and everything not behind a flag landed in EVERY container: a Python repo got a typescript-node
// image, a node_modules volume and a `yarn install`, and every container got the shared browser's X stack.
//
// Now each LAYER states its share as data (`descriptor.devcontainer`, see layers/descriptor.ts) and this module
// composes the shares of the active layers — in registry order, then the voice intent's — by one rule per field:
//
//   image          the LAST contributor wins (a stack layer specialises the neutral base), with its own features
//   features …     concatenated, first occurrence of a key wins (de-duplicated)
//   ports          merged by number: `forward` OR-ed, label/behaviour/why from the first contributor
//   path           ONE `remoteEnv.PATH`: every layer's directories, registry order, ahead of the image's PATH
//   osPackages     ONE list, de-duplicated, each group commented with its `why`, embedded in the one installer
//                  (house.packages.sh) the image build runs as a cached layer — and post-create, for what is missing
//   postCreate     pieces run by phase (prepare → OS packages (missing only) → install → plugins → provision), registry order,
//                  after ONE derived section that reclaims every volume's ownership (see `volumeOwnership`)
//
// It is pure: no Tree, no filesystem writes. The generator decides ownership and merging; this decides content.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseJson } from '@nx/devkit';
import type {
  DevcontainerFragment,
  DevcontainerJson,
  DevcontainerPort,
  PostCreatePhase,
  PostCreatePiece,
  VolumeOwnership,
} from '../../layers/descriptor';
import type { ClaudePlugins } from '../_utils/layer-contributions';
import { packageManagerShellDetection } from '../_utils/package-manager';

export interface Contributor {
  /** A layer id, or an intent's name (`voice`). */
  id: string;
  fragment: DevcontainerFragment;
}

interface Why {
  why?: string;
}

/** A port after merging every layer that names it. */
type ComposedPort = Pick<DevcontainerPort, 'port' | 'label' | 'onAutoForward' | 'requireLocalPort' | 'why'> & { forward: boolean };

/** The active fragments, resolved into one devcontainer — tokens substituted, collections merged. */
export interface Composition {
  image: { ref: string; remoteUser: string } & Why;
  /** What the container runs on — see `ImageSource`. */
  imageSource: ImageSource;
  home: string;
  /** The image's own features (installed first — the runtime the rest of the features may need). */
  imageFeatures: ({ id: string; options: Record<string, DevcontainerJson> } & Why)[];
  features: ({ id: string; options: Record<string, DevcontainerJson> } & Why)[];
  extensions: string[];
  settings: ({ key: string; value: DevcontainerJson } & Why)[];
  mounts: ({ mount: string; ownership?: VolumeOwnership } & Why)[];
  /** Every `type=volume` mount point and its ownership policy — what the post-create's first section reclaims. */
  volumes: ComposedVolume[];
  remoteEnv: ({ name: string; value: string } & Why)[];
  containerEnv: ({ name: string; value: string } & Why)[];
  runArgs: ({ args: string[] } & Why)[];
  ports: ComposedPort[];
  initializeCommand: ({ name: string; command: string } & Why)[];
  osPackages: ({ packages: string[] } & Why)[];
  postCreate: (PostCreatePiece & { from: string })[];
}

/**
 * A volume mount point, as the post-create addresses it: `root` is the shell variable it lies under (`$WS`, the
 * workspace; `$HOME`, the remote user's home) — so the script follows the container it actually runs in — or
 * `null` for an absolute path outside both (allowed only with a DECLARED policy).
 */
export interface ComposedVolume {
  root: '$WS' | '$HOME' | null;
  /** The path below `root` (or the absolute path when `root` is null). */
  path: string;
  ownership: VolumeOwnership;
}

/** The order the composed post-create runs its phases in; the OS packages step (missing only) runs between `prepare` and `install`. */
const PHASES: readonly PostCreatePhase[] = ['prepare', 'install', 'plugins', 'provision'];

/**
 * What the container runs on, as the house sees it — ONE value, so a state like "built from the house Dockerfile but
 * running as a foreign image's user" cannot be expressed:
 *   build      — BUILT from `HOUSE_DOCKERFILE` (a devcontainer the house owns or creates, or an adopted one switched
 *                to it). The house emits `build` and its `remoteUser`.
 *   house-ref  — an ADOPTED devcontainer whose own image source names the house's image: the house adds no second
 *                source beside it, but knows the image — its user, and that nothing lives in its home.
 *   foreign    — an ADOPTED devcontainer's own image (or build, or Compose): no `build`, no `remoteUser` (the image
 *                may not have the house's user), every `{{home}}` token follows `runsAs`, and no mount that would
 *                overlay what that image may ship in its home (`onHouseImageOnly`).
 */
export type ImageSource = { kind: 'build' } | { kind: 'house-ref' } | { kind: 'foreign'; runsAs: string };

export function compose(
  contributors: readonly Contributor[],
  tokens: { nodeMajor: string; imageSource?: ImageSource },
): Composition {
  const source: ImageSource = tokens.imageSource ?? { kind: 'build' };
  // The image first, because `{{home}}` — which other fragments use — follows its user.
  const imageSource = [...contributors].reverse().find((entry) => entry.fragment.image);
  if (!imageSource) {
    throw new Error('[devcontainer] No active layer declares a base image — the `agent` layer always should.');
  }
  const { features: imageFeatureList, ...image } = imageSource.fragment.image!;
  const remoteUser = source.kind === 'foreign' ? source.runsAs : image.remoteUser;
  const home = homeOf(remoteUser);
  const sub = (value: string) =>
    value.split('{{home}}').join(home).split('{{remoteUser}}').join(remoteUser).split('{{nodeMajor}}').join(tokens.nodeMajor);
  const subJson = (value: DevcontainerJson): DevcontainerJson => {
    if (typeof value === 'string') return sub(value);
    if (Array.isArray(value)) return value.map(subJson);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, subJson(inner as DevcontainerJson)]));
    }
    return value;
  };

  const all = <K extends keyof DevcontainerFragment>(key: K) =>
    contributors.flatMap((entry) => ((entry.fragment[key] ?? []) as readonly unknown[]).map((item) => ({ item, from: entry.id })));

  /** First occurrence of each key wins — two layers asking for the same extension or mount mean one entry. */
  const unique = <T>(items: T[], keyOf: (item: T) => string): T[] => {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = keyOf(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const feature = (entry: { id: string; options?: { readonly [key: string]: DevcontainerJson }; why?: string }) => ({
    id: entry.id,
    options: subJson((entry.options ?? {}) as DevcontainerJson) as Record<string, DevcontainerJson>,
    why: entry.why,
  });

  const imageFeatures = (imageFeatureList ?? []).map(feature);
  const features = unique(
    all('features').map(({ item }) => feature(item as Parameters<typeof feature>[0])),
    (entry) => entry.id,
  ).filter((entry) => !imageFeatures.some((own) => own.id === entry.id));

  const ports = new Map<number, ComposedPort>();
  for (const { item } of all('ports')) {
    const port = item as DevcontainerPort;
    const have = ports.get(port.port);
    if (!have) {
      ports.set(port.port, { ...port, label: sub(port.label), forward: !!port.forward });
      continue;
    }
    have.forward = have.forward || !!port.forward;
    have.why = have.why ?? port.why;
  }

  // PATH is composed, never declared: a layer's own `remoteEnv.PATH` would win or lose against another's by
  // registry order alone, dropping a directory without a word. So the field is refused, and `path` builds it.
  const declaredPath = all('remoteEnv').find(({ item }) => (item as { name: string }).name === 'PATH');
  if (declaredPath) {
    throw new Error(
      `[devcontainer] \`${declaredPath.from}\` sets remoteEnv.PATH — contribute its directories through \`path\` instead, ` +
        'so every layer\'s entries compose into the one PATH.',
    );
  }
  const pathDirs = unique(
    all('path').map(({ item }) => ({ ...(item as { dir: string; why?: string }) })),
    (entry) => entry.dir,
  ).map((entry) => ({ ...entry, dir: sub(entry.dir) }));
  const composedPath = pathDirs.length
    ? [
        {
          name: 'PATH',
          value: [...pathDirs.map((entry) => entry.dir), '${containerEnv:PATH}'].join(':'),
          why: pathDirs
            .filter((entry) => entry.why)
            .map((entry) => `${entry.dir}: ${entry.why}`)
            .join('\n') || undefined,
        },
      ]
    : [];

  const mounts = unique(
    all('mounts')
      .filter(({ item }) => !(source.kind === 'foreign' && (item as { onHouseImageOnly?: boolean }).onHouseImageOnly))
      .map(({ item }) => {
        const entry = item as { mount: string; ownership?: VolumeOwnership; why?: string };
        return { mount: sub(entry.mount), ...(entry.ownership ? { ownership: entry.ownership } : {}), why: entry.why };
      }),
    (entry) => mountField(entry.mount, 'target') ?? entry.mount,
  );

  return {
    image: { ref: sub(image.ref), remoteUser, why: image.why },
    imageSource: source,
    home,
    imageFeatures,
    features,
    extensions: unique(all('extensions').map(({ item }) => item as string), (id) => id.toLowerCase()),
    settings: unique(
      all('settings').map(({ item }) => {
        const entry = item as { key: string; value: DevcontainerJson; why?: string };
        return { key: entry.key, value: subJson(entry.value), why: entry.why };
      }),
      (entry) => entry.key,
    ),
    mounts,
    volumes: mounts.flatMap((entry) => volumeOf(entry, home)),
    remoteEnv: [
      ...composedPath,
      ...unique(
        all('remoteEnv').map(({ item }) => ({ ...(item as { name: string; value: string; why?: string }) })),
        (entry) => entry.name,
      ).map((entry) => ({ ...entry, value: sub(entry.value) })),
    ],
    containerEnv: unique(
      all('containerEnv').map(({ item }) => ({ ...(item as { name: string; value: string; why?: string }) })),
      (entry) => entry.name,
    ).map((entry) => ({ ...entry, value: sub(entry.value) })),
    runArgs: all('runArgs').map(({ item }) => {
      const entry = item as { args: readonly string[]; why?: string };
      return { args: entry.args.map(sub), why: entry.why };
    }),
    ports: [...ports.values()],
    initializeCommand: unique(
      all('initializeCommand').map(({ item }) => ({ ...(item as { name: string; command: string; why?: string }) })),
      (entry) => entry.name,
    ),
    osPackages: all('osPackages')
      .filter(({ item }) => !(source.kind === 'foreign' && (item as { onHouseImageOnly?: boolean }).onHouseImageOnly))
      .map(({ item }) => {
        const entry = item as { packages: readonly string[]; why?: string };
        return { packages: [...entry.packages], why: entry.why };
      }),
    postCreate: unique(
      all('postCreate').map(({ item, from }) => ({ ...(item as PostCreatePiece), from })),
      (entry) => entry.piece,
    ),
  };
}

/** A container user's home directory — the one rule `{{home}}` resolves by (migrations reuse it). */
export function homeOf(user: string): string {
  return user === 'root' ? '/root' : `/home/${user}`;
}

/** One `key=value` field of a mount spec. */
function mountField(mount: string, key: string): string | undefined {
  return new RegExp(`(?:^|,)${key}=([^,]+)`).exec(mount)?.[1];
}

/** A path the post-create may write UNQUOTED-safe inside double quotes: no `$`, quote, backtick or backslash. */
const PLAIN_PATH = /^[A-Za-z0-9._/@+-]+$/;

/**
 * The ownership a `type=volume` mount needs (none for any other type). DERIVED, so a layer that adds a volume gets
 * its reclaim by declaring the mount — the bug this replaces was a hand-listed reclaim per layer that one layer
 * (`node`, whose `node_modules` volume failed every first install with EACCES) simply never had.
 */
function volumeOf(entry: { mount: string; ownership?: VolumeOwnership }, home: string): ComposedVolume[] {
  if (mountField(entry.mount, 'type') !== 'volume') return [];
  const target = (mountField(entry.mount, 'target') ?? '').replace(/\/+$/, '');
  const under = ([prefix, root]: readonly [string, ComposedVolume['root']]) =>
    target.startsWith(`${prefix}/`) ? { root, path: target.slice(prefix.length + 1) } : undefined;
  const located = ([['${containerWorkspaceFolder}', '$WS'], [home, '$HOME']] as const).map(under).find(Boolean);
  const volume = located ?? { root: null, path: target };
  if (!PLAIN_PATH.test(volume.path) || volume.path.split('/').includes('..')) {
    throw new Error(`[devcontainer] Volume target \`${target}\` is not a plain path the post-create can reclaim.`);
  }
  if (!located && !entry.ownership) {
    throw new Error(
      `[devcontainer] Volume target \`${target}\` lies outside the workspace and the remote user's home, so whose it ` +
        `is cannot be derived — declare its \`ownership\` on the mount fragment.`,
    );
  }
  return [{ ...volume, ownership: entry.ownership ?? 'user' }];
}

// ── devcontainer.json ──────────────────────────────────────────────────────────────────────────────────────────

/** A JSONC tree whose members may carry a leading comment. */
type Node = { value: DevcontainerJson } | { members: Member[] } | { items: Item[] };
interface Member {
  key: string;
  node: Node;
  why?: string;
}
interface Item {
  node: Node;
  why?: string;
}

/**
 * The house Dockerfile, beside devcontainer.json (the build context is that folder). Named so it can never collide
 * with a project's own `Dockerfile`: the house writes it unconditionally, and a project's file is never the house's.
 */
export const HOUSE_DOCKERFILE = 'house.Dockerfile';

/** The id of the one LOCAL feature — see the generator's `writeHouseSetupFeature`. */
export const HOUSE_FEATURE_ID = './features/bespunky-house-setup';

/**
 * THE FINGERPRINT the 0.24.x ownership migrations look for: the first line of every devcontainer.json the house
 * has ever RENDERED (the merge path never writes comment prose, so this line means "render() produced it").
 */
const HEADER = [
  'BeSpunky-standard devcontainer.',
  '',
  'COMPOSED from this project\'s layers ({{LAYERS}}) by @bespunky/nx-tools:devcontainer — each layer contributes its',
  'share (image, features, extensions, mounts, ports, …) and a sync recomposes the file from the layers it detects.',
  'Keys the house does not manage, and your comments, survive every sync; a house key you change is re-asserted.',
];

export function renderDevcontainerJson(name: string, layers: readonly string[], c: Composition): string {
  const members: Member[] = [];
  const add = (key: string, node: Node | undefined, why?: string) => {
    if (node) members.push({ key, node, why });
  };
  const value = (v: DevcontainerJson): Node => ({ value: v });
  const map = <T>(entries: T[], member: (entry: T) => Member): Node | undefined =>
    entries.length ? { members: entries.map(member) } : undefined;
  const list = <T>(entries: T[], item: (entry: T) => Item): Node | undefined =>
    entries.length ? { items: entries.map(item) } : undefined;

  add('name', value(name));
  if (c.imageSource.kind === 'build') {
    add(
      'build',
      { members: [{ key: 'dockerfile', node: value(HOUSE_DOCKERFILE) }, { key: 'context', node: value('.') }] },
      [
        c.image.why,
        `BUILT, not pulled: ${HOUSE_DOCKERFILE} starts FROM ${c.image.ref} and installs the OS packages (the house's,`,
        'composed from the layers, and .devcontainer/os-packages.txt, yours) as ONE Docker layer — cached, so a rebuild',
        'reinstalls nothing unless a list changed.',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  const featureMember = (entry: Composition['features'][number]): Member => ({ key: entry.id, node: value(entry.options), why: entry.why });
  add('features', {
    members: [
      ...c.imageFeatures.map(featureMember),
      ...c.features.map(featureMember),
      {
        key: HOUSE_FEATURE_ID,
        node: value({}),
        why:
          'The one LOCAL feature (a `./` id is a PATH beside this file), written by the same generator. It INSTALLS\n' +
          'NOTHING: its postCreateCommand chains `.devcontainer/post-create.bespunky.sh` when that file exists —\n' +
          'where the house setup goes in a project whose own postCreateCommand runs something else. Feature\n' +
          'lifecycle commands are ADDITIVE (they run before this file\'s), so it is the one key that can run the\n' +
          'house setup in an adopted project without displacing what that project already runs.',
      },
    ],
  });
  if (c.imageFeatures.length) {
    // The image's own features carry the runtime the others may need (a feature may build on Node), so
    // they install first. Feature ids here are version-less, as the spec's examples write them.
    add(
      'overrideFeatureInstallOrder',
      value(c.imageFeatures.map((entry) => entry.id.replace(/:[^/:]+$/, ''))),
      'The base image\'s own runtime (Node) installs before every feature that may need it.',
    );
  }

  add('customizations', {
    members: [
      {
        key: 'vscode',
        node: {
          members: [
            { key: 'extensions', node: { items: c.extensions.map((id) => ({ node: value(id) })) } },
            { key: 'settings', node: { members: c.settings.map((entry) => ({ key: entry.key, node: value(entry.value), why: entry.why })) } },
          ],
        },
      },
    ],
  });

  add(
    'postCreateCommand',
    value('bash .devcontainer/post-create.sh'),
    'All post-create setup lives in .devcontainer/post-create.sh — COMPOSED from the same layers as this file —\nso this stays a one-liner.',
  );
  add(
    'initializeCommand',
    map(c.initializeCommand, (entry) => ({ key: entry.name, node: value(entry.command), why: entry.why })),
    'Runs ON THE HOST before the container is created. The OBJECT form on purpose: its entries are named and run\nside by side, so a project with its own initializeCommand keeps it under its own key.',
  );
  if (c.imageSource.kind !== 'foreign') add('remoteUser', value(c.image.remoteUser));
  add(
    'runArgs',
    list(
      c.runArgs.flatMap((group) => group.args.map((arg, index) => ({ arg, why: index === 0 ? group.why : undefined }))),
      (entry) => ({ node: value(entry.arg), why: entry.why }),
    ),
  );

  const forwarded = c.ports.filter((port) => port.forward);
  add(
    'forwardPorts',
    forwarded.length ? value(forwarded.map((port) => port.port)) : undefined,
    'Forwarded at the SAME host number — derived, with the labels below, from ONE port list, so a port can never\nbe forwarded without a label or labelled without being reachable.',
  );
  add(
    'portsAttributes',
    map(c.ports, (port) => ({
      key: String(port.port),
      node: value({
        label: port.label,
        onAutoForward: port.onAutoForward,
        ...(port.requireLocalPort ? { requireLocalPort: true } : {}),
      }),
      why: port.why,
    })),
    "Labels for the (forwarded or auto-detected) ports; `onAutoForward` sets each one's notification behaviour.",
  );
  add('otherPortsAttributes', value({ onAutoForward: 'silent' }));
  add('containerEnv', map(c.containerEnv, (entry) => ({ key: entry.name, node: value(entry.value), why: entry.why })));
  add(
    'remoteEnv',
    map(c.remoteEnv, (entry) => ({ key: entry.name, node: value(entry.value), why: entry.why })),
    'No CLAUDE_CODE_BYPASS_ALL_PERMISSIONS here: the permission mode is governed by .claude/settings.json\n(permissions.defaultMode: "auto"); a bypass env var would win over it.',
  );
  add('mounts', list(c.mounts, (entry) => ({ node: value(entry.mount), why: entry.why })));

  const header = HEADER.map((line) => line.split('{{LAYERS}}').join(layers.join(', ')))
    .map((line) => (line ? `// ${line}` : '//'))
    .join('\n');
  const text = `${header}\n${print({ members }, '')}\n`;

  // PROVE it parses — a composition bug must fail here, at generation time, not at somebody's next rebuild.
  try {
    parseJson(text);
  } catch (error) {
    throw new Error(`[devcontainer] The composed devcontainer.json is not valid JSONC: ${(error as Error).message}`);
  }
  return text;
}

function print(node: Node, indent: string): string {
  if ('value' in node) return inline(node.value);
  const inner = `${indent}  `;
  const entries: { text: string; why?: string }[] =
    'members' in node
      ? node.members.map((member) => ({ text: `${JSON.stringify(member.key)}: ${print(member.node, inner)}`, why: member.why }))
      : node.items.map((item) => ({ text: print(item.node, inner), why: item.why }));
  const [open, close] = 'members' in node ? ['{', '}'] : ['[', ']'];
  if (entries.length === 0) return `${open}${close}`;
  const body = entries
    .map((entry, index) => {
      const comment = entry.why ? `${entry.why.split('\n').map((line) => `${inner}// ${line}`.trimEnd()).join('\n')}\n` : '';
      const lead = index > 0 && entry.why && 'members' in node && indent === '' ? '\n' : '';
      return `${lead}${comment}${inner}${entry.text}`;
    })
    .join(',\n');
  return `${open}\n${body}\n${indent}${close}`;
}

/** A value on one line: `{ "a": 1 }`, `["x", "y"]` — how a human writes the small values of a devcontainer.json. */
function inline(value: DevcontainerJson): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length ? `{ ${entries.map(([key, inner]) => `${JSON.stringify(key)}: ${inline(inner as DevcontainerJson)}`).join(', ')} }` : '{}';
  }
  return JSON.stringify(value);
}

// ── post-create.sh ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ONE composed script, rather than a regenerated `post-create.d/NN-<layer>.sh` per layer — deliberately:
 *   - the provenance line, the beside-path for adopted projects and the chain feature all key on ONE file, so
 *     they keep working unchanged;
 *   - a layer that leaves takes its steps with it on the next sync, with no stale piece to garbage-collect;
 *   - the whole script is checked with `bash -n` here, before it is written.
 */
export function renderPostCreate(layers: readonly string[], c: Composition, plugins: ClaudePlugins): string {
  const piece = (name: string) => readFileSync(join(__dirname, 'post-create', `${name}.sh.tpl`), 'utf8').trimEnd();
  const sections: string[] = [piece('header').split('{{LAYERS}}').join(layers.join(', '))];

  const inPhase = (phase: PostCreatePhase) =>
    c.postCreate.filter((entry) => entry.phase === phase).map((entry) => renderPiece(piece(entry.piece), plugins, c.imageSource));

  if (c.volumes.length) sections.push(renderVolumeOwnership(piece('volume-ownership'), c.volumes));
  sections.push(...inPhase('prepare'));
  sections.push(piece('os-packages'));
  for (const phase of PHASES.slice(1)) sections.push(...inPhase(phase));
  sections.push(piece('footer'));

  const script = `${sections.join('\n\n')}\n`;
  proveShell(script, 'bash', 'post-create.sh');
  return script;
}

/**
 * `{{CHROMIUM_DEPS_FLAG}}`: on an image the house knows, Chromium's system libraries are image packages, so a browser
 * install needs no apt step (''); on a foreign image the house cannot know the distro, so Playwright installs them
 * from its OWN table for whatever runs there (' --with-deps').
 */
function renderPiece(text: string, plugins: ClaudePlugins, imageSource: ImageSource): string {
  return text
    .split('{{CHROMIUM_DEPS_FLAG}}')
    .join(imageSource.kind === 'foreign' ? ' --with-deps' : '')
    .split('{{PM_DETECT}}')
    .join(packageManagerShellDetection().replace(/^/gm, '  '))
    .split('{{MARKETPLACES}}')
    .join(plugins.marketplaces.map(([name, market]) => `${name} ${market.repo}`).join('\n'))
    .split('{{PLUGINS}}')
    .join(plugins.plugins.join(' '));
}

/**
 * One line per directory to reclaim: each `user` volume's mount point (`tree`, recursive) and every directory
 * between its root and it (`dir` — Docker created those too, and they hold more than the volume), de-duplicated
 * (`.nx/` sits on the way to two volumes) and shallowest first; then each `shared` volume.
 */
function renderVolumeOwnership(template: string, volumes: readonly ComposedVolume[]): string {
  const at = (volume: ComposedVolume, path: string) => (volume.root ? `${volume.root}/${path}` : path);
  const reclaim = new Map<string, 'tree' | 'dir'>();
  for (const volume of volumes.filter((entry) => entry.ownership === 'user')) {
    // Only under a root are the in-between directories Docker's doing; an absolute target's parents are the image's.
    const segments = volume.root ? volume.path.split('/') : [volume.path];
    segments.forEach((_, index) => {
      const path = at(volume, segments.slice(0, index + 1).join('/'));
      const scope = index === segments.length - 1 ? 'tree' : 'dir';
      if (reclaim.get(path) !== 'tree') reclaim.set(path, scope);
    });
  }
  const lines = [
    ...[...reclaim].map(([path, scope]) => `reclaim_volume ${scope} "${path}"`),
    ...volumes.filter((entry) => entry.ownership === 'shared').map((volume) => `share_volume "${at(volume, volume.path)}"`),
  ];
  return template.split('{{VOLUMES}}').join(lines.join('\n'));
}

/**
 * `.devcontainer/house.packages.sh` — the ONE installer the image build and post-create both run (see the template).
 * The house's packages are embedded, grouped by capability with each group's `why` as a comment, de-duplicated
 * across groups; the project's own list is the file it is handed.
 */
export function renderOsPackagesScript(groups: Composition['osPackages']): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const group of groups) {
    const fresh = group.packages.filter((name) => !seen.has(name));
    fresh.forEach((name) => seen.add(name));
    if (!fresh.length) continue;
    if (group.why) lines.push(...group.why.split('\n').map((line) => `# ${line}`.trimEnd()));
    lines.push(fresh.join(' '));
  }
  const script = readFileSync(join(__dirname, 'house.packages.sh.tpl'), 'utf8')
    .split('{{HOUSE_PACKAGES}}')
    // The list is one single-quoted shell string: a `'` in a why would end it early, so it is closed, escaped, reopened.
    .join(lines.join('\n').split("'").join("'\\''"));
  proveShell(script, 'sh', 'house.packages.sh');
  return script;
}

/** `.devcontainer/house.Dockerfile` — FROM the composed image, then the OS packages as one cached layer. */
export function renderHouseDockerfile(c: Composition): string {
  return readFileSync(join(__dirname, 'house.Dockerfile.tpl'), 'utf8').split('{{IMAGE}}').join(c.image.ref);
}

/**
 * `bash -n` the composed script — the shell counterpart of parsing devcontainer.json. Skipped (not failed) only
 * when no bash is reachable from the generator's own process, which says nothing about the script.
 */
/** Refuse to write a generated script its own shell cannot parse (when that shell is available to ask). */
function proveShell(script: string, shell: 'bash' | 'sh', name: string): void {
  const result = spawnSync(shell, ['-n'], { input: script, encoding: 'utf8' });
  if (result.error) return;
  if (result.status !== 0) {
    throw new Error(`[devcontainer] The composed ${name} does not parse under ${shell}:\n${result.stderr}`);
  }
}
