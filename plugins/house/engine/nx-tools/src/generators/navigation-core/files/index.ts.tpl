// navigation-core — the self-contained navigation kernel.
//
// The composer + the auto-derived typed navigator are VENDORED from BeSpunky's
// navigation-x (@bespunky/angular-zen/router-x/navigation, preview): routeConfigFor,
// provideRouterX / provideRoutesX, useNavigationX, RouteComposer, and the strong
// Router typing. Treat lib/* (except extras/) as upstream — re-sync from navigation-x
// rather than editing in place. The extras/ are BeSpunky reusable additions that
// navigation-x doesn't (yet) ship: the real-href link directive, the URL read-side,
// the typed event bus + binding, and navigation middleware.

// --- navigation-x kernel (vendored verbatim) ---
export * from './lib/navigation-x.injector';
export * from './lib/navigation-x.providers';
export * from './lib/navigation-x.route-creator';
export * from './lib/route-composer/router-composer';
export * from './lib/types/strong-router';

// --- BeSpunky reusable additions ---
export * from './lib/extras/bs-nav-link.directive';
export * from './lib/extras/route-state';
export * from './lib/extras/event-bus';
export * from './lib/extras/navigation-middleware';
export * from './lib/extras/use-navigation-links';
