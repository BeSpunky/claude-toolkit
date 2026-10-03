import { Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject } from 'rxjs';

// BeSpunky addition to the navigation-x kernel.
//
// A reusable, strongly-typed domain EVENT BUS. Extend it with a domain event union:
//
//   export type OrderEvent = { type: 'orderSelected'; order: Order } | ...;
//   @Injectable({ providedIn: 'root' })
//   export class OrdersEvents extends EventBus<OrderEvent> {}
//
// Components emit FACTS (orderSelected), never destinations; a pure binding maps
// events -> navigation. Events are programmatic/decoupled flows — a plain link to a
// place still stays a real <a> via the composer + BsNavLinkDirective.
@Injectable()
export class EventBus<TEvent> {
  private readonly subject = new Subject<TEvent>();
  readonly events$: Observable<TEvent> = this.subject.asObservable();

  emit(event: TEvent): void {
    this.subject.next(event);
  }
}

// Hooks a bus to a handler (typically a pure `event -> navigation command` mapper),
// auto-unsubscribing with the surrounding injection context's lifecycle. Call it from
// a constructor / injection context.
export function bindEvents<TEvent>(bus: EventBus<TEvent>, handle: (event: TEvent) => void): void {
  bus.events$.pipe(takeUntilDestroyed()).subscribe(handle);
}
