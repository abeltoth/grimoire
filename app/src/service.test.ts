import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Service } from './service';
import type { ServiceClient } from './service-client';
import type { LaunchOptions } from './service-launcher';

const windows = vi.hoisted(() => [] as { webContents: { send: (...args: unknown[]) => void } }[]);
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => windows } }));

/** A connection that answers profiles.list with the profile in use, and closes when shut down. */
class FakeClient extends EventEmitter {
  shutdowns = 0;
  constructor(private readonly active: string) {
    super();
  }
  request = (command: string) =>
    Promise.resolve(command === 'profiles.list' ? { active: this.active, profiles: [] } : {});
  shutdown() {
    this.shutdowns++;
    this.emit('close');
  }
}

const options = {} as LaunchOptions;
const settle = () => new Promise((resolve) => setImmediate(resolve));

let sent: unknown[][];
let clients: FakeClient[];
let changes: number;
let failNext: boolean;
let service: Service;
beforeEach(() => {
  sent = [];
  windows.length = 0;
  windows.push({ webContents: { send: (...args) => sent.push(args) } });
  windows.push({ webContents: { send: (...args) => sent.push(args) } });
  clients = [];
  changes = 0;
  failNext = false;
  service = new Service(
    options,
    () => changes++,
    async () => {
      if (failNext) {
        failNext = false;
        throw new Error('no service');
      }
      const client = new FakeClient('home');
      clients.push(client);
      return client as unknown as ServiceClient;
    },
  );
});

describe('Service', () => {
  it('reaches the service once, and again after it closes', async () => {
    await Promise.all([service.get(), service.get()]);
    expect(clients).toHaveLength(1);
    clients[0]!.emit('close');
    await service.get();
    expect(clients).toHaveLength(2);
  });

  it('tries again after the service could not be reached', async () => {
    failNext = true;
    await expect(service.get()).rejects.toThrow('no service');
    await service.get();
    expect(clients).toHaveLength(1);
  });

  it("relays the service's events to every window", async () => {
    await service.get();
    clients[0]!.emit('event', 'chats.changed', { chats: [] });
    expect(sent).toEqual([
      ['grimoire:event', 'chats.changed', { chats: [] }],
      ['grimoire:event', 'chats.changed', { chats: [] }],
    ]);
  });

  it('opens the windows again only when another profile is put in use', async () => {
    await service.get();
    await settle();
    const changed = (active: string) =>
      clients[0]!.emit('event', 'profiles.changed', { profiles: { active, profiles: [] } });
    changed('home');
    expect(changes).toBe(0);
    changed('work');
    expect(changes).toBe(1);
  });

  it('stops the service and waits for it to close', async () => {
    await service.stop();
    expect(clients[0]!.shutdowns).toBe(1);
  });
});
