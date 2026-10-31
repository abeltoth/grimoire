import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ServiceMessage } from '@grimoire/contract';
import { LineDecoder, encodeMessage } from '@grimoire/contract/wire';
import { endpointFor } from './endpoint';
import { CommandRegistry } from './registry';
import { AlreadyRunningError, startServer, type ServiceServer } from './server';

const TOKEN = 'secret-token';
const servers: ServiceServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function tempEndpoint(): string {
  return endpointFor(mkdtempSync(path.join(os.tmpdir(), `grimoire-test-${randomBytes(4).toString('hex')}-`)));
}

async function start(endpoint = tempEndpoint(), onShutdown = () => {}) {
  const registry = new CommandRegistry();
  registry.register('core.ping', () => ({ pid: 1, buildId: 'b1', startedAt: 0, uptimeMs: 0, node: 'x' }));
  const server = await startServer({
    endpoint,
    token: TOKEN,
    buildId: 'b1',
    registry,
    onShutdown,
    log: () => {},
    helloTimeoutMs: 200,
  });
  servers.push(server);
  return { endpoint, server };
}

/** Connects, sends `messages`, and collects replies until the socket closes or `count` arrive. */
function exchange(endpoint: string, messages: unknown[], count: number): Promise<{ replies: ServiceMessage[]; closed: boolean }> {
  return new Promise((resolve) => {
    const socket = net.createConnection(endpoint);
    const decoder = new LineDecoder();
    const replies: ServiceMessage[] = [];
    socket.setEncoding('utf8');
    socket.on('connect', () => messages.forEach((m) => socket.write(encodeMessage(m))));
    socket.on('data', (chunk: string) => {
      replies.push(...(decoder.push(chunk) as ServiceMessage[]));
      if (replies.length >= count) {
        socket.destroy();
        resolve({ replies, closed: false });
      }
    });
    socket.on('close', () => resolve({ replies, closed: true }));
    socket.on('error', () => {});
  });
}

const hello = { kind: 'hello', token: TOKEN, protocolVersion: PROTOCOL_VERSION };

describe('service server', () => {
  it('welcomes a client with the right token and answers ping', async () => {
    const { endpoint } = await start();
    const { replies } = await exchange(endpoint, [hello, { kind: 'request', id: 7, command: 'core.ping', request: {} }], 2);
    expect(replies[0]).toMatchObject({ kind: 'welcome', buildId: 'b1', protocolVersion: PROTOCOL_VERSION });
    expect(replies[1]).toMatchObject({ kind: 'response', id: 7, ok: true, response: { buildId: 'b1' } });
  });

  it('closes the connection on a wrong token', async () => {
    const { endpoint } = await start();
    const { replies, closed } = await exchange(endpoint, [{ ...hello, token: 'wrong-token!' }], 1);
    expect(closed).toBe(true);
    expect(replies).toEqual([]);
  });

  it('ignores requests sent before the hello', async () => {
    const { endpoint } = await start();
    const { replies, closed } = await exchange(endpoint, [{ kind: 'request', id: 1, command: 'core.ping', request: {} }], 1);
    expect(closed).toBe(true);
    expect(replies).toEqual([]);
  });

  it('closes a connection that never says hello', async () => {
    const { endpoint } = await start();
    const { closed } = await exchange(endpoint, [], 1);
    expect(closed).toBe(true);
  });

  it('answers an unknown command with an error', async () => {
    const { endpoint } = await start();
    const { replies } = await exchange(endpoint, [hello, { kind: 'request', id: 2, command: 'nope', request: {} }], 2);
    expect(replies[1]).toMatchObject({ kind: 'response', id: 2, ok: false, error: { code: 'unknown-command' } });
  });

  it('calls onShutdown when the app asks', async () => {
    let asked = false;
    const { endpoint } = await start(undefined, () => (asked = true));
    await exchange(endpoint, [hello, { kind: 'shutdown' }, { kind: 'request', id: 3, command: 'core.ping', request: {} }], 2);
    expect(asked).toBe(true);
  });

  it('refuses to start a second service on the same endpoint', async () => {
    const { endpoint } = await start();
    await expect(start(endpoint)).rejects.toBeInstanceOf(AlreadyRunningError);
  });
});
