// tools/emulator-ports.mjs — WHICH PORTS THE EMULATOR SUITE OCCUPIES, and how a stack shifts them. GENERATOR-OWNED
// (@bespunky/nx-tools:firebase-emulators); rewritten every sync — the table below is projected from the payload's
// emulator-ports.ts, the one table the generator itself reads, so the runtime and the generator cannot disagree.
//
// Read by tools/emulators.sh (the offset copy of firebase.json) and tools/reap-emulators.sh (the ports to reclaim).
// They used to carry their own inline copies — literal 4400/4500, a shift that never reached a nested port like
// `firestore.websocketPort` — and a copy is where a port goes missing.
//
//   node tools/emulator-ports.mjs ports <firebase.json>                 every occupied port, one per line
//   node tools/emulator-ports.mjs shift <firebase.json> <offset> <out>  write a copy with every port shifted
//   node tools/emulator-ports.mjs free-offset <firebase.json>           a SHIFTED block whose every port is free
//                                                                       (a one-off suite's own — tools/seed/build-seeds.sh)
//
// Node built-ins only.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

/** { defaults: name → firebase-tools' own port, alwaysOn: [names], nested: name → { key → port name } } */
export const SUITE = {{SUITE}};

const entries = (emulators) =>
  Object.entries(emulators ?? {}).filter(([, v]) => v && typeof v === 'object' && v.enabled !== false);

/**
 * Every port a running suite occupies, by name: each enabled emulator (its `port`, else firebase-tools' default),
 * each DECLARED nested port (`firestore.websocketPort`), and the infrastructure firebase-tools always runs (hub,
 * logging). An undeclared nested port is not listed: firebase-tools lets it float to a free port.
 */
export function suitePorts(emulators) {
  const out = {};
  for (const [name, entry] of entries(emulators)) {
    const port = Number(entry.port ?? SUITE.defaults[name]);
    if (Number.isInteger(port) && port > 0) out[name] = port;
    for (const [key, as] of Object.entries(SUITE.nested[name] ?? {})) {
      if (Number.isInteger(entry[key])) out[as] = entry[key];
    }
  }
  for (const name of SUITE.alwaysOn) out[name] ??= Number(emulators?.[name]?.port ?? SUITE.defaults[name]);
  return out;
}

/**
 * A copy of a firebase.json with the WHOLE suite moved by `offset` — exactly the ports suitePorts() lists: every
 * enabled emulator's port, every declared nested port, and the always-on infrastructure. A port firebase.json is
 * silent about is pinned shifted too, because its default would be the base stack's.
 */
export function shiftConfig(cfg, offset) {
  const out = structuredClone(cfg);
  const e = (out.emulators ??= {});
  for (const [name, entry] of entries(e)) {
    // Undeclared means firebase-tools' default — the BASE stack's port. Pin it shifted, like everything else.
    const port = Number(entry.port ?? SUITE.defaults[name]);
    if (Number.isInteger(port) && port > 0) entry.port = port + offset;
    for (const key of Object.keys(SUITE.nested[name] ?? {})) if (Number.isInteger(entry[key])) entry[key] += offset;
  }
  for (const name of SUITE.alwaysOn) {
    e[name] = { host: '0.0.0.0', ...(e[name] ?? {}), port: Number(cfg.emulators?.[name]?.port ?? SUITE.defaults[name]) + offset };
  }
  return out;
}

/** Bindable on every address a server could hold it on (the dev engine's probe, tools/dev/lib/ports.mjs). */
async function isPortFree(port) {
  for (const host of ['127.0.0.1', '::1', '0.0.0.0', '::']) {
    const ok = await new Promise((resolve) => {
      const srv = createServer();
      srv.once('error', (err) => resolve(err?.code === 'EADDRNOTAVAIL' || err?.code === 'EAFNOSUPPORT'));
      srv.once('listening', () => srv.close(() => resolve(true)));
      srv.listen({ port, host, exclusive: true });
    });
    if (!ok) return false;
  }
  return true;
}

/**
 * The first SHIFTED block (never 0 — the base ports are the developer's) on which every port of the suite is free,
 * stepping by more than the suite's span so a block never overlaps another stack's. null when none is.
 */
export async function freeOffset(emulators) {
  const ports = [...new Set(Object.values(suitePorts(emulators)))];
  const min = Math.min(...ports);
  const max = Math.max(...ports);
  const step = Math.ceil((max - min + 1) / 1000) * 1000;
  for (let offset = step; max + offset <= 65535; offset += step) {
    let free = true;
    for (const port of ports) if (!(free = await isPortFree(port + offset))) break;
    if (free) return offset;
  }
  return null;
}

// Run as a program, never when imported. Compared by REAL path (a symlinked or logical spelling of the same file).
const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
const [command, ...args] = isMain ? process.argv.slice(2) : [];
if (isMain) {
  const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
  if (command === 'ports') {
    for (const port of new Set(Object.values(suitePorts(read(args[0]).emulators)))) console.log(port);
  } else if (command === 'shift') {
    const offset = Number(args[1]);
    if (!Number.isInteger(offset) || offset < 0 || !args[2]) {
      console.error('usage: emulator-ports.mjs shift <firebase.json> <offset> <out>');
      process.exit(2);
    }
    writeFileSync(args[2], `${JSON.stringify(shiftConfig(read(args[0]), offset), null, 2)}\n`);
  } else if (command === 'free-offset') {
    const offset = await freeOffset(read(args[0]).emulators);
    if (offset === null) {
      console.error('emulator-ports.mjs: no free port block for the suite — stop a running stack (tools/dev/dev ps) and retry');
      process.exit(1);
    }
    console.log(offset);
  } else {
    console.error(`emulator-ports.mjs: unknown command ${command ?? '(none)'} (ports | shift | free-offset)`);
    process.exit(2);
  }
}
