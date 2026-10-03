// 0.34.0 — retire the WSLg-only audio bridge that `--voice` wrote into `.devcontainer/devcontainer.json`.
//
// WHAT WAS WRONG WITH IT. Up to 0.33.x, voice bridged the container to the host's audio by bind-mounting
// `/mnt/wslg` and pointing `remoteEnv.PULSE_SERVER` at `unix:/mnt/wslg/PulseServer`. That path exists only
// on a WSL2 host, and Docker refuses a bind mount whose source is missing — so on plain Linux, macOS or
// Codespaces the container DOES NOT START. Worse, `voice: true` is committed in the ownership marker, so one
// developer's machine fact (this host has WSLg) became a repo fact that broke every teammate on another host.
// From 0.34.0 the generator writes a host-agnostic bridge instead: a host probe resolves wherever this host's
// PulseAudio socket lives, and the container always sees it at `/run/bespunky/host/pulse`.
//
// WHY A MIGRATION AND NOT JUST THE GENERATOR. Two populations the generator alone cannot fix:
//
//   1. ADOPTED devcontainers (`owned: false`). The generator merges into them additively and matches mounts by
//      their `target=` — the new bridge targets `/run/bespunky/host/pulse`, so it would land BESIDE the old
//      `/mnt/wslg` bind, which survives and still kills the container off WSL. And `PULSE_SERVER` is a scalar
//      the merge never overrides, so the old value would win over the new endpoint.
//   2. A bare `nx migrate --run-migrations` with no generator run after it. An owned devcontainer is
//      regenerated on the next sync, but until then it is exactly as broken; the migration must leave a
//      container that starts, on its own.
//
// So it runs on owned and adopted alike. It does NOT write the new bridge: that is generator-owned output,
// and the next sync with voice on adds it (for an adopted file, through the same additive merge).
//
// SCOPED TO THE EXACT HOUSE VALUES. Only the literal mount string and the literal PULSE_SERVER value the
// generator rendered are removed. Anything else touching WSLg is somebody's deliberate edit — notably the
// `/run/desktop/mnt/host/wslg` source the house comment itself told Docker Desktop users to swap in, or a
// PULSE_SERVER pointing at another socket under /mnt/wslg. Those are left in place and REPORTED, with the
// file and the reason, because deleting them would be a guess about somebody else's host.
//
// COMMENTS SURVIVE. Edits are text splices computed from jsonc-parser's syntax tree, never a re-serialisation:
// a devcontainer.json is where people explain why a mount exists, and re-writing the array would erase every
// one of those explanations. The house's own comment block directly above each removed entry goes with it —
// but only lines that match the house prose EXACTLY (the merge path never writes comments, so an adopted file
// has none; an owned one has precisely these). A project's own comment is never touched. jsonc-parser's
// `modify(…, undefined)` is NOT used for the common case, deliberately: deleting a middle array member, it
// removes the text up to the NEXT member's start — taking that member's leading comment with it.
//
// SELF-CONTAINED by the migration contract: the house literals are frozen here as 0.33.x wrote them.
import { type Tree, logger } from '@nx/devkit';
import { type Node, applyEdits, findNodeAtLocation, getNodeValue, modify, parseTree } from 'jsonc-parser';

const TAG = '[retire-wslg-audio-bridge]';

/** The only devcontainer.json any version of the generator has written. */
const DEVCONTAINER = '.devcontainer/devcontainer.json';
const FEATURES = '.devcontainer/features';

/** The literal mount string every 0.x template rendered under `--voice`. */
const HOUSE_MOUNT = 'source=/mnt/wslg,target=/mnt/wslg,type=bind';

/** The literal `remoteEnv.PULSE_SERVER` every 0.x template rendered under `--voice`. */
const HOUSE_PULSE = 'unix:/mnt/wslg/PulseServer';

/**
 * The house comment lines rendered directly above those two entries — identical in every template revision
 * that carried them (51e66ea → 0.33.x). Matched line by line, trimmed, exactly.
 */
const HOUSE_COMMENT_LINES = new Set([
  "// Bridge to WSL2's WSLg PulseAudio server (mounted below) so a process in the container",
  '// can reach the real speaker + mic — the sink the bespunky-voice plugin speaks/listens through.',
  '// WSLg audio (bespunky-voice): exposes the host PulseAudio socket at /mnt/wslg/PulseServer.',
  '// WSL-specific — this is why voice is an opt-in flag, not always-on: binding /mnt/wslg on a',
  '// non-WSL host (macOS / Codespaces) has no source socket. If the socket is absent after a',
  '// rebuild on the Docker Desktop WSL2 backend, swap the source to /run/desktop/mnt/host/wslg.',
]);

