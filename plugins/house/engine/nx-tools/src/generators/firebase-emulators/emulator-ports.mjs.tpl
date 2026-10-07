// tools/emulator-ports.mjs — WHICH PORTS THE EMULATOR SUITE OCCUPIES, and how a stack shifts them. GENERATOR-OWNED
// (@bespunky/nx-tools:firebase-emulators); rewritten every sync — the table below is projected from the payload's
// emulator-ports.ts, the one table the generator itself reads, so the runtime and the generator cannot disagree.
//
// Read by tools/emulators.sh and tools/seed/build-seeds.sh: the ports a suite CLAIMS (through the dev engine's stack
// claim, tools/dev — the one identity for everything that binds this project's ports) and the offset copy of firebase.json.
// They used to carry their own inline copies — literal 4400/4500, a shift that never reached a nested port like
// `firestore.websocketPort` — and a copy is where a port goes missing. (So did "only when declared": an undeclared
// websocketPort is firebase-tools' 9150, and every shifted suite opened it there.)
//
//   node tools/emulator-ports.mjs ports <firebase.json>                 every occupied port, one per line
//   node tools/emulator-ports.mjs shift <firebase.json> <offset> <out>  write a copy with every port shifted
//   node tools/emulator-ports.mjs claim <firebase.json>                 every occupied port as name=port,… — the
//                                                                       `--ports` of `tools/dev/dev claim`
//
// Node built-ins only.
//
// MACHINE OUTPUT IS WRITTEN AS STRINGS, never handed to console.log. The callers are shell scripts that parse stdout,
// and console.log formats a non-string the way util.inspect does: under FORCE_COLOR (which Nx's run-commands sets for
// every task) a number comes out as `\e[33m9099\e[39m`. That once made every `nx run firebase:seed:build` die on
// "usage: emulator-ports.mjs shift" and made the old reaper's port reclaim silently match nothing.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** { defaults: name → firebase-tools' own port, alwaysOn: [names], nested: name → { key → { as: port name, default } } } */
export const SUITE = {{SUITE}};

const entries = (emulators) =>
  Object.entries(emulators ?? {}).filter(([, v]) => v && typeof v === 'object' && v.enabled !== false);

/** A nested port's value: declared in firebase.json, else firebase-tools' default for it. */
const nestedPort = (entry, key, spec) => (Number.isInteger(entry[key]) ? entry[key] : spec.default);

/**
 * Every port a running suite occupies, by name: each enabled emulator (its `port`, else firebase-tools' default),
 * each nested port its emulator opens (`firestore.websocketPort`, declared or default — firebase-tools does not
 * let an undeclared one float, it opens 9150), and the infrastructure firebase-tools always runs (hub, logging).
 */
export function suitePorts(emulators) {
  const out = {};
  for (const [name, entry] of entries(emulators)) {
    const port = Number(entry.port ?? SUITE.defaults[name]);
    if (Number.isInteger(port) && port > 0) out[name] = port;
    for (const [key, spec] of Object.entries(SUITE.nested[name] ?? {})) {
      const nested = nestedPort(entry, key, spec);
      if (Number.isInteger(nested)) out[spec.as] = nested;
    }
  }
  for (const name of SUITE.alwaysOn) out[name] ??= Number(emulators?.[name]?.port ?? SUITE.defaults[name]);
  return out;
}

/**
 * A copy of a firebase.json with the WHOLE suite moved by `offset` — exactly the ports suitePorts() lists: every
 * enabled emulator's port, every nested port, and the always-on infrastructure. A port firebase.json is silent
 * about is pinned shifted too, because its default would be the base stack's.
 */
export function shiftConfig(cfg, offset) {
  const out = structuredClone(cfg);
  const e = (out.emulators ??= {});
  for (const [name, entry] of entries(e)) {
    // Undeclared means firebase-tools' default — the BASE stack's port. Pin it shifted, like everything else.
    const port = Number(entry.port ?? SUITE.defaults[name]);
    if (Number.isInteger(port) && port > 0) entry.port = port + offset;
    for (const [key, spec] of Object.entries(SUITE.nested[name] ?? {})) {
      const nested = nestedPort(entry, key, spec);
      if (Number.isInteger(nested)) entry[key] = nested + offset;
    }
  }
  for (const name of SUITE.alwaysOn) {
    e[name] = { host: '0.0.0.0', ...(e[name] ?? {}), port: Number(cfg.emulators?.[name]?.port ?? SUITE.defaults[name]) + offset };
  }
  return out;
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
/** One value per line on stdout, as plain text — what a `$(…)` or `mapfile` reads. */
const emit = (values) => process.stdout.write(values.map((v) => `${String(v)}\n`).join(''));
if (isMain) {
  const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
  if (command === 'ports') {
    emit([...new Set(Object.values(suitePorts(read(args[0]).emulators)))]);
  } else if (command === 'shift') {
    const offset = Number(args[1]);
    if (!Number.isInteger(offset) || offset < 0 || !args[2]) {
      console.error('usage: emulator-ports.mjs shift <firebase.json> <offset> <out>');
      process.exit(2);
    }
    writeFileSync(args[2], `${JSON.stringify(shiftConfig(read(args[0]), offset), null, 2)}\n`);
  } else if (command === 'claim') {
    emit([Object.entries(suitePorts(read(args[0]).emulators)).map(([name, port]) => `${name}=${port}`).join(',')]);
  } else {
    console.error(`emulator-ports.mjs: unknown command ${command ?? '(none)'} (ports | shift | claim)`);
    process.exit(2);
  }
}
