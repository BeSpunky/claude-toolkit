import { Injectable, computed } from '@angular/core';
// TODO: point this import at your navigation-core lib.
import { RouteState } from '@navigation-core';

// The {{className}} read side: extend the reusable RouteState kernel with domain
// selectors. RouteState already exposes `tree()`, `query()`, `fragment()` and
// `queryParam(name)` as signals derived from the URL — components react to these, so
// the back button, a deep link and a click all update the UI identically.
@Injectable({ providedIn: 'root' })
export class {{className}}RouteState extends RouteState {
  // Example — replace / extend for your domain's query state:
  readonly statusFilter = computed(() => this.query()['status'] ?? 'all');
}
