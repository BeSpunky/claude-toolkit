// THE FIRST SHELL — a new app starts with the <main> landmark (adapters/angular/app-shell); its first design-system
// wiring adds the skip link WITH its look (`.skip-link { @include ds.skip-link(); }`, `#main { @include
// ds.skip-target(); }`), once. Without a design system there is no link — never an unstyled one (R8-7). A later sync
// adds nothing: the shell and its stylesheet are the app's from creation on.
import { requireFromRepo } from '../../test-support/payload.mjs';
import { angularWorkspace } from '../workspaces.mjs';

const { getProjects } = requireFromRepo('@nx/devkit');
const RULE = '.skip-link {\n  @include ds.skip-link();\n}';
const TARGET = '#main {\n  @include ds.skip-target();\n}';

export default {
  name: 'app shell · skip link and main landmark, styled by the design system',
  cases: [
    {
      name: 'a new app in a design-system workspace: skip link + <main id="main">, spec guards it, the rule seeded once',
      needs: ['@nx/angular', '@nx/js'],
      once: 'it CREATES the design system and an app',
      setup: () => angularWorkspace({ layout: 'apps-libs', link: 'paths' }),
      run: async (tree, ctx) => {
        await ctx.load('generators/design-system/generator').default(tree, { skipFormat: true });
        await ctx.load('generators/app/generator').default(tree, { name: 'shop', skipFormat: true });
        // A later sync of the app's design-system wiring.
        await ctx.load('generators/design-system-styles/generator').default(tree, { project: 'shop', skipFormat: true });
      },
      expect: (tree, t) => {
        const root = getProjects(tree).get('shop')?.root;
        const html = t.read(`${root}/src/app/app.html`);
        t.ok(/^<!--[\s\S]*-->\n<a class="skip-link" href="#main" \(click\)="\$event\.preventDefault\(\); main\.focus\(\)">Skip to main content<\/a>\n<main id="main" #main tabindex="-1">\n[\s\S]*<router-outlet[\s\S]*<\/main>\n$/.test(html), `the shell:\n${html}`);
        t.has(`${root}/src/app/app.html`, 'Welcome shop'); // @nx/angular's own content kept (its spec asserts it)
        t.has(`${root}/src/app/app.spec.ts`, "querySelector('a.skip-link')?.getAttribute('href')).toBe('#main')");
        t.has(`${root}/src/app/app.spec.ts`, "querySelector('main#main')");
        t.occurrences(`${root}/src/app/app.spec.ts`, "it('", 3);
        t.occurrences(`${root}/src/styles.scss`, RULE, 1);
        t.occurrences(`${root}/src/styles.scss`, TARGET, 1);
        t.ok(t.read(`${root}/src/styles.scss`).indexOf(RULE) > t.read(`${root}/src/styles.scss`).indexOf('@include ds.theme();'), 'after the theme');
        const ds = getProjects(tree).get('design-system')?.root;
        t.exists(`${ds}/styles/_utils/_a11y.scss`);
        t.has(`${ds}/styles/_index.scss`, "@forward '_utils/a11y' show visually-hidden, skip-link, skip-target;");
      },
    },
    {
      name: 'a new app with no design system: the <main> landmark, and NO skip link — never one without its look',
      needs: ['@nx/angular', '@nx/js'],
      once: 'it CREATES an app',
      setup: () => angularWorkspace({ layout: 'apps-libs', link: 'paths' }),
      run: async (tree, ctx) => {
        await ctx.load('generators/app/generator').default(tree, { name: 'shop', skipFormat: true });
      },
      expect: (tree, t) => {
        const root = getProjects(tree).get('shop')?.root;
        const html = t.read(`${root}/src/app/app.html`);
        t.ok(/^<main id="main" #main tabindex="-1">\n[\s\S]*<\/main>\n$/.test(html), `the landmark only:\n${html}`);
        t.hasNot(`${root}/src/app/app.html`, 'skip-link');
        t.hasNot(`${root}/src/app/app.spec.ts`, 'skip-link');
        t.has(`${root}/src/app/app.spec.ts`, "querySelector('main#main')");
      },
    },
  ],
};
