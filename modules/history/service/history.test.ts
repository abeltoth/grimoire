import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { ServiceEvents } from '@grimoire/service/events';
import { type ModuleContext, Modules } from '@grimoire/service/module';
import { CommandRegistry } from '@grimoire/service/registry';
import { openDatabase } from '@grimoire/service/storage/database';
import { history } from '.';

let db: DatabaseSync;
let sent: { event: string; payload: unknown }[];

/** The module started on the database, as the service starts it after each restart. */
function started(): CommandRegistry {
  const registry = new CommandRegistry();
  const events = new ServiceEvents();
  events.toWindows((event, payload) => sent.push({ event, payload }));
  new Modules([history]).start({ registry, db, events } as unknown as ModuleContext);
  return registry;
}

beforeEach(() => {
  db = openDatabase(':memory:');
  sent = [];
});

describe('history', () => {
  it('pins and stars chats, kept across restarts', async () => {
    const registry = started();
    await registry.call('history.pin', { chatId: 'a', mark: 'star', on: true });
    await registry.call('history.pin', { chatId: 'a', mark: 'pin', on: true });
    await registry.call('history.pin', { chatId: 'a', mark: 'pin', on: true });
    await registry.call('history.pin', { chatId: 'a', mark: 'star', on: false });
    await registry.call('history.pin', { chatId: 'b', mark: 'pin', on: false });
    expect(sent.map((s) => s.payload)).toEqual([
      { chatId: 'a', pins: ['star'] },
      { chatId: 'a', pins: ['pin', 'star'] },
      { chatId: 'a', pins: ['pin', 'star'] },
      { chatId: 'a', pins: ['pin'] },
      { chatId: 'b', pins: [] },
    ]);
    expect(sent.map((s) => s.event)).toEqual(Array(5).fill('history.pins'));

    expect((await started().call('history.pinsAndTags', {})).pins).toEqual({ a: ['pin'] });
  });

  it('keeps your tags for a chat, each once whatever its case, across restarts', async () => {
    const registry = started();
    await registry.call('history.tag', { chatId: 'a', tags: [' ui ', 'bug', '', 'UI'] });
    await registry.call('history.tag', { chatId: 'b', tags: ['later'] });
    await registry.call('history.tag', { chatId: 'b', tags: [] });
    expect(sent).toEqual([
      { event: 'history.tags', payload: { chatId: 'a', tags: ['ui', 'bug'] } },
      { event: 'history.tags', payload: { chatId: 'b', tags: ['later'] } },
      { event: 'history.tags', payload: { chatId: 'b', tags: [] } },
    ]);

    expect(await started().call('history.pinsAndTags', {})).toEqual({
      pins: {},
      tags: { a: ['ui', 'bug'] },
    });
  });
});
