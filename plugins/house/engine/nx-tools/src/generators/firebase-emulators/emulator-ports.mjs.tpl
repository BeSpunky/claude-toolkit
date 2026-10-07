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
//
// Node built-ins only.
import { readFileSync, writeFileSync } from 'node:fs';

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

const [command, ...args] = process.argv.slice(2);
if (command) {
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
  } else {
    console.error(`emulator-ports.mjs: unknown command ${command} (ports | shift)`);
    process.exit(2);
  }
}
