import { EventEmitter } from 'node:events';
import net from 'node:net';
import { PROTOCOL_VERSION, type ServiceInfo, type ServiceMessage, type WireError } from '@grimoire/contract';
import { LineDecoder, encodeMessage } from '@grimoire/contract/wire';

export class ServiceError extends Error {
  constructor(
    readonly code: WireError['code'],
    message: string,
  ) {
    super(message);
  }
}

type Welcome = Extract<ServiceMessage, { kind: 'welcome' }>;

interface ClientEvents {
  event: [name: string, payload: unknown];
  close: [];
}

/** The app's connection to the background service. */
export class ServiceClient extends EventEmitter<ClientEvents> {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private closed = false;

  private constructor(
    private readonly socket: net.Socket,
    private readonly decoder: LineDecoder,
    readonly welcome: Welcome,
  ) {
    super();
    socket.on('data', (chunk: string) => {
      try {
        this.handle(decoder.push(chunk) as ServiceMessage[]);
      } catch {
        socket.destroy();
      }
    });
    socket.on('error', () => socket.destroy());
    socket.on('close', () => this.onClose());
  }

  static connect(info: Pick<ServiceInfo, 'endpoint' | 'token'>, timeoutMs = 3000): Promise<ServiceClient> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(info.endpoint);
      const decoder = new LineDecoder();
      socket.setEncoding('utf8');

      const fail = (error: Error) => {
        clearTimeout(timer);
        socket.destroy();
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error('Timed out waiting for the service')), timeoutMs);
      const onError = (error: Error) => fail(error);
      const onClose = () => fail(new Error('The service closed the connection'));
      const onData = (chunk: string) => {
        let messages: ServiceMessage[];
        try {
          messages = decoder.push(chunk) as ServiceMessage[];
        } catch (error) {
          fail(error as Error);
          return;
        }
        const [first, ...rest] = messages;
        if (!first) return;
        if (first.kind !== 'welcome') {
          fail(new Error(`Expected a welcome from the service, got ${first.kind}`));
          return;
        }
        clearTimeout(timer);
        socket.off('error', onError).off('close', onClose).off('data', onData);
        const client = new ServiceClient(socket, decoder, first);
        client.handle(rest);
        resolve(client);
      };

      socket.on('error', onError).on('close', onClose).on('data', onData);
      socket.on('connect', () =>
        socket.write(encodeMessage({ kind: 'hello', token: info.token, protocolVersion: PROTOCOL_VERSION })),
      );
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  request(command: string, request: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('The service connection is closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(encodeMessage({ kind: 'request', id, command, request }));
    });
  }

  /** Asks the service to stop. Used to replace a service from an older build. */
  shutdown(): void {
    if (!this.closed) this.socket.write(encodeMessage({ kind: 'shutdown' }));
  }

  close(): void {
    this.socket.destroy();
  }

  private handle(messages: ServiceMessage[]): void {
    for (const message of messages) {
      if (message.kind === 'response') {
        const waiting = this.pending.get(message.id);
        if (!waiting) continue;
        this.pending.delete(message.id);
        if (message.ok) waiting.resolve(message.response);
        else waiting.reject(new ServiceError(message.error.code, message.error.message));
      } else if (message.kind === 'event') {
        this.emit('event', message.event, message.payload);
      }
    }
  }

  private onClose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiting of this.pending.values()) waiting.reject(new Error('The service connection closed'));
    this.pending.clear();
    this.emit('close');
  }
}
