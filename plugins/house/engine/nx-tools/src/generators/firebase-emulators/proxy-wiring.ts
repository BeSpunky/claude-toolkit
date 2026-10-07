// What a person is told when an app's dev server does NOT serve through the house's proxy.conf.mjs — one sentence
// per outcome, shared by the generator (a new or re-synced app) and the 0.50.0 migration (an app that existed).
//
// Why it matters enough to say: every emulated Firebase service reaches its emulator through the page's own origin,
// so a dev server that doesn't relay the house's routes leaves them ALL unreachable — Firestore hangs offline, Auth
// fails with a network error — with nothing pointing at the cause. The dev server's config is the project's, so the
// house never overrides a proxy config it finds there; it says exactly what to add instead. (In the browser,
// firebase.config.ts asks the relay at startup and says the same thing in the console — this is the earlier half.)
import { logger } from '@nx/devkit';
import { posix } from 'node:path';
import type { ProxyWiring } from '../../adapters/stack-adapter';
import { PROXY_LOCAL } from './service-configs';

/** Report `wiring` for `project`'s dev server and the house proxy at `houseProxy` (workspace-relative). */
export function reportProxyWiring(tag: string, project: string, houseProxy: string, wiring: ProxyWiring): void {
  const local = posix.join(posix.dirname(houseProxy), PROXY_LOCAL);
  switch (wiring.status) {
    case 'wired':
      return;
    case 'none':
      logger.info(`${tag} \`${project}\` has no dev-server target yet — ${houseProxy} is wired to one once it exists.`);
      return;
    case 'foreign': {
      const own = wiring.proxyConfig;
      const fromOwn = posix.relative(posix.dirname(own), houseProxy);
      const esm = /\.(mjs|js|mts|ts)$/.test(own);
      logger.warn(
        `${tag} \`${project}:${wiring.target}\` uses a proxy config of its own (${wiring.where}.proxyConfig: ${own}), ` +
          `so it does not relay the Firebase emulators — and every emulated service reaches its emulator through the ` +
          `page's origin: Firestore would hang offline, Auth fail. Either:\n` +
          `  • point ${wiring.where}.proxyConfig at ${houseProxy} and move your routes into ${local} (the house file ` +
          `merges it; it is yours, never rewritten)` +
          (esm
            ? `, or\n  • keep ${own} and include the house's routes in it:\n` +
              `      import { emulatorRoutes } from '${fromOwn.startsWith('.') ? fromOwn : `./${fromOwn}`}';\n` +
              `      export default { ...emulatorRoutes, /* your routes */ };`
            : ` — ${own} is not a module, so it cannot import them.`),
      );
      return;
    }
    case 'unconfigurable':
      logger.warn(
        `${tag} \`${project}:${wiring.target}\` runs \`${wiring.executor}\`, a dev server the house cannot point at ` +
          `${houseProxy} — so it does not relay the Firebase emulators, and every emulated service reaches its emulator ` +
          `through the page's origin. Give it the house's routes: ${houseProxy} exports them as \`emulatorRoutes\` ` +
          `(Angular / webpack-dev-server / http-proxy-middleware form) and \`viteEmulatorRoutes\` (a Vite ` +
          `\`server.proxy\`), offset-aware for a worktree's stack.`,
      );
      return;
  }
}
