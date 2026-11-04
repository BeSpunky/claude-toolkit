#!/usr/bin/env node
// THE TRIPWIRE FOR A FLOATING IMAGE: has an image the house composes moved to a Debian release with no Postgres closure?
//
// A closure is linked against one Debian release's libraries, so the table is keyed by codename (POSTGRES_DEB_CODENAMES),
// while the images float: `base:debian` and `typescript-node:<major>` move to a new Debian on Microsoft's schedule, with no
// commit here. The generated installer refuses a release it has no closure for, by name, but that refusal lands in a
// consumer's image build. This says so first. Pinning the tags would not settle it: an adopted image picks its own
// release anyway, and the installer's refusal covers that one.
//
// HOW, WITH NO DOCKER AND NO PULL: a floating tag and the tag that names its release are the same manifest. `22` has the
// digest of `22-trixie`, and `debian` the digest of `trixie`, so a HEAD per tag answers it. A floating tag that matches
// no named one is not a pass: "could not tell" exits 2.
//
// THE IMAGES ARE READ FROM THE LAYERS (`ref:` in layers/*.ts) and the Node majors from the projected facts, so a new layer
// image or a new major is checked with no edit here.
//
// IT FAILS WHEN UPSTREAM MOVES, so it runs on a schedule (.github/workflows/upstream-tables.yml), never per push. When red:
// add the codename to POSTGRES_DEB_CODENAMES, run project.mjs --write, and release. Exit 0 ok, 1 no closure, 2 could not tell.
//
//   node tools/postgres-debs/image-codenames.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinnedList } from './closure.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'plugins/house/engine/nx-tools/src');

/**
 * Images known to sit outside the closures without having moved, with the reason. Printed on every run. Only for an image
 * nothing is moving any more: the entry holds for this codename alone, so a move still fails.
 */
export const KNOWN_OUTSIDE = {
  'mcr.microsoft.com/devcontainers/typescript-node:14': { codename: 'bullseye', why: 'Node 14 reached end of life in 2023 and its image stays on bullseye. A project on it is refused by the installer, by name.' },
};

/** Tags that are not a Debian release though they may share a digest with one. */
const NOT_A_RELEASE = new Set(['latest', 'dev', 'debian', 'ubuntu', 'alpine']);

/** Every image the layers compose, with `{{nodeMajor}}` expanded over the majors that have an image. */
export function composedImages(layerSources, nodeMajors) {
  const refs = layerSources.flatMap((source) => [...source.matchAll(/\bref:\s*'([^']+)'/g)].map(([, ref]) => ref));
  return [...new Set(refs.flatMap((ref) => (ref.includes('{{nodeMajor}}') ? nodeMajors.map((major) => ref.replace('{{nodeMajor}}', String(major))) : [ref])))];
}

/** The tags of a repository that would name a floating tag's release: `<tag>-<codename>`, or for a word tag, `<codename>`. */
export function releaseTags(floating, tags) {
  if (/^\d+$/.test(floating)) return tags.filter((tag) => new RegExp(`^${floating}-[a-z]+$`).test(tag)).map((tag) => ({ tag, codename: tag.slice(floating.length + 1) }));
  return tags.filter((tag) => /^[a-z]+$/.test(tag) && tag !== floating && !NOT_A_RELEASE.has(tag)).map((tag) => ({ tag, codename: tag }));
}

/** The one codename whose tag has the floating tag's digest, or undefined when none or several do. */
export function codenameByDigest(digest, candidates) {
  const matching = candidates.filter((candidate) => candidate.digest === digest);
  return matching.length === 1 ? matching[0].codename : undefined;
}

/** Each image against the closures: `{ image, codename, verdict: 'ok' | 'known' | 'missing' | 'unknown' }`. */
export function judge(codenames, closures, known = KNOWN_OUTSIDE) {
  return Object.entries(codenames).map(([image, codename]) => {
    if (!codename) return { image, verdict: 'unknown' };
    if (closures.includes(codename)) return { image, codename, verdict: 'ok' };
    return { image, codename, verdict: known[image]?.codename === codename ? 'known' : 'missing' };
  });
}

const MANIFESTS = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(',');

/** Registry calls, retried: a connect timeout from one mirror is not a finding. */
async function request(url, init) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
      return response;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
}

async function codenameOf(image, tagsOf) {
  const [, host, repository, floating] = /^([^/]+)\/(.+):([^:]+)$/.exec(image) ?? [];
  if (host !== 'mcr.microsoft.com') throw new Error(`${image}: this check reads MCR only, so it cannot tell. Teach it this registry.`);
  const digestOf = async (tag) => (await request(`https://${host}/v2/${repository}/manifests/${tag}`, { method: 'HEAD', headers: { accept: MANIFESTS } })).headers.get('docker-content-digest');
  const candidates = releaseTags(floating, await tagsOf(host, repository));
  const digest = await digestOf(floating);
  const known = await Promise.all(candidates.map(async (candidate) => ({ ...candidate, digest: await digestOf(candidate.tag) })));
  return codenameByDigest(digest, known);
}

async function main() {
  const layersDir = join(SRC, 'layers');
  const sources = readdirSync(layersDir).filter((file) => file.endsWith('.ts')).map((file) => readFileSync(join(layersDir, file), 'utf8'));
  const majors = /TYPESCRIPT_NODE_IMAGE_MAJORS: readonly number\[\] = \[([^\]]*)\]/.exec(readFileSync(join(SRC, 'generators/_utils/node-facts.ts'), 'utf8'))?.[1].split(',').map(Number);
  if (!majors?.length) throw new Error('TYPESCRIPT_NODE_IMAGE_MAJORS is not in node-facts.ts as a one-line list');
  const closures = pinnedList(readFileSync(join(SRC, 'generators/_utils/versions.ts'), 'utf8'), 'POSTGRES_DEB_CODENAMES');

  const tagLists = new Map();
  const tagsOf = (host, repository) => {
    const key = `${host}/${repository}`;
    if (!tagLists.has(key)) tagLists.set(key, request(`https://${host}/v2/${repository}/tags/list`).then((response) => response.json()).then(({ tags }) => tags));
    return tagLists.get(key);
  };
  const images = composedImages(sources, majors);
  const codenames = {};
  for (const image of images) codenames[image] = await codenameOf(image, tagsOf);

  const results = judge(codenames, closures);
  for (const { image, codename, verdict } of results) {
    if (verdict === 'ok') console.log(`ok       ${image} → ${codename}`);
    if (verdict === 'known') console.log(`known    ${image} → ${codename}: ${KNOWN_OUTSIDE[image].why}`);
    if (verdict === 'missing') console.error(`MOVED    ${image} → ${codename}, and the closures cover only ${closures.join(', ')}. A project on this image cannot install Postgres: its image build fails. Add "${codename}" to POSTGRES_DEB_CODENAMES (versions.ts), run node tools/postgres-debs/project.mjs --write, review, and release.`);
    if (verdict === 'unknown') console.error(`UNKNOWN  ${image}: no tag naming a release has this tag's digest (or several do), so its release cannot be told from the registry.`);
  }
  if (results.some((result) => result.verdict === 'missing')) process.exit(1);
  if (results.some((result) => result.verdict === 'unknown')) process.exit(2);
  console.log(`ok: all ${images.length} composed images are on a release with a closure (${closures.join(', ')}) or stated above`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`could not tell: ${error.message}`);
    process.exit(2);
  });
}
