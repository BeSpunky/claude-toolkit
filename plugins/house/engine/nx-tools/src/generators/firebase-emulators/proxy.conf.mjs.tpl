// Dev-server proxy — the browser reaches EVERY Firebase emulator through the app's OWN origin, and this file
// relays each one to the suite inside the container. GENERATOR-OWNED (rewritten on every upgrade); don't edit.
//
// Why: the browser is the one party that cannot know the emulators' ports. It runs on the HOST, where the editor
// forwards container ports to whatever host port is free (4200→4201, 8080→8081, …) without telling anything in
// the container; and on a worktree's shifted stack every emulator sits at basePort + offset. The page's own
// origin is the one address that is right in every one of those cases — the browser just loaded the app from
// it. So firebase.config.ts connects every emulated service to `location`, and this table sends each service's
// paths on to its emulator:
//   - Auth — its Google-API-shaped prefixes. All four are needed: sign-in (identitytoolkit), the per-session
//     ID-token refresh (securetoken — long after sign-in), the legacy relyingparty API (www.googleapis.com), and
//     /emulator (config + the popup/redirect OAuth handler).
//   - Firestore — its WebChannel streams (Listen/Write, under /google.firestore.v1.Firestore) and its unary REST
//     calls (commit, batchGet, runQuery…, under /v1/projects/<projectId>/databases). Plain HTTP streaming, which
//     the dev server's proxy passes through unbuffered.
//   - Storage — /v0/b. Its resumable upload hands the browser an ABSOLUTE upload URL built from the Host header
//     the emulator saw — the emulator's own port behind a plain relay, 127.0.0.1:<port> behind the worktree-domains
//     proxy — so the relay rewrites it to a path, which the browser resolves against the page's origin.
//   - Functions callables — /<projectId>/** (the emulator serves /<projectId>/<region>/<fn>).
// Every prefix is hostname-shaped, /emulator, /v0/b, or carries the project id, so none collides with an app route.
//
// The relay is plain http, like the SDK's emulator connections themselves — firebase.config.ts refuses, with the
// reason, when the page is served over https.
//
// Offset-aware — the dev engine exports PORT_OFFSET for a shifted (worktree) stack, so each emulator runs at
// basePort + offset. A HARDCODED port would silently relay a worktree's traffic to a DIFFERENT tree's emulator;
// portFor() shifts every target by the same offset.
import { readFileSync } from 'node:fs';

// The stack's port offset (0 for the base stack; the dev engine sets it only for a shifted one).
const rawOffset = Number(process.env.PORT_OFFSET ?? 0);
const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;

// Emulator ports — single-sourced from firebase.json at the workspace root (the dev-server's cwd), so changing a
// port in one place is enough. Falls back to the house default if unreadable.
let firebaseJson = {};
try {
  firebaseJson = JSON.parse(readFileSync('firebase.json', 'utf8'));
} catch {
  // keep the defaults — a project without a readable firebase.json isn't running the emulators anyway.
}
const targetOf = (service, fallback) => {
  const port = firebaseJson?.emulators?.[service]?.port;
  return `http://localhost:${(Number.isInteger(port) ? port : fallback) + offset}`;
};

// The project id keys the Functions and Firestore REST prefixes — the app's single source of truth is
// environment.ts, read as text (tools/emulators.sh derives the suite's `--project` the same way). If it can't be
// read those two prefixes are skipped (nothing to key them on) rather than guessed.
let projectId = '';
try {
  const envSource = readFileSync('{{appEnvPath}}', 'utf8');
  projectId = envSource.match(/projectId:\s*['"]([^'"]+)['"]/)?.[1] ?? '';
} catch {
  // leave empty
}

// Storage's resumable-upload URL, made origin-relative (see the header). Hooked for both proxy engines an Angular
// dev server may run: Vite's (`configure`) and webpack-dev-server's (`onProxyRes`).
const relativeUploadUrl = (proxyRes) => {
  const url = proxyRes.headers['x-goog-upload-url'];
  if (typeof url !== 'string' || url.startsWith('/')) return;
  try {
    const { pathname, search } = new URL(url);
    proxyRes.headers['x-goog-upload-url'] = `${pathname}${search}`;
  } catch {
    // not a URL — leave it as the emulator sent it
  }
};

const relay = (target) => ({ target, secure: false, changeOrigin: true });

const ROUTES = [
  { service: 'auth', port: 9099, prefixes: ['/identitytoolkit.googleapis.com', '/securetoken.googleapis.com', '/www.googleapis.com', '/emulator'] },
  { service: 'firestore', port: 8080, prefixes: ['/google.firestore.v1.Firestore', ...(projectId ? [`/v1/projects/${projectId}/databases`] : [])] },
  {
    service: 'storage',
    port: 9199,
    prefixes: ['/v0/b'],
    extra: { configure: (proxy) => proxy.on('proxyRes', relativeUploadUrl), onProxyRes: relativeUploadUrl },
  },
  { service: 'functions', port: 5001, prefixes: projectId ? [`/${projectId}`] : [] },
];

export default Object.fromEntries(
  ROUTES.flatMap(({ service, port, prefixes, extra }) =>
    prefixes.map((prefix) => [prefix, { ...relay(targetOf(service, port)), ...extra }]),
  ),
);