/** Anything that names a WSLg path: `/mnt/wslg`, `/run/desktop/mnt/host/wslg`, … */
const WSLG = /\/wslg(?![\w-])/;

const PARSE_OPTIONS = { allowTrailingComma: true, disallowComments: false };
const FORMAT = { insertSpaces: true, tabSize: 2, eol: '\n' };

export default async function retireWslgAudioBridge(tree: Tree): Promise<void> {
  const reports = reportFeatureFiles(tree);

  if (tree.exists(DEVCONTAINER)) {
    const original = tree.read(DEVCONTAINER, 'utf8') ?? '';
    if (!parseTree(original, [], PARSE_OPTIONS)) {
      // Unparseable: nothing here can be located safely. Say so only if it plausibly carries the bridge.
      if (original.includes(HOUSE_MOUNT) || original.includes(HOUSE_PULSE)) {
        reports.push(`${DEVCONTAINER}: could not be parsed as JSONC, so the WSLg audio bridge in it was left as-is.`);
      }
    } else {
      const { text, removed } = removeHouseEntries(original);
      if (text !== original) tree.write(DEVCONTAINER, text);
      reports.push(...reportVariants(text, removed.includes('mount')));

      if (removed.length > 0) {
        logger.info(
          `${TAG} Removed the WSLg-only audio bridge from ${DEVCONTAINER}: ` +
            removed.map((what) => (what === 'mount' ? `the "${HOUSE_MOUNT}" mount` : `remoteEnv.PULSE_SERVER "${HOUSE_PULSE}"`)).join(' and ') +
            ` (with the house comments above them). That bind made the container fail to start on any non-WSL ` +
            `host. The next sync with voice on adds the host-agnostic bridge (/run/bespunky/host/pulse); until ` +
            `then voice falls back to /mnt/wslg only where it exists.`,
        );
      }
    }
  }

  for (const report of reports) logger.warn(`${TAG} Left in place — ${report}`);
}

type Removed = 'mount' | 'pulse';

/** Remove every exact house entry, one at a time, re-parsing between edits so offsets are always fresh. */
function removeHouseEntries(input: string): { text: string; removed: Removed[] } {
  let text = input;
  const removed = new Set<Removed>();

  for (;;) {
    const root = parseTree(text, [], PARSE_OPTIONS)!;
    const mount = findNodeAtLocation(root, ['mounts'])?.children?.find(
      (member) => member.type === 'string' && member.value === HOUSE_MOUNT,
    );
    if (mount) {
      text = removeNode(text, mount, ['mounts', mount.parent!.children!.indexOf(mount)]);
      removed.add('mount');
      continue;
    }

    const pulse = findNodeAtLocation(root, ['remoteEnv', 'PULSE_SERVER']);
    if (pulse && pulse.type === 'string' && pulse.value === HOUSE_PULSE) {
      text = removeNode(text, pulse.parent!, ['remoteEnv', 'PULSE_SERVER']);
      removed.add('pulse');
      continue;
    }

    return { text, removed: [...removed] };
  }
}

/**
 * Cut one member (an array element, or an object property node) out of the text.
 *
 * When the member owns its line(s) — the shape every rendered and every merged devcontainer has — the whole
 * line goes, together with the exact house comment lines directly above it, and the separator is repaired:
 * if the member was the LAST one and carried no comma of its own, the comma the previous member now trails
 * is removed with it. Any other layout (several members on one line) falls back to jsonc-parser's own
 * removal, which is correct there because there is no line structure to protect.
 */
