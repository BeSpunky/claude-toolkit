// Per-session emulator overrides — flip which Firebase services use the LOCAL emulator vs the REAL
// backend WITHOUT editing environment.ts or rebuilding. Read once at app start by firebase.config.ts.
//
// This file is GENERATOR-OWNED (rewritten on every upgrade of a Firebase project) — don't edit it by hand;
// change the committed defaults in environment.ts (the `EMULATE` map) instead.
//
// Sources, later wins:  committed default (environment.ts EMULATE)  <  localStorage  <  URL query.
//   ?emulate=firestore,storage   → ONLY these services emulated this session (others real). `all`/`none` work.
//   ?emulate=none  /  ?real=all  → GO FULLY REAL: every service resolves to the real backend (the
//                                  `firebase` block in environment.ts). This is how `serve --no-emulators`
//                                  makes the app run against the real project — a runtime override, not a
//                                  build/env variant. (Verified supported: parseList('none') → empty set,
//                                  parseList('all') → all services; see parseList + apply() below.)
//   ?real=auth                   → force these services to the REAL backend this session.
//   localStorage.setItem('emulate','firestore');  localStorage.setItem('real','auth');   // persists per browser
//   localStorage.removeItem('emulate');  // drop the override, fall back to the committed defaults
//
// ON THE SERVER (SSR) there is no URL of the page's and no localStorage, so the server applies the one per-session
// choice it can share with the browser: the STACK's. The dev engine opens the app with its URL switches
// (`?emulate=none` when the suite is skipped — `serve --no-emulators`) and exports the same query to every process
// of the stack as DEV_URL_QUERY, which the server reads exactly as the browser reads its URL. So a server render and
// the page it hydrates resolve the same services. What a person types into one tab (`?real=auth`, localStorage) is
// that tab's alone: a server instance serves every tab, and an SDK instance connected to an emulator cannot be
// disconnected per request — so for a per-tab choice the server keeps the stack's, and the two can differ.
//
// It ships only in the dev bundle — firebase.config.ts calls it behind `ngDevMode`, which the optimizer folds to
// `false` in production builds, so the production build tree-shakes this whole module away.
export type EmulatorService = 'auth' | 'firestore' | 'storage' | 'functions';

const SERVICES: readonly EmulatorService[] = ['auth', 'firestore', 'storage', 'functions'];

const isService = (s: string): s is EmulatorService => (SERVICES as readonly string[]).includes(s);

// 'all' → every service; 'none'/'' → none; otherwise a comma list of service names (unknown names ignored).
function parseList(value: string): Set<EmulatorService> {
  const v = value.trim().toLowerCase();
  if (v === 'all') return new Set(SERVICES);
  if (v === 'none' || v === '') return new Set();
  return new Set(v.split(',').map((s) => s.trim()).filter(isService));
}

function fromQuery(win: Window): { emulate: string | null; real: string | null } {
  try {
    const q = new URLSearchParams(win.location?.search ?? '');
    return { emulate: q.get('emulate'), real: q.get('real') };
  } catch {
    return { emulate: null, real: null };
  }
}

/** The stack's URL switches, as the dev engine exports them to a server process (no `process` → none). */
function fromStack(): { emulate: string | null; real: string | null } {
  const query = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.['DEV_URL_QUERY'];
  if (!query) return { emulate: null, real: null };
  const q = new URLSearchParams(query);
  return { emulate: q.get('emulate'), real: q.get('real') };
}

function fromStorage(win: Window): { emulate: string | null; real: string | null } {
  try {
    return {
      emulate: win.localStorage?.getItem('emulate') ?? null,
      real: win.localStorage?.getItem('real') ?? null,
    };
  } catch {
    // localStorage can throw (privacy mode, sandboxed iframe) — treat as "no override".
    return { emulate: null, real: null };
  }
}

/**
 * Resolve the effective on/off per service from the committed defaults and any per-session override.
 *
 * `emulate` REPLACES the on-set with exactly the listed services; `real` then forces the listed
 * services off. In the browser localStorage is applied first, then the URL query (so the query wins); on the
 * server (no `win`), the stack's query from DEV_URL_QUERY.
 */
export function resolveEmulated(
  defaults: Record<EmulatorService, boolean>,
  win: Window | undefined = typeof window === 'undefined' ? undefined : window
): Record<EmulatorService, boolean> {
  const result: Record<EmulatorService, boolean> = { ...defaults };
  const apply = (src: { emulate: string | null; real: string | null }): void => {
    if (src.emulate != null) {
      const on = parseList(src.emulate);
      for (const s of SERVICES) result[s] = on.has(s);
    }
    if (src.real != null) {
      const off = parseList(src.real);
      for (const s of SERVICES) if (off.has(s)) result[s] = false;
    }
  };

  if (!win) {
    apply(fromStack()); // the server: the stack's switches, the ones the browser was opened with
    return result;
  }
  apply(fromStorage(win)); // localStorage
  apply(fromQuery(win)); // URL query — wins
  return result;
}
