// Removing a devcontainer feature is ONE operation over TWO files. A feature lives in `devcontainer.json`
// (`features.<id>`) AND, once any container has been built, in `devcontainer-lock.json` (the resolved digest the
// devcontainer CLI pinned). Removing it from the first alone leaves the lock pinning a feature nothing declares:
// the next rebuild rewrites the lock, and every project is left with an uncommitted diff the upgrade should have
// made — exactly what 0.43.0 did. So every migration that retires a feature goes through `removeFeature`, and
// the lock cannot be forgotten again.
import { type Tree, logger } from '@nx/devkit';
import { findNodeAtLocation, getNodeValue } from 'jsonc-parser';
import { houseWrote } from './devcontainer-provenance';
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
