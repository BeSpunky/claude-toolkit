// The Angular app's first SHELL — the `<main>` landmark every app needs and, once the design system styles it, the
// skip link to it. Written ONCE (class C: seeded, never owned — app.html is the app's from that moment on).
//
// WHY THE HOUSE WRITES IT. A skip link and a main landmark (WCAG 2.4.1 Bypass Blocks; the landmark screen readers
// jump to) are not a design decision, they are table stakes — and every project that hand-wrote them got some part
// wrong: the link into a component stylesheet that blew its budget, the landmark forgotten, or the classic Angular
// trap below.
//
// TWO HALVES, TWO OWNERS — because one of them has a look and the other has none:
//   - the LANDMARK (`seedLandmark`) is structure: no pixel of it is visible, so the stack writes it when it creates
//     the app, whatever else the workspace wears;
//   - the SKIP LINK (`addSkipLink`) is a visible control, and design-system-first says its look comes from the design
//     system or not at all — an unstyled "Skip to main content" printed at the top of every page is worse than none.
//     So it is added by the design system's per-app step (design-system-styles), on the app's FIRST wiring, through
//     this adapter's `shell` port — in the same act that seeds `.skip-link { @include ds.skip-link(); }`. A workspace
//     with no design system gets the landmark and no link.
//
// THE ANGULAR TRAP. With `<base href="/">`, a bare `href="#main"` resolves to `/#main` — clicking it on any route
// but the root NAVIGATES to the root. So the link keeps its href (a real, keyboard-reachable link, and the target
// is still stated) and its click moves focus to the landmark instead; `tabindex="-1"` makes `<main>` focusable by
// script without putting it in the tab order (`ds.skip-target()` keeps that programmatic focus from outlining the
// whole content area).
//
// What @nx/angular generated is kept, moved inside `<main>` — so its own spec (which asserts the welcome heading)
// still passes — and the spec gains a test per half, so a later edit that drops either is caught.
import type { Tree } from '@nx/devkit';

const LANDMARK = '<main id="main" #main tabindex="-1">';

const SKIP_LINK =
  '<!-- Skip link: the first stop for a keyboard user, straight to the content. Click, not href navigation: with\n' +
  '     <base href="/"> "#main" would route to the root. Styled by the design system as .skip-link (ds.skip-link()). -->\n' +
  '<a class="skip-link" href="#main" (click)="$event.preventDefault(); main.focus()">Skip to main content</a>';

/** At creation: the app's content moved inside the `<main>` landmark, and a spec test guarding it. */
export function seedLandmark(tree: Tree, root: string): void {
  const html = `${root}/src/app/app.html`;
  if (!tree.exists(html)) return;
  const current = tree.read(html, 'utf8') ?? '';
  if (/<main\b/.test(current)) return;
  const body = current.trimEnd().split('\n').map((line) => (line ? `  ${line}` : line)).join('\n');
  tree.write(html, `${LANDMARK}\n${body}\n</main>\n`);
  addSpecTest(tree, root, 'main#main', [
    `  it('should render its content in the main landmark', async () => {`,
    `    const fixture = TestBed.createComponent(%C);`,
    `    await fixture.whenStable();`,
    `    expect((fixture.nativeElement as HTMLElement).querySelector('main#main')).toBeTruthy();`,
    `  });`,
  ]);
}

export type SkipLinkResult = 'added' | 'present' | 'no-landmark';

/**
 * The skip link, before the house landmark — only into a shell that has it (`<main id="main"`), and never twice.
 * An app whose shell is its own (no house landmark) is left alone: the caller says how to adopt it.
 */
export function addSkipLink(tree: Tree, root: string): SkipLinkResult {
  const html = `${root}/src/app/app.html`;
  const current = tree.exists(html) ? (tree.read(html, 'utf8') ?? '') : '';
  if (current.includes('skip-link')) return 'present';
  const at = current.indexOf('<main id="main"');
  if (at < 0) return 'no-landmark';
  tree.write(html, `${current.slice(0, at)}${SKIP_LINK}\n${current.slice(at)}`);
  addSpecTest(tree, root, 'a.skip-link', [
    `  it('should offer a skip link to the main landmark', async () => {`,
    `    const fixture = TestBed.createComponent(%C);`,
    `    await fixture.whenStable();`,
    `    expect((fixture.nativeElement as HTMLElement).querySelector('a.skip-link')?.getAttribute('href')).toBe('#main');`,
    `  });`,
  ]);
  return 'added';
}

/** Append a test to the app's own spec, for the component it already creates — once (keyed on `marker`). */
function addSpecTest(tree: Tree, root: string, marker: string, lines: string[]): void {
  const spec = `${root}/src/app/app.spec.ts`;
  const specText = tree.exists(spec) ? (tree.read(spec, 'utf8') ?? '') : '';
  const component = /TestBed\.createComponent\((\w+)\)/.exec(specText)?.[1];
  const close = specText.lastIndexOf('});');
  if (!component || close < 0 || specText.includes(marker)) return;
  const test = `\n${lines.join('\n').replace('%C', component)}\n`;
  tree.write(spec, `${specText.slice(0, close).trimEnd()}\n${test}${specText.slice(close)}`);
}
