import { type EnvironmentProviders, makeEnvironmentProviders, inject, provideAppInitializer } from '@angular/core';

import { DsTheme } from './ds-theme.service';

/**
 * Install the design system into an Angular app.
 *
 *     // app.config.ts
 *     export const appConfig: ApplicationConfig = {
 *       providers: [..., provideDesignSystem()],
 *     };
 *
 * All this does today is EAGERLY instantiate `DsTheme` at startup — so the service's `effect` (which
 * writes the mode attribute) runs from app boot rather than from whenever the first component happens to
 * inject the theme. (This does NOT prevent a first-paint flash for a persisted explicit choice — only an
 * inline <head> script can, because it runs before paint; see `DsTheme`'s doc. For the default `'system'`
 * mode there's no flash to prevent: the CSS resolves the OS preference on its own.)
 *
 * It is also the seam for any future DS-wide configuration (a default mode, a brand). Keep that seam
 * narrow: the design system is tokens + SASS + components, not a framework.
 */
export function provideDesignSystem(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideAppInitializer(() => {
      inject(DsTheme);
    }),
  ]);
}
