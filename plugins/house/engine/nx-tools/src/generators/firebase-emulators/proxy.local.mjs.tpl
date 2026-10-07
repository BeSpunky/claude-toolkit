// The dev server's proxy routes of THIS PROJECT'S OWN — seeded once by the house, never rewritten: it is yours.
//
// proxy.conf.mjs beside this file (generator-owned, the dev server's `proxyConfig`) relays the Firebase emulators
// and merges whatever this file exports AFTER its own routes. Each entry is an ordinary Angular proxy-config entry
// (http-proxy options), keyed by a path prefix — end it with `/` so it can't capture a longer route of the app's:
//
//   export default {
//     '/api/': { target: 'http://localhost:3000', changeOrigin: true },
//   };
export default {};
