// Shape every environment file must satisfy. Kept as a real interface (not
// inferred from one file) so TypeScript sees the same widened types in both
// environment.ts and environment.prod.ts — no "literal `false` makes this
// branch unreachable" warnings in firebase.config.ts, and adding a new
// `environment.staging.ts` later is a one-line change.
//
// Emulator endpoints are kept on the type even in production: the prod
// environment file ships the same shape (just unused), which lets the build
// switch files without changing types. The emulator wiring is gated behind
// `!environment.production` in firebase.config.ts, so @angular/build
// tree-shakes those branches out of the prod bundle.
export interface Environment {
  production: boolean;
  firebase: {
    projectId: string;
    apiKey: string;
    appId: string;
  };
  emulators: {
    auth: string;
    firestore: { host: string; port: number };
    storage: { host: string; port: number };
    functions: { host: string; port: number };
  };
}
