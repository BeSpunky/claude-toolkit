import { collectRouteComposersByAutoNavigatorName } from '../route-composer/_utils';

// BeSpunky addition to the navigation-x kernel.
//
// The VALUE twin of `useNavigationX`. Where useNavigationX returns navigators that
// NAVIGATE (side effect), this returns, per route, a function that COMPOSES the path —
// `(entity) => '/orders/5/edit'` — the value you bind to [bsNavLink] / [routerLink] so
// links keep a real href (copy / open-in-new-tab / a11y). Same auto-derived method
// names as the navigator (toCreate, toDetail, ...).
//
//   const links = useNavigationLinks(ordersRoutes);
//   // <a [bsNavLink]="links.toDetail(order)">{ order.name }</a>
//
// (Loosely typed for now — returns string-producing methods keyed by navigator name;
// it can later be strengthened to mirror the navigator's exact method/arg types.)
export function useNavigationLinks(
  route: Parameters<typeof collectRouteComposersByAutoNavigatorName>[0]
): Record<string, (entity?: unknown) => string> {
  const composers = collectRouteComposersByAutoNavigatorName(route);
  const links: Record<string, (entity?: unknown) => string> = {};

  composers.forEach((composer, name) => {
    links[name] = composer.hasArgs
      ? (entity?: unknown) => (composer.compose as (e: unknown) => string)(entity)
      : () => composer.compose() as string;
  });

  return links;
}
