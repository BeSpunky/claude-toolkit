// Per-session emulator overrides — flip which Firebase services use the LOCAL emulator vs the REAL
// backend WITHOUT editing environment.ts or rebuilding. Read once at app start by firebase.config.ts.
//
// This file is GENERATOR-OWNED (rewritten on every `--repair --firebase`) — don't edit it by hand;
// change the committed defaults in environment.ts (the `EMULATE` map) instead.
//
// Sources, later wins:  committed default (environment.ts EMULATE)  <  localStorage  <  URL query.
//   ?emulate=firestore,storage   → ONLY these services emulated this session (others real). `all`/`none` work.
//   ?real=auth                   → force these services to the REAL backend this session.
//   localStorage.setItem('emulate','firestore');  localStorage.setItem('real','auth');   // persists per browser
//   localStorage.removeItem('emulate');  // drop the override, fall back to the committed defaults
//
// Browser/SSR-safe: with no `window` it returns the committed defaults unchanged. It ships only in
// the dev bundle — firebase.config.ts calls it behind the `environment.production` literal, so the
// production build tree-shakes this whole module away.
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
 * services off. localStorage is applied first, then the URL query (so the query wins).
 */
export function resolveEmulated(
  defaults: Record<EmulatorService, boolean>,
  win: Window | undefined = typeof window === 'undefined' ? undefined : window
): Record<EmulatorService, boolean> {
  const result: Record<EmulatorService, boolean> = { ...defaults };
  if (!win) return result;

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

  apply(fromStorage(win)); // localStorage
  apply(fromQuery(win)); // URL query — wins
  return result;
}
