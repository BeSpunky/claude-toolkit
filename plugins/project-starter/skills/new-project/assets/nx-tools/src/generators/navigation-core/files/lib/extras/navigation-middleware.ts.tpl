import { InjectionToken } from '@angular/core';

// BeSpunky addition to the navigation-x kernel.
//
// Navigation MIDDLEWARE — the one place for cross-cutting concerns, because all
// navigation funnels through the kernel. A middleware returns false (or a
// Promise<false>) to veto the navigation: unsaved-changes confirmation, auth +
// returnUrl, analytics, scroll restoration. Register several via the multi-token; the
// navigator runs them in order before navigating.
export type NavigationMiddleware = (url: string) => boolean | Promise<boolean>;

export const NAVIGATION_MIDDLEWARE = new InjectionToken<NavigationMiddleware[]>('NAVIGATION_MIDDLEWARE');

// Runs the chain; returns false as soon as one vetoes (so the caller skips navigation).
export async function runNavigationMiddleware(
  middleware: NavigationMiddleware[] | null,
  url: string
): Promise<boolean> {
  for (const mw of middleware ?? []) {
    if (!(await mw(url))) return false;
  }
  return true;
}
