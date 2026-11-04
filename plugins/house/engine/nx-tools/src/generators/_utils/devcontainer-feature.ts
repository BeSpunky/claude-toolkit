// Removing a devcontainer feature is ONE operation over TWO files. A feature lives in `devcontainer.json`
// (`features.<id>`) AND, once any container has been built, in `devcontainer-lock.json` (the resolved digest the
// devcontainer CLI pinned). Removing it from the first alone leaves the lock pinning a feature nothing declares:
// the next rebuild rewrites the lock, and every project is left with an uncommitted diff the upgrade should have
// made — exactly what 0.43.0 did. So every migration that retires a feature goes through `removeFeature`, and
// the lock cannot be forgotten again.
import { type Tree, logger } from '@nx/devkit';
import { findNodeAtLocation, getNodeValue } from 'jsonc-parser';
import { DEVCONTAINER_MARKER, houseWrote } from './devcontainer-provenance';
import { parseJsoncStrict as parseStrict } from './jsonc-strict';
import { removeMemberWithLeadingComment } from './jsonc-remove-member';

export const DEVCONTAINER_JSON = '.devcontainer/devcontainer.json';
export const DEVCONTAINER_LOCK = '.devcontainer/devcontainer-lock.json';

/** What `removeFeature` changed, so the caller can log each file it touched. */
export interface FeatureRemoval {
  declaration: boolean;
  lock: boolean;
}

/**
 * Remove feature `id` from devcontainer.json (the member, its comma, the `//` lines explaining it — nothing else
 * touched) and its pin from devcontainer-lock.json. Unparseable files are left alone and reported as unchanged.
 */
export function removeFeature(tree: Tree, id: string): FeatureRemoval {
  let declaration = false;
  const text = tree.exists(DEVCONTAINER_JSON) ? (tree.read(DEVCONTAINER_JSON, 'utf8') ?? '') : '';
  const root = text ? parseStrict(text) : undefined;
  const node = root && findNodeAtLocation(root, ['features', id]);
  if (node) {
    tree.write(DEVCONTAINER_JSON, removeMemberWithLeadingComment(text, node));
    declaration = true;
  }
  return { declaration, lock: pruneLock(tree, (lockedId) => lockedId === id).length > 0 };
}

/**
 * Remove every pin in devcontainer-lock.json whose id `drop` selects; returns the ids removed. The lock is
 * machine-written plain JSON (the devcontainer CLI's own 2-space format), so it is rewritten in that format.
 */
export function pruneLock(tree: Tree, drop: (id: string) => boolean): string[] {
  if (!tree.exists(DEVCONTAINER_LOCK)) return [];
  let lock: { features?: Record<string, unknown> };
  try {
    lock = JSON.parse(tree.read(DEVCONTAINER_LOCK, 'utf8') ?? '');
  } catch {
    return [];
  }
  const removed = Object.keys(lock.features ?? {}).filter(drop);
  if (!removed.length) return [];
  for (const id of removed) delete lock.features![id];
  tree.write(DEVCONTAINER_LOCK, `${JSON.stringify(lock, null, 2)}\n`);
  return removed;
}

/** The feature ids devcontainer.json declares, or `undefined` when it is missing or unparseable. */
export function declaredFeatures(tree: Tree): Set<string> | undefined {
  if (!tree.exists(DEVCONTAINER_JSON)) return undefined;
  const root = parseStrict(tree.read(DEVCONTAINER_JSON, 'utf8') ?? '');
  if (!root) return undefined;
  const features = findNodeAtLocation(root, ['features']);
  if (!features) return new Set();
  if (features.type !== 'object') return undefined;
  return new Set((features.children ?? []).map((property) => String(property.children?.[0]?.value)));
}

/**
 * Retire a feature the house SUPERSEDED (a migration's job): every `features` key `ids` matches is removed — with its
 * `//` lines and its lock pin — where the house wrote it (`houseWrote`: an owned devcontainer, or the adopted merge's
 * record), and REPORTED where the project did (something outside what the house guarantees may use it). `instead`
 * says what replaced it. Returns whether anything was removed.
 */
