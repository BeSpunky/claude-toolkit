// Dev-server proxy — relay Cloud Functions callables through the app's OWN origin instead of exposing the
// Functions emulator's port to the host browser. GENERATOR-OWNED (rewritten on every --repair); don't edit.
//
// Why this exists: a forwarded emulator port (5001) is frequently squatted on Windows hosts (ASP.NET dev
// HTTPS, Intel services, …). A squatter that accepts the TCP connection but never answers leaves every
// callable "Pending" until the ~70s deadline (deadline-exceeded), while Firestore/Auth on their own ports
// are fine — a maddening, partial failure. Routing callables through the one port that must already work
// (the dev-server's) removes that whole failure class. The app opts in via environment.ts's
// `emulators.functions.proxied` (firebase.config.ts then connects the emulator to the app's own origin).
//
// Offset-aware — this is the SECOND half of the worktree bug: the serve executor exports PORT_OFFSET for an
// isolated (worktree) stack, so the Functions emulator runs at basePort + offset. A HARDCODED :5001 target
// would silently relay a worktree's callables to a DIFFERENT tree's emulator; we shift by the same offset.
import { readFileSync } from 'node:fs';

// Session port offset (0 for the main/base stack; the serve executor sets it only for an isolated tree).
const rawOffset = Number(process.env.PORT_OFFSET ?? 0);
const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;

// Base Functions emulator port — single-sourced from firebase.json at the workspace root (the dev-server's
// cwd), so changing the port in one place is enough. Falls back to the house default if unreadable.
let basePort = 5001;
try {
  const firebaseJson = JSON.parse(readFileSync('firebase.json', 'utf8'));
  if (Number.isInteger(firebaseJson?.emulators?.functions?.port)) basePort = firebaseJson.emulators.functions.port;
} catch {
  // keep the default — a project without a readable firebase.json isn't running the functions emulator anyway.
}
const target = `http://localhost:${basePort + offset}`;

// Path prefix — the Functions emulator serves callables at /<projectId>/<region>/<fn>, so we proxy
// /<projectId>/**. projectId is the app's single source of truth (environment.ts); read as text, mirroring
// tools/emulators.sh which derives the emulator `--project` the same way. If it can't be read we export an
// empty proxy (nothing to relay) rather than guess.
let projectId = '';
try {
  const envSource = readFileSync('{{appEnvPath}}', 'utf8');
  projectId = envSource.match(/projectId:\s*['"]([^'"]+)['"]/)?.[1] ?? '';
} catch {
  // leave empty
}

export default projectId
  ? { [`/${projectId}`]: { target, secure: false, changeOrigin: true } }
  : {};
