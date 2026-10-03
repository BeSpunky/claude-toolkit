import { Injectable, computed, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';

// BeSpunky addition to the navigation-x kernel.
//
// The reusable READ side: typed signals derived from the URL (the single source of
// truth). Extend per domain and add `computed()` selectors on top:
//
//   @Injectable({ providedIn: 'root' })
//   export class OrdersRouteState extends RouteState {
//     readonly statusFilter = computed(() => this.query()['status'] ?? 'all');
//   }
@Injectable({ providedIn: 'root' })
export class RouteState {
  protected readonly router = inject(Router);

  // Re-derived on every navigation, so it never goes stale on back/forward.
  readonly tree = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.parseUrl(this.router.url))
    ),
    { initialValue: this.router.parseUrl(this.router.url) }
  );

  readonly query = computed(() => this.tree().queryParams as Record<string, string | undefined>);
  readonly fragment = computed(() => this.tree().fragment ?? null);

  /** A reactive selector for a single query param. */
  queryParam(name: string) {
    return computed(() => this.query()[name] ?? null);
  }
}
