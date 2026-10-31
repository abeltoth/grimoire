/**
 * Commands a window can send to the backend service.
 *
 * Each module adds its own commands by augmenting this interface:
 *
 *   declare module '@grimoire/contract' {
 *     interface CommandMap {
 *       'chat.send': { request: SendRequest; response: SendResult };
 *     }
 *   }
 *
 * Names are prefixed with the owning module ("core." for the core).
 */
export interface CommandMap {
  'core.ping': { request: Record<string, never>; response: PingResult };
}

export type CommandName = keyof CommandMap;
export type CommandRequest<K extends CommandName> = CommandMap[K]['request'];
export type CommandResponse<K extends CommandName> = CommandMap[K]['response'];

export interface PingResult {
  /** Process ID of the background service. */
  pid: number;
  /** Identifies the service build, so the app can replace a stale service. */
  buildId: string;
  /** When the service started, in ms since the epoch. */
  startedAt: number;
  uptimeMs: number;
  /** Node version the service runs on. */
  node: string;
}
