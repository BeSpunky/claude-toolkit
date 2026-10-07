// The Angular app's first SHELL — the skip link and the `<main>` landmark every app needs, written ONCE, when the
// adapter creates the app (class C: seeded, never owned — app.html is the app's from that moment on).
//
// WHY THE HOUSE WRITES IT. A skip link and a main landmark (WCAG 2.4.1 Bypass Blocks; the landmark screen readers
// jump to) are not a design decision, they are table stakes — and every project that hand-wrote them got some part
// wrong: the link into a component stylesheet that blew its budget, the landmark forgotten, or the classic Angular
// trap below. So the first shell starts with both, and the design system styles the link (`ds.skip-link()`, seeded
// into the global stylesheet as `.skip-link` when the app is wired to it).
//
// THE ANGULAR TRAP. With `<base href="/">`, a bare `href="#main"` resolves to `/#main` — clicking it on any route
// but the root NAVIGATES to the root. So the link keeps its href (a real, keyboard-reachable link, and the target
// is still stated) and its click moves focus to the landmark instead; `tabindex="-1"` makes `<main>` focusable by
// script without putting it in the tab order.
//
// What @nx/angular generated is kept, moved inside `<main>` — so its own spec (which asserts the welcome heading)
// still passes — and the spec gains a test for the shell, so a later edit that drops the landmark is caught.
import type { Tree } from '@nx/devkit';

const SKIP_LINK =
  '<!-- Skip link: the first stop for a keyboard user, straight to the content. Click, not href navigation: with\n' +
  '     <base href="/"> "#main" would route to the root. Styled by the design system as .skip-link (ds.skip-link()). -->\n' +
  '<a class="skip-link" href="#main" (click)="$event.preventDefault(); main.focus()">Skip to main content</a>';

export function seedAppShell(tree: Tree, root: string): void {
  const html = `${root}/src/app/app.html`;
  if (!tree.exists(html)) return;
  const current = tree.read(html, 'utf8') ?? '';
  if (/<main\b/.test(current) || current.includes('skip-link')) return;
  const body = current.trimEnd().split('\n').map((line) => (line ? `  ${line}` : line)).join('\n');
  tree.write(html, `${SKIP_LINK}\n<main id="main" #main tabindex="-1">\n${body}\n</main>\n`);

  const spec = `${root}/src/app/app.spec.ts`;
  const specText = tree.exists(spec) ? (tree.read(spec, 'utf8') ?? '') : '';
  const component = /TestBed\.createComponent\((\w+)\)/.exec(specText)?.[1];
  const close = specText.lastIndexOf('});');
  if (!component || close < 0 || specText.includes('skip-link')) return;
  const test =
    `\n  it('should offer a skip link to the main landmark', async () => {\n` +
    `    const fixture = TestBed.createComponent(${component});\n` +
    `    await fixture.whenStable();\n` +
    `    const compiled = fixture.nativeElement as HTMLElement;\n` +
    `    expect(compiled.querySelector('a.skip-link')?.getAttribute('href')).toBe('#main');\n` +
    `    expect(compiled.querySelector('main#main')).toBeTruthy();\n` +
    `  });\n`;
  tree.write(spec, `${specText.slice(0, close).trimEnd()}\n${test}${specText.slice(close)}`);
}
