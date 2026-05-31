// Shape every environment file must satisfy. Kept as a real interface (not
// inferred from one file) so TypeScript sees the same widened types in both
// environment.ts and environment.prod.ts — no "literal `false` makes this
// branch unreachable" warnings in firebase.config.ts, and adding a new
// `environment.staging.ts` later is a one-line change.
//
// `emulators` is OPTIONAL. The production environment omits it entirely —
// emulator endpoints have no meaning in prod, and any string/number literals
// inside the `environment` const get baked into the prod bundle as data
// (DCE strips dead code paths, not unreachable property values on a live
// object), so carrying them would leak local dev addresses into shipped
// artifacts. firebase.config.ts narrows the optional behind
// `if (!environment.production && environment.emulators) { ... }` so the
// access is type-safe and only the dev bundle ever sees the property.
export interface Environment {
  production: boolean;
  firebase: {
    projectId: string;
    apiKey: string;
    appId: string;
  };
  emulators?: {
    auth: string;
    firestore: { host: string; port: number };
    storage: { host: string; port: number };
    functions: { host: string; port: number };
  };
}