export function retireHouseFeature(tree: Tree, tag: string, ids: RegExp, instead: string): boolean {
  if (!tree.exists(DEVCONTAINER_JSON)) return false;
  const text = tree.read(DEVCONTAINER_JSON, 'utf8') ?? '';
  const root = parseStrict(text);
  const features = root && findNodeAtLocation(root, ['features']);
  if (!root || features?.type !== 'object') {
    if (!root) logger.warn(`${tag} ${DEVCONTAINER_JSON} could not be read as JSONC — check it by hand for a feature matching ${ids}: ${instead}.`);
    return false;
  }
  let removed = false;
  for (const property of features.children ?? []) {
    const [key, value] = property.children ?? [];
    const id = String(key?.value);
    if (!ids.test(id)) continue;
    if (!houseWrote(tree, { path: ['features', id], value: value ? getNodeValue(value) : {} })) {
      logger.warn(
        `${tag} Left in place — "${id}" in ${DEVCONTAINER_JSON} was not written by the house, so something may still use it. ` +
          `It is superseded (${instead}); if nothing else needs it, remove it (and its devcontainer-lock.json pin) and rebuild.`,
      );
      continue;
    }
    const result = removeFeature(tree, id);
    if (!result.declaration && !result.lock) continue;
    removed = true;
    logger.info(
      `${tag} removed the "${id}" feature from ${[result.declaration && DEVCONTAINER_JSON, result.lock && DEVCONTAINER_LOCK].filter(Boolean).join(' and ')} — ${instead}.`,
    );
  }
  return removed;
}

/** A feature's identity, without its tag or digest: `…/github-cli:1.1.3` and `…/github-cli` are one feature. */
export const featureIdentity = (id: string): string => id.replace(/@sha256:.*$/, '').replace(/:[^/:]*$/, '');

/** A lock pin, as the devcontainer CLI writes it. */
export interface FeaturePin {
  version: string;
  resolved: string;
  integrity: string;
}

/**
 * Make `to` the pin of an existing devcontainer-lock.json, in place of `from`, exactly as the CLI would write it (its
 * sort, its format), so the next build has nothing to rewrite. Whether or not `from` was pinned: a build adds a declared
 * feature's missing pin. No lock is created: a project without one has not asked for one.
 */
function setLockPin(tree: Tree, from: string, to: string, pin: FeaturePin): void {
  if (!tree.exists(DEVCONTAINER_LOCK)) return;
  try {
    const lock = JSON.parse(tree.read(DEVCONTAINER_LOCK, 'utf8') ?? '') as { features?: Record<string, unknown> };
    const { [from]: _old, ...others } = lock.features ?? {};
    lock.features = Object.fromEntries(Object.entries({ ...others, [to]: pin }).sort(([a], [b]) => a.localeCompare(b)));
    tree.write(DEVCONTAINER_LOCK, `${JSON.stringify(lock, null, 2)}\n`);
  } catch {
    // Not JSON: the CLI rewrites it on the next build, and nothing here can read it.
  }
}

/**
 * Move feature `from` to the key `to`, in every place the house keeps it: the KEY in devcontainer.json (its value and
 * its `//` lines stay), the pin in devcontainer-lock.json when there is one (`setLockPin`), and an adopted marker's
 * record of what the house added. The caller has decided the move is the house's to make. False when `from` is not
 * declared or the file is unreadable.
 */
