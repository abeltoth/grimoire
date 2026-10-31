/**
 * The protocol between the Electron app and the background service, over a
 * local socket (a named pipe on Windows, a Unix socket elsewhere).
 * Messages are JSON, one per line.
 *
 * The first message on a connection must be `hello` with the token from
 * service.json; the service closes the connection otherwise.
 *
 * `hello`, `welcome` and `shutdown` must never change shape: they let any
 * version of the app replace any version of the service.
 */
export const PROTOCOL_VERSION = 1;

export type ClientMessage =
  | { kind: 'hello'; token: string; protocolVersion: number }
  | { kind: 'request'; id: number; command: string; request: unknown }
  /** Only the app sends this, to replace a stale service. Windows can't. */
  | { kind: 'shutdown' };

export type ServiceMessage =
  | { kind: 'welcome'; buildId: string; pid: number; protocolVersion: number }
  | { kind: 'response'; id: number; ok: true; response: unknown }
  | { kind: 'response'; id: number; ok: false; error: WireError }
  | { kind: 'event'; event: string; payload: unknown };

export interface WireError {
  code: 'unknown-command' | 'handler-failed';
  message: string;
}

/** Written by the service to `<data dir>/service.json` once it is listening. */
export interface ServiceInfo {
  endpoint: string;
  token: string;
  pid: number;
  buildId: string;
  protocolVersion: number;
}

export const SERVICE_INFO_FILE = 'service.json';
