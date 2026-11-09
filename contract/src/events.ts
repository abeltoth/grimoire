/**
 * Events the backend service pushes to windows.
 *
 * Modules add their own events by augmenting this interface, the same way
 * as CommandMap. The core defines none yet.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- modules fill it in.
export interface EventMap {}

export type EventName = keyof EventMap;
export type EventPayload<K extends EventName> = EventMap[K];