export function renameFeature(tree: Tree, from: string, to: string, pin: FeaturePin): boolean {
  const text = tree.exists(DEVCONTAINER_JSON) ? (tree.read(DEVCONTAINER_JSON, 'utf8') ?? '') : '';
  const root = text ? parseStrict(text) : undefined;
  const key = root && findNodeAtLocation(root, ['features', from])?.parent?.children?.[0];
  if (!key) return false;
  tree.write(DEVCONTAINER_JSON, `${text.slice(0, key.offset)}${JSON.stringify(to)}${text.slice(key.offset + key.length)}`);

  setLockPin(tree, from, to, pin);

  if (tree.exists(DEVCONTAINER_MARKER)) {
    try {
      const marker = JSON.parse(tree.read(DEVCONTAINER_MARKER, 'utf8') ?? '') as { adopted?: { houseAdded?: { path?: string[] }[] } };
      const entry = marker.adopted?.houseAdded?.find((e) => e.path?.[0] === 'features' && e.path[1] === from);
      if (entry) {
        entry.path = ['features', to];
        tree.write(DEVCONTAINER_MARKER, `${JSON.stringify(marker, null, 2)}\n`);
      }
    } catch {
      // An unreadable marker holds no record to keep.
    }
  }
  return true;
}

/** What a rung pinning a house feature says: the key it replaces, and the exact tag with the digest of its manifest. */
export interface FeaturePinning {
  tag: string;
  from: string;
  to: string;
  pin: FeaturePin;
}

const isExactly = (id: string) => /:\d+\.\d+\.\d+$/.test(id) || /@sha256:/.test(id);
const isEmptyObject = (value: unknown) => !!value && typeof value === 'object' && !Object.keys(value).length;

/**
 * A migration's whole job for a feature whose declaration floats (`from`, a bare id or a major tag): rename it to `to`.
 *
 * It is the house's to move where the house wrote it (`houseWrote`) and wherever it says nothing but "this feature"
 * (`{}`): whoever wrote that, nothing can depend on the key having no exact tag. A key the project gave its own options,
 * with no record of the house writing them, is reported with the rename. The same feature under another tag that still
 * floats is the project's, and reported too.
 */
export function pinHouseFeature(tree: Tree, { tag, from, to, pin }: FeaturePinning): void {
  if (!tree.exists(DEVCONTAINER_JSON)) return;
  const text = tree.read(DEVCONTAINER_JSON, 'utf8') ?? '';
  const root = parseStrict(text);
  if (!root) {
    if (text.includes(`"${from}"`)) logger.warn(`${tag} ${DEVCONTAINER_JSON} could not be read as JSONC. If it declares "${from}", rename the key to "${to}" and rebuild.`);
    return;
  }
  const features = findNodeAtLocation(root, ['features']);
  for (const property of features?.type === 'object' ? (features.children ?? []) : []) {
    const id = String(property.children?.[0]?.value);
    if (id !== from && id !== to && featureIdentity(id) === featureIdentity(to) && !isExactly(id)) {
      logger.warn(`${tag} Left in place: "${id}" in ${DEVCONTAINER_JSON} is the project's, and that tag moves with no commit behind it. To pin it, rename the key to "${to}" and rebuild.`);
    }
  }
  const node = findNodeAtLocation(root, ['features', from]);
  if (!node) return;
  const value = getNodeValue(node);
  if (!houseWrote(tree, { path: ['features', from], value }) && !isEmptyObject(value)) {
    logger.warn(`${tag} Left in place: "${from}" in ${DEVCONTAINER_JSON} carries options the house did not write, and that key moves with no commit behind it. To pin it, rename the key to "${to}" and rebuild.`);
    return;
  }
  // Declared twice already: the exact one is the pin, and the other can be depended on by nothing.
  if (findNodeAtLocation(root, ['features', to])) {
    removeFeature(tree, from);
    setLockPin(tree, from, to, pin);
    logger.info(`${tag} removed "${from}" from ${DEVCONTAINER_JSON}: "${to}" is already declared.`);
    return;
  }
  renameFeature(tree, from, to, pin);
  logger.info(`${tag} ${DEVCONTAINER_JSON}: "${from}" is now "${to}"${tree.exists(DEVCONTAINER_LOCK) ? `, and so is its pin in ${DEVCONTAINER_LOCK}` : ''}. The next rebuild installs that version.`);
}
