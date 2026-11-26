#!/usr/bin/env node
// What "met" means for the needs a suite can declare, as observations. Run from the repo root: exit 0 = met, 1 = not met,
// and the one line on stdout says what was observed. Nothing here assumes: a probe that cannot see answers "not met".
//
//   workspace  the installed workspace the suites build on: node_modules holds the nx binary and @bespunky/nx-tools
//              (what `yarn install` leaves; test-generators, test-layers and test-migrations load the compiled engine from it).
//   network    the npm registry the network suites install from (registry.npmjs.org) answers an HTTPS request now. It goes
//              through HTTPS_PROXY when one is set (CONNECT), directly otherwise, and any HTTP answer counts as reachable;
//              a refusal, a timeout or a failed lookup does not.
import { existsSync } from 'node:fs';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

const REGISTRY = 'registry.npmjs.org';
const TIMEOUT_MS = 8000;

const probes = {
  workspace() {
    const wanted = ['node_modules/.bin/nx', 'node_modules/@bespunky/nx-tools/package.json'];
    const missing = wanted.filter((p) => !existsSync(p));
    return missing.length ? { met: false, said: `missing ${missing.join(', ')}` } : { met: true, said: 'node_modules holds nx and @bespunky/nx-tools' };
  },

  network: () => new Promise((resolve) => {
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    const done = (met, said) => { clearTimeout(timer); resolve({ met, said }); };
    const timer = setTimeout(() => done(false, `${REGISTRY} did not answer in ${TIMEOUT_MS} ms`), TIMEOUT_MS);
    const request = (socket) => {
      const tls = tlsConnect({ socket, servername: REGISTRY });
      tls.on('error', (e) => done(false, `TLS to ${REGISTRY} failed: ${e.message}`));
      tls.on('secureConnect', () => tls.write(`HEAD / HTTP/1.1\r\nHost: ${REGISTRY}\r\nConnection: close\r\n\r\n`));
      tls.once('data', (d) => { const m = /^HTTP\/1\.[01] (\d{3})/.exec(String(d)); tls.destroy(); m ? done(true, `${REGISTRY} answered HTTP ${m[1]}`) : done(false, `${REGISTRY} sent no HTTP answer`); });
    };
    if (!proxy) {
      const s = netConnect({ host: REGISTRY, port: 443 });
      s.on('error', (e) => done(false, `no connection to ${REGISTRY}: ${e.code ?? e.message}`));
      s.on('connect', () => request(s));
      return;
    }
    const p = new URL(proxy);
    const s = netConnect({ host: p.hostname, port: Number(p.port) || 80 });
    s.on('error', (e) => done(false, `no connection to the proxy: ${e.code ?? e.message}`));
    s.on('connect', () => s.write(`CONNECT ${REGISTRY}:443 HTTP/1.1\r\nHost: ${REGISTRY}:443\r\n\r\n`));
    s.once('data', (d) => /^HTTP\/1\.[01] 2\d\d/.test(String(d)) ? request(s) : done(false, `the proxy refused ${REGISTRY}: ${String(d).split('\r\n')[0]}`));
  }),
};

const name = process.argv[2];
if (!(name in probes)) { console.error(`usage: probes.mjs ${Object.keys(probes).join('|')}`); process.exit(2); }
const { met, said } = await probes[name]();
console.log(said);
process.exit(met ? 0 : 1);
