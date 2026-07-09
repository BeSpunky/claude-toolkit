import {
  Injectable,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
// TODO: point this import at your navigation-core lib.
import { useNavigationX, useNavigationLinks, bindEvents } from '@navigation-core';
import { {{propertyName}}Routes } from './{{fileName}}.routes';
import { {{className}}Events, type {{className}}Event } from './{{fileName}}.events';

// The auto-derived typed NAVIGATOR (navigates). Method names come from the route tree's
// friendlyName (toList / toCreate / toDetail / toEdit). Call inside an injection context.
export const use{{className}}Navigation = () => useNavigationX({{propertyName}}Routes);

// The auto-derived LINK composer (returns the path VALUE for [bsNavLink] / [routerLink],
// so links keep a real href). Same method names as the navigator:
//   const links = use{{className}}Links();
//   <a [bsNavLink]="links.toDetail(entity)">label</a>
export const use{{className}}Links = () => useNavigationLinks({{propertyName}}Routes);

// PURE mapping: event -> which navigator method to call. Multiple events can fold into
// the same navigation here. Unit-test with a stub navigator (no Router). Adjust the
// method names if you change the route friendlyNames.
export function {{propertyName}}EventToNavigation(
  nav: ReturnType<typeof use{{className}}Navigation>,
  event: {{className}}Event
): unknown {
  switch (event.type) {
    case 'listOpened':
      return nav.toList();
    case 'createRequested':
      return nav.toCreate();
    case 'detailRequested':
      return nav.toDetail(event.entity);
    case 'editRequested':
      return nav.toEdit(event.entity);
  }
}

// Hooks the {{className}} event bus to the navigator (the only per-domain wiring).
@Injectable({ providedIn: 'root' })
export class {{className}}NavigationBinding {
  private readonly nav = use{{className}}Navigation();
  private readonly events = inject({{className}}Events);

  constructor() {
    bindEvents(this.events, (event) => {{propertyName}}EventToNavigation(this.nav, event));
  }
}

// Add to the domain route's `providers` (or app config) so the binding runs eagerly.
export function provide{{className}}Navigation(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => inject({{className}}NavigationBinding)),
  ]);
}
