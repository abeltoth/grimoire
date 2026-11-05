import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ClientMessage, type ServiceMessage } from '@grimoire/contract';
import { LineDecoder, encodeMessage } from '@grimoire/contract/wire';
import { ServiceClient, ServiceError } from './service-client';

const servers: net.Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

function endpoint(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'grimoire-client-'));
  dirs.push(dir);
  return process.platform === 'win32' ? `\\\\.\\pipe\\${path.basename(dir)}` : path.join(dir, 's.sock');
}

/** A stand-in service that answers each message with `reply`. */
async function fakeService(reply: (message: ClientMessage, send: (m: ServiceMessage) => void, socket: net.Socket) => void) {
  const at = endpoint();
  const server = net.createServer((socket) => {
    const decoder = new LineDecoder();
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      for (const message of decoder.push(chunk) as ClientMessage[]) {
        reply(message, (m) => socket.write(encodeMessage(m)), socket);
      }
    });
    socket.on('error', () => {});
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(at, resolve));
  return at;
}

const welcome: ServiceMessage = { kind: 'welcome', buildId: 'b1', pid: 42, protocolVersion: PROTOCOL_VERSION };

describe('ServiceClient', () => {
  it('sends the token, then resolves requests by id', async () => {
    let token = '';
    const at = await fakeService((message, send) => {
      if (message.kind === 'hello') {
        token = message.token;
        send(welcome);
      } else if (message.kind === 'request') {
        send({ kind: 'response', id: message.id, ok: true, response: { echo: message.command } });
      }
    });
    const client = await ServiceClient.connect({ endpoint: at, token: 't0k3n' });
    expect(token).toBe('t0k3n');
    expect(client.welcome.pid).toBe(42);
    await expect(client.request('core.ping', {})).resolves.toEqual({ echo: 'core.ping' });
    client.close();
  });

  it('rejects with a ServiceError when the service reports one', async () => {
    const at = await fakeService((message, send) => {
      if (message.kind === 'hello') send(welcome);
      if (message.kind === 'request') {
        send({ kind: 'response', id: message.id, ok: false, error: { code: 'unknown-command', message: 'nope' } });
      }
    });
    const client = await ServiceClient.connect({ endpoint: at, token: 't' });
    await expect(client.request('nope', {})).rejects.toBeInstanceOf(ServiceError);
    client.close();
  });

  it('fails to connect when the service closes without a welcome', async () => {
    const at = await fakeService((_message, _send, socket) => socket.destroy());
    await expect(ServiceClient.connect({ endpoint: at, token: 'bad' })).rejects.toThrow();
  });

  it('rejects pending requests when the connection drops', async () => {
    const at = await fakeService((message, send, socket) => {
      if (message.kind === 'hello') send(welcome);
      if (message.kind === 'request') socket.destroy();
    });
    const client = await ServiceClient.connect({ endpoint: at, token: 't' });
    await expect(client.request('core.ping', {})).rejects.toThrow('closed');
    expect(client.isClosed).toBe(true);
  });

  it('emits events pushed by the service', async () => {
    const at = await fakeService((message, send) => {
      if (message.kind === 'hello') {
        send(welcome);
        send({ kind: 'event', event: 'test.happened', payload: { n: 1 } });
      }
    });
    const client = await ServiceClient.connect({ endpoint: at, token: 't' });
    const [name, payload] = await new Promise<[string, unknown]>((resolve) =>
      client.once('event', (...args) => resolve(args)),
    );
    expect(name).toBe('test.happened');
    expect(payload).toEqual({ n: 1 });
    client.close();
  });
});