function removeNode(text: string, node: Node, path: (string | number)[]): string {
  const start = node.offset;
  let end = node.offset + node.length;

  let cursor = skipInline(text, end);
  const ownComma = text[cursor] === ',';
  if (ownComma) cursor = skipInline(text, cursor + 1);
  if (text.startsWith('//', cursor)) cursor = lineEnd(text, cursor); // a trailing note belongs to the member

  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const ownsLine = text.slice(lineStart, start).trim() === '' && (cursor >= text.length || text[cursor] === '\n' || text[cursor] === '\r');

  if (!ownsLine) {
    return applyEdits(text, modify(text, path, undefined, { formattingOptions: FORMAT }));
  }

  end = Math.min(text.length, lineEnd(text, cursor) + 1);
  let from = lineStart;
  while (from > 0) {
    const prevStart = text.lastIndexOf('\n', from - 2) + 1;
    if (!HOUSE_COMMENT_LINES.has(text.slice(prevStart, from).trim())) break;
    from = prevStart;
  }

  let result = text.slice(0, from) + text.slice(end);

  // Last member with no comma of its own → the previous member's comma is now trailing. Drop it.
  const siblings = node.parent!.children!;
  const index = siblings.indexOf(node);
  if (!ownComma && index === siblings.length - 1 && index > 0) {
    const previous = siblings[index - 1];
    const comma = skipInline(result, previous.offset + previous.length);
    if (result[comma] === ',' && comma < from) result = result.slice(0, comma) + result.slice(comma + 1);
  }

  return result;
}

/** Advance past spaces and tabs (not newlines). */
function skipInline(text: string, at: number): number {
  while (at < text.length && (text[at] === ' ' || text[at] === '\t')) at++;
  return at;
}

/** Index of the `\n` ending the line that contains `at` (or the text's end). */
function lineEnd(text: string, at: number): number {
  const nl = text.indexOf('\n', at);
  return nl === -1 ? text.length : nl;
}

/** Everything WSLg-shaped that remains after the exact house entries are gone: somebody's own edit. */
function reportVariants(text: string, mountRemoved: boolean): string[] {
  const root = parseTree(text, [], PARSE_OPTIONS);
  if (!root) return [];
  const reports: string[] = [];
  const consequence = mountRemoved
    ? ' The house /mnt/wslg mount was removed, so a /mnt/wslg path no longer exists in the container unless something else mounts it.'
    : '';

  findNodeAtLocation(root, ['mounts'])?.children?.forEach((member, index) => {
    const value = getNodeValue(member);
    const described = typeof value === 'string' ? value : JSON.stringify(value);
    if (WSLG.test(described)) {
      reports.push(
        `${DEVCONTAINER}: mounts[${index}] "${described}" is a WSLg bind the house did not write (it wrote exactly ` +
          `"${HOUSE_MOUNT}"), so it is yours and was not removed. A WSLg path exists only on a WSL2 host: on any ` +
          `other host this mount stops the container from starting. With voice on, the next sync adds the ` +
          `host-agnostic bridge at /run/bespunky/host/pulse — remove this mount once you have it.`,
      );
    }
  });

  for (const env of ['remoteEnv', 'containerEnv']) {
    const pulse = findNodeAtLocation(root, [env, 'PULSE_SERVER']);
    const value = pulse ? getNodeValue(pulse) : undefined;
    if (typeof value === 'string' && WSLG.test(value)) {
      reports.push(
        `${DEVCONTAINER}: ${env}.PULSE_SERVER "${value}" points into WSLg but is not the value the house wrote ` +
          `("${HOUSE_PULSE}"${env === 'containerEnv' ? ', and only ever under remoteEnv' : ''}), so it was not ` +
          `removed. It overrides the host-agnostic endpoint the next sync wires (unix:/run/bespunky/host/pulse/native) ` +
          `— remove it unless you mean it.${consequence}`,
      );
    }
  }

  return reports;
}

/**
 * Local devcontainer features that mention WSLg. A short-lived pre-release moved voice into a local feature
 * that declared the same mount; nothing published should carry one, but a feature is the other place a mount
 * can be declared, and one that names WSLg breaks a non-WSL host just the same. Never edited — a feature's
 * manifest is the project's own — only reported.
 */
function reportFeatureFiles(tree: Tree): string[] {
  if (!tree.exists(FEATURES)) return [];

  return tree
    .children(FEATURES)
    .map((feature) => `${FEATURES}/${feature}/devcontainer-feature.json`)
    .filter((path) => tree.exists(path) && WSLG.test(tree.read(path, 'utf8') ?? ''))
    .map(
      (path) =>
        `${path}: mentions a WSLg path. Features are not edited by this migration; if it mounts /mnt/wslg, the ` +
        `container fails to start on any non-WSL host — retire that mount in favour of the house bridge.`,
    );
}
