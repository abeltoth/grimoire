import { timingSafeEqual } from 'node:crypto';
import { rmSync } from 'node:fs';
import net from 'node:net';
import { PROTOCOL_VERSION, type ClientMessage, type ServiceMessage } from '@grimoire/contract';
import { LineDecoder, encodeMessage } from '@grimoire/contract/wire';
import { UnknownCommandError, type CommandRegistry } from './registry';

export interface ServiceServerOptions {
  endpoint: string;
  token: string;
  buildId: string;
  registry: CommandRegistry;
  /** Called when the app asks the service to stop. */
  onShutdown: () => void;
  log: (message: string) => void;
  /** How long a new connection has to send a valid hello. */
  helloTimeoutMs?: number;
}

export interface ServiceServer {
  /** Sends an event to every connected app. */
  broadcast(event: string, payload: unknown): void;
  close(): Promise<void>;
}

export class AlreadyRunningError extends Error {
  constructor(endpoint: string) {
    super(`Another service is already listening on ${endpoint}`);
  }
}

export async function startServer(options: ServiceServerOptions): Promise<ServiceServer> {
  const clients = new Set<net.Socket>();
  const server = net.createServer((socket) => handleConnection(socket, options, clients));

  await listen(server, options.endpoint);

  return {
    broadcast(event, payload) {
      const line = encodeMessage({ kind: 'event', event, payload } satisfies ServiceMessage);
      for (const socket of clients) socket.write(line);
    },
    close() {
      for (const socket of clients) socket.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

function handleConnection(
  socket: net.Socket,
  options: ServiceServerOptions,
  clients: Set<net.Socket>,
): void {
  const decoder = new LineDecoder();
  let authenticated = false;
  const send = (message: ServiceMessage) => socket.write(encodeMessage(message));

  const helloTimer = setTimeout(() => socket.destroy(), options.helloTimeoutMs ?? 5000);
  socket.setEncoding('utf8');
  socket.on('error', () => socket.destroy());
  socket.on('close', () => {
    clearTimeout(helloTimer);
    clients.delete(socket);
  });

  socket.on('data', (chunk: string) => {
    let messages: unknown[];
    try {
      messages = decoder.push(chunk);
    } catch {
      socket.destroy();
      return;
    }
    for (const message of messages as ClientMessage[]) {
      if (!authenticated) {
        if (!isValidHello(message, options.token)) {
          options.log('Rejected a connection without a valid hello');
          socket.destroy();
          return;
        }
        authenticated = true;
        clearTimeout(helloTimer);
        clients.add(socket);
        send({
          kind: 'welcome',
          buildId: options.buildId,
          pid: process.pid,
          protocolVersion: PROTOCOL_VERSION,
        });
        continue;
      }
      if (message.kind === 'request') {
        void respond(message, options, send);
      } else if (message.kind === 'shutdown') {
        options.log('Shutdown requested by the app');
        options.onShutdown();
      }
    }
  });
}

async function respond(
  message: Extract<ClientMessage, { kind: 'request' }>,
  options: ServiceServerOptions,
  send: (message: ServiceMessage) => void,
): Promise<void> {
  try {
    const response = await options.registry.dispatch(message.command, message.request);
    send({ kind: 'response', id: message.id, ok: true, response });
  } catch (error) {
    const unknown = error instanceof UnknownCommandError;
    if (!unknown) options.log(`Command ${message.command} failed: ${String(error)}`);
    send({
      kind: 'response',
      id: message.id,
      ok: false,
      error: {
        code: unknown ? 'unknown-command' : 'handler-failed',
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function isValidHello(message: unknown, token: string): boolean {
  if (typeof message !== 'object' || message === null) return false;
  // The protocol version isn't checked: an app of any version must be able
  // to connect and ask an old service to shut down.
  const hello = message as Partial<Extract<ClientMessage, { kind: 'hello' }>>;
  if (hello.kind !== 'hello' || typeof hello.token !== 'string') return false;
  const given = Buffer.from(hello.token);
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function listen(server: net.Server, endpoint: string): Promise<void> {
  try {
    await tryListen(server, endpoint);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    // A Unix socket file can outlive a crashed service. Named pipes can't.
    if (process.platform === 'win32' || (await isAlive(endpoint))) {
      throw new AlreadyRunningError(endpoint);
    }
    rmSync(endpoint, { force: true });
    await tryListen(server, endpoint);
  }
}

function tryListen(server: net.Server, endpoint: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function isAlive(endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createConnection(endpoint);
    probe.once('connect', () => {
      probe.destroy();
      resolve(true);
    });
    probe.once('error', () => resolve(false));
  });
}
