// 0.25.0 — retire-inline-house-sections: a frozen "Local servers" section retires whether or not the project wore Firebase.
//
// The section's fingerprint phrases once both sat inside the template's {{#firebase}} block, so a project
// scaffolded WITHOUT Firebase (CLAUDE.md.tmpl, ec7abcb … 296d706 / 0.4.0) rendered neither: its frozen copy was
// "kept but suspicious" beside the imported HOUSE.rules.md version, forever (house-doc runs the same table).
const RUNG = '0.25.0/retire-inline-house-sections';

/** The section as ec7abcb rendered it WITH Firebase (mustache markers resolved away). */
const WITH_FIREBASE = "## Local servers \u2014 never clobber a running server (non-negotiable)\n\n**When you start a server to test a change, you MUST bind it to a random free port \u2014 never the default (`4200`, or the emulator ports `8080`/`9099`/\u2026) or any container-forwarded port.** Those belong to whatever server the developer launched manually; grabbing them fails, silently attaches, or forces a disruptive restart. You verify **headless** (Playwright reaches any `localhost:<port>` directly), so you never need the forwarded ports \u2014 a random port costs nothing. Read the bound URL from the server's own startup output and point your browser there; tear the server down when done, and **never kill a server you didn't start** to free a port. Full rules \u2014 invoke the **`workflow:local-server-isolation`** skill.\nThe emulator suite is the trap: `tools/emulators.sh` **reaps existing emulator processes** on launch, so a plain `nx serve` to test would kill the developer's running suite (a random *app* port doesn't prevent that). The clean fix is **`yarn nx run <app>:serve-worktree --portOffset=auto`** \u2014 it shifts the entire stack (app + emulators, incl. the hub/logging ports) onto a free block and reaps only *its own* shifted ports, so it coexists with the developer's suite instead of killing it. Then open the app at the printed `?portOffset=N` URL. (Or, if you only changed the app: reuse the running suite by serving the app alone on a random port pointed at it.) Never boot a colliding suite on the base ports.\n";
/** The same template rendered WITHOUT Firebase. */
const WITHOUT_FIREBASE = "## Local servers \u2014 never clobber a running server (non-negotiable)\n\n**When you start a server to test a change, you MUST bind it to a random free port \u2014 never the default (`4200`) or any container-forwarded port.** Those belong to whatever server the developer launched manually; grabbing them fails, silently attaches, or forces a disruptive restart. You verify **headless** (Playwright reaches any `localhost:<port>` directly), so you never need the forwarded ports \u2014 a random port costs nothing. Read the bound URL from the server's own startup output and point your browser there; tear the server down when done, and **never kill a server you didn't start** to free a port. Full rules \u2014 invoke the **`workflow:local-server-isolation`** skill.\n";

const OURS = '# Shop\n\n## Our own notes\n\nKeep this.\n\n';
const project = (section) => (tree) => {
  tree.write('HOUSE.md', '# House\n');
  tree.write('CLAUDE.md', OURS + section);
};

export default {
  name: '0.25.0 · retire-inline-house-sections',
  ladder: [RUNG],
  cases: [
    {
      name: 'a frozen "Local servers" section is retired — with or without the Firebase paragraph',
      setup: project(WITH_FIREBASE),
      expect: (tree, t) => {
        t.hasNot('CLAUDE.md', 'Local servers');
        t.has('CLAUDE.md', 'Keep this.');
      },
      historicalShapes: [{ name: 'scaffolded without Firebase (ec7abcb … 296d706)', setup: project(WITHOUT_FIREBASE) }],
    },
  ],
};
