// Dev-server proxy — relay Firebase emulator traffic through the app's OWN origin instead of exposing the
// emulator ports to the host browser. GENERATOR-OWNED (rewritten on every --repair); don't edit.
//
// Why this exists: a forwarded emulator port is frequently squatted on Windows hosts (ASP.NET dev HTTPS,
// Intel services, …). A squatter that accepts the TCP connection but never answers leaves the request
// "Pending" until its deadline. Routing through the one port that must already work — the dev-server's —
// removes that whole failure class. The app opts in PER SERVICE via environment.ts's `emulators.<svc>.proxied`
// (firebase.config.ts then connects that emulator to the app's own origin):
//   - Functions callables — relayed at /<projectId>/** (the emulator serves /<projectId>/<region>/<fn>).
//   - Auth — relayed at the emulator's Google-API-shaped path prefixes (below). This matters MORE than
//     functions: an app usually gates every route on auth readiness, so a stalled :9099 leaves the app blank
//     AND sign-in hanging (one cause, two faces). Every prefix is hostname-shaped (has dots) or is /emulator,
//     so none can collide with an Angular route — the property that makes origin-relaying Auth safe.
//   - Firestore is NOT relayed here — its gRPC-Web/streaming transport needs its own design (a naive entry
//     won't work), so it still dials its emulator port directly.
//
// Offset-aware — the serve executor exports PORT_OFFSET for an isolated (worktree) stack, so each emulator
// runs at basePort + offset. A HARDCODED port would silently relay a worktree's traffic to a DIFFERENT tree's
// emulator; portFor() shifts every target by the same offset.
import { readFileSync } from 'node:fs';

// Session port offset (0 for the main/base stack; the serve executor sets it only for an isolated tree).
const rawOffset = Number(process.env.PORT_OFFSET ?? 0);
const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;

// Emulator ports — single-sourced from firebase.json at the workspace root (the dev-server's cwd), so
// changing a port in one place is enough. Falls back to the house default if unreadable.
let firebaseJson = {};
try {
  firebaseJson = JSON.parse(readFileSync('firebase.json', 'utf8'));
} catch {
  // keep the defaults — a project without a readable firebase.json isn't running the emulators anyway.
}
const portFor = (service, fallback) => {
  const port = firebaseJson?.emulators?.[service]?.port;
  return (Number.isInteger(port) ? port : fallback) + offset;
};

const functionsTarget = `http://localhost:${portFor('functions', 5001)}`;
const authTarget = `http://localhost:${portFor('auth', 9099)}`;

// The Auth emulator mimics Google's real Auth APIs as paths at its root. All four are needed: sign-in
// (identitytoolkit), the per-session ID-token refresh (securetoken — runs long after sign-in, not just at
// login), the legacy relyingparty API (www.googleapis.com), and /emulator (config + the popup/redirect OAuth
// handler). Relaying only the sign-in path half-works and then fails later. Each is hostname-shaped or
// /emulator → cannot collide with an app route.
const AUTH_PREFIXES = [
  '/identitytoolkit.googleapis.com',
  '/securetoken.googleapis.com',
  '/www.googleapis.com',
  '/emulator',
];

const relay = (target) => ({ target, secure: false, changeOrigin: true });

// Functions path prefix — projectId is the app's single source of truth (environment.ts); read as text,
// mirroring tools/emulators.sh which derives the emulator `--project` the same way. If it can't be read we
// skip the functions relay (nothing to key it on) rather than guess.
let projectId = '';
try {
  const envSource = readFileSync('{{appEnvPath}}', 'utf8');
  projectId = envSource.match(/projectId:\s*['"]([^'"]+)['"]/)?.[1] ?? '';
} catch {
  // leave empty
}

export default {
  ...(projectId ? { [`/${projectId}`]: relay(functionsTarget) } : {}),
  ...Object.fromEntries(AUTH_PREFIXES.map((path) => [path, relay(authTarget)])),
};
