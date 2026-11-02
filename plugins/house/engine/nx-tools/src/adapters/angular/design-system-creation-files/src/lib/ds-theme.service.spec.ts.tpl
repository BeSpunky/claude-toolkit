import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DsTheme } from './ds-theme.service';

describe('DsTheme', () => {
  const MODE_ATTRIBUTE = 'data-{{tokenPrefix}}-mode';

  const root = () => TestBed.inject(DOCUMENT).documentElement;

  afterEach(() => root().removeAttribute(MODE_ATTRIBUTE));

  it('writes the chosen mode to the document', () => {
    const theme = TestBed.inject(DsTheme);

    theme.mode.set('dark');
    TestBed.tick();

    expect(root().getAttribute(MODE_ATTRIBUTE)).toBe('dark');
  });

  it("removes the attribute for 'system', so the design system's default takes over", () => {
    const theme = TestBed.inject(DsTheme);

    theme.mode.set('dark');
    TestBed.tick();
    theme.mode.set('system');
    TestBed.tick();

    expect(root().hasAttribute(MODE_ATTRIBUTE)).toBe(false);
  });
});
