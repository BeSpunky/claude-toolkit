// 0.50.0 — an Angular design system stops peering the @angular/* packages only its pruned demo used.
//
// WHY. @nx/angular's library generator declares `peerDependencies` for its demo component (`@angular/common` among
// them); the house prunes that demo — the design system ships no components — but left the peer, so the library
// failed its own lint from the day it was created (`@nx/dependency-checks`: "The "@angular/common" package is not used
// by "design-system" project"), in every house Angular project since lint reached it. From 0.50.0 a NEW design system
// drops them at creation (the Angular binding's `pruneUnusedPeers`); the manifest of an existing one is project state
// (class B), so this rung does the same once.
//
// WHAT IT TAKES: only `@angular/*` peers other than @angular/core that NO source file in the library imports — the
// exact judgement @nx/dependency-checks makes, so nothing a file still uses is touched. Each removal is named.
import { type Tree, logger } from '@nx/devkit';
import { findDesignSystem } from '../../generators/_utils/design-system';
import { unusedAngularPeers } from '../../adapters/angular/design-system';
import { applyJsonChanges } from '../../generators/_utils/json-edits';

const TAG = '[0.50.0 prune-design-system-peers]';

export default function pruneDesignSystemPeers(tree: Tree): void {
  const ds = findDesignSystem(tree);
  if (!ds) return;
  const unused = unusedAngularPeers(tree, ds.root);
  if (!unused.length) return;
  const path = `${ds.root}/package.json`;
  const text = tree.read(path, 'utf8') ?? '';
  const before = JSON.parse(text);
  const after = JSON.parse(text);
  for (const name of unused) delete after.peerDependencies[name];
  tree.write(path, applyJsonChanges(text, before, after));
  logger.info(`${TAG} ${path}: removed peerDependencies ${unused.join(', ')} — no file in the design system imports them (they were the pruned demo's), which failed its own lint (@nx/dependency-checks).`);
}
