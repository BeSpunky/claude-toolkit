// The Angular adapter's judgement of a library's manifest peers.
//
// @nx/angular's library generator writes `peerDependencies` from a fixed template (files/base/package.json) — always
// @angular/common and @angular/core — whatever the library holds, and its standalone demo imports @angular/core alone.
// So every library it creates fails its own lint on the day it is born (`@nx/dependency-checks`: "The "@angular/common"
// package is not used by …"). The library port trims the manifest at creation (./libs), which is what makes this true
// of every Angular library path. A library that later imports @angular/common declares it then — the same lint names
// the missing peer, and its `--fix` writes it.
import { type Tree, logger } from '@nx/devkit';
import { updateManifest } from '../../generators/_utils/dependencies';

/** Drop the manifest peers {@link unusedAngularPeers} names, each one named in the log. */
export function pruneUnusedPeers(tree: Tree, root: string): void {
  const unused = unusedAngularPeers(tree, root);
  if (!unused.length) return;
  updateManifest(tree, `${root}/package.json`, 'angular library', (json) => {
    for (const name of unused) delete json.peerDependencies[name];
    return json;
  });
  logger.info(`[angular library] ${root}/package.json no longer peers ${unused.join(', ')} — no file in the library imports it, which would fail its own lint (@nx/dependency-checks).`);
}

/**
 * The `@angular/*` peers (other than @angular/core, which every Angular library needs) a library's manifest declares
 * and no source file under it imports — what @nx/angular's library generator declared for its demo component. The
 * rule @nx/dependency-checks applies, so the library passes its own lint.
 */
export function unusedAngularPeers(tree: Tree, root: string): string[] {
  const manifest = `${root}/package.json`;
  if (!tree.exists(manifest)) return [];
  let peers: Record<string, string> = {};
  try {
    peers = JSON.parse(tree.read(manifest, 'utf8') ?? '').peerDependencies ?? {};
  } catch {
    return [];
  }
  const candidates = Object.keys(peers).filter((name) => name.startsWith('@angular/') && name !== '@angular/core');
  if (!candidates.length) return [];
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const child of tree.children(dir)) {
      const path = `${dir}/${child}`;
      if (tree.isFile(path)) {
        if (/\.[cm]?[jt]sx?$/.test(child)) sources.push(tree.read(path, 'utf8') ?? '');
      } else if (child !== 'node_modules') walk(path);
    }
  };
  walk(root);
  return candidates.filter((name) => !sources.some((text) => new RegExp(`['"]${name.replace(/[/]/g, '\\/')}(?:/[^'"]*)?['"]`).test(text)));
}
