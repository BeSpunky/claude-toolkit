// The dev server's proxy routes of THIS PROJECT'S OWN — seeded once by the house, never rewritten: it is yours.
//
// proxy.conf.mjs beside this file (generator-owned) relays the Firebase emulators and merges whatever this file
// exports AFTER its own routes — for Angular's dev server (its `proxyConfig`, Vite or webpack) and for a bare Vite
// config (`server: { proxy: viteProxy }`) alike. Each entry is ordinary http-proxy options, keyed by a PLAIN PATH
// PREFIX — end it with `/` so it can't capture a longer route of the app's:
//
//   export default {
//     '/api/': { target: 'http://localhost:3000', changeOrigin: true, pathRewrite: { '^/api': '' } },
//   };
//
// A plain prefix is the one match every one of those engines reads alike, so a glob, a `^` regex or a function
// context is refused at dev-server start, with the reason. A key that repeats one of the house's routes replaces it,
// and the dev server says so when it starts.
export default {};
