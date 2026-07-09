import { Injectable } from '@angular/core';
// TODO: point this import at your navigation-core lib.
import { EventBus } from '@navigation-core';

// TODO: replace with (or import) your real {{className}} entity. The route ':id' arg
// maps to a property of this shape.
export interface {{className}}Entity {
  id: string;
}

// Domain events are FACTS / INTENTS (what the user did), never destinations — the
// mapper in {{fileName}}.navigation.ts decides where each event navigates.
export type {{className}}Event =
  | { type: 'listOpened' }
  | { type: 'createRequested' }
  | { type: 'detailRequested'; entity: {{className}}Entity }
  | { type: 'editRequested'; entity: {{className}}Entity };

// The per-domain bus — just the event union plugged into the reusable EventBus kernel.
@Injectable({ providedIn: 'root' })
export class {{className}}Events extends EventBus<{{className}}Event> {}
