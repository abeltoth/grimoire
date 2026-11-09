import type { EventName, EventPayload } from '@grimoire/contract';

export type Emit = <K extends EventName>(event: K, payload: EventPayload<K>) => void;

/**
 * The service's events: each goes to every window, and to whatever in the
 * service listens for it, as a module does for another's or the core's.
 */
export class ServiceEvents {
  private readonly listeners = new Map<string, Set<(payload: never) => void>>();
  private windows: ((event: string, payload: unknown) => void) | undefined;

  readonly emit: Emit = (event, payload) => {
    this.windows?.(event, payload);
    for (const listener of this.listeners.get(event) ?? []) listener(payload as never);
  };

  on<K extends EventName>(event: K, listener: (payload: EventPayload<K>) => void): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  /** Sends every event from now on to the windows, once the server listens. */
  toWindows(broadcast: (event: string, payload: unknown) => void): void {
    this.windows = broadcast;
  }
}
