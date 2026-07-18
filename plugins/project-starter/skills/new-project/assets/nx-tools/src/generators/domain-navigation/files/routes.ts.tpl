// TODO: point this import at your navigation-core lib (a path alias is cleanest,
// e.g. "@my-workspace/navigation-core", or a relative path to libs/navigation-core).
import { routeConfigFor } from '@navigation-core';
import type { {{className}}Entity } from './{{fileName}}.events';

// The {{className}} domain's route tree — defined ONCE, strongly typed to the entity.
// The auto-derived navigator (use{{className}}Navigation) and the link composer
// (use{{className}}Links) both derive from this, and the strong Router typing too.
//
// Rules:
//   - Pass the config `as const` (required for the type derivation).
//   - `friendlyName` names the generated navigator method (e.g. 'Detail' -> `toDetail`).
//     The root uses 'List' so the list navigator is `toList()` regardless of domain name.
//   - The `:id` arg maps to a property of {{className}}Entity (here, `id`).
//   - Wire `loadComponent` / `component` per route as usual.
const {{propertyName}} = routeConfigFor<{{className}}Entity>();

export const {{propertyName}}Routes = {{propertyName}}.route({
  path: '{{fileName}}',
  friendlyName: 'List',
  // loadComponent: () => import('./pages/{{fileName}}-list.page').then((m) => m.{{className}}ListPage),
  children: [
    { path: 'new', friendlyName: 'Create' /*, loadComponent: ... */ },
    {
      path: ':id',
      friendlyName: 'Detail' /*, loadComponent: ... */,
      children: [{ path: 'edit', friendlyName: 'Edit' /*, loadComponent: ... */ }],
    },
  ],
} as const);

// Register with: provideRouterX([ {{propertyName}}Routes ])  (from navigation-core)
