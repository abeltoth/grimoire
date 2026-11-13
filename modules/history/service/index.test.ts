import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { ServiceEvents } from '@grimoire/service/core/events';
import { type ModuleContext, Modules } from '@grimoire/service/core/module';
import { CommandRegistry } from '@grimoire/service/core/registry';
import { openDatabase } from '@grimoire/service/testing/database';
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
      { event: 'history.tagListChanged', payload: { tags: ['ui', 'bug'] } },
      { event: 'history.tags', payload: { chatId: 'b', tags: ['later'] } },
      { event: 'history.tagListChanged', payload: { tags: ['ui', 'bug', 'later'] } },
      { event: 'history.tags', payload: { chatId: 'b', tags: [] } },
    ]);

    expect(await started().call('history.pinsAndTags', {})).toEqual({
      pins: {},
      tags: { a: ['ui', 'bug'] },
      summaries: {},
    });
    // The tag list keeps every tag given, even once no chat has it.
    expect(await started().call('history.tagList', {})).toEqual(['ui', 'bug', 'later']);
  });

  it('keeps a summary for a chat, across restarts', async () => {
    const registry = started();
    await registry.call('history.setSummary', { chatId: 'a', summary: ' Fixes the meter ' });
    await registry.call('history.setSummary', { chatId: 'b', summary: 'Gone soon' });
    await registry.call('history.setSummary', { chatId: 'b', summary: '' });
    expect(sent).toEqual([
      { event: 'history.summary', payload: { chatId: 'a', summary: 'Fixes the meter' } },
      { event: 'history.summary', payload: { chatId: 'b', summary: 'Gone soon' } },
      { event: 'history.summary', payload: { chatId: 'b', summary: '' } },
    ]);
    expect((await started().call('history.pinsAndTags', {})).summaries).toEqual({
      a: 'Fixes the meter',
    });
  });

  it('keeps your tag list in your order, each tag once whatever its case', async () => {
    const registry = started();
    expect(await registry.call('history.tagList', {})).toEqual([]);
    await registry.call('history.setTagList', { tags: [' bug ', 'ui', 'UI', ''] });
    expect(sent).toEqual([{ event: 'history.tagListChanged', payload: { tags: ['bug', 'ui'] } }]);
    expect(await started().call('history.tagList', {})).toEqual(['bug', 'ui']);
  });

  it('names a tag anew on every chat and in the list, merging it where both are', async () => {
    const registry = started();
    await registry.call('history.tag', { chatId: 'a', tags: ['Bug', 'ui'] });
    await registry.call('history.tag', { chatId: 'b', tags: ['fix', 'bug'] });
    await registry.call('history.tag', { chatId: 'c', tags: ['docs'] });
    await registry.call('history.setTagList', { tags: ['bug', 'fix', 'docs'] });
    sent = [];

    await registry.call('history.renameTag', { from: 'bug', to: ' fix ' });
    expect(sent).toEqual([
      { event: 'history.tags', payload: { chatId: 'a', tags: ['fix', 'ui'] } },
      { event: 'history.tags', payload: { chatId: 'b', tags: ['fix'] } },
      { event: 'history.tagListChanged', payload: { tags: ['fix', 'docs'] } },
    ]);
    expect((await registry.call('history.pinsAndTags', {})).tags).toEqual({
      a: ['fix', 'ui'],
      b: ['fix'],
      c: ['docs'],
    });

    // A tag nobody has changes nothing; a blank name is refused.
    sent = [];
    await registry.call('history.renameTag', { from: 'gone', to: 'other' });
    expect(sent).toEqual([]);
    await expect(registry.call('history.renameTag', { from: 'docs', to: ' ' })).rejects.toThrow(
      'A tag needs a name',
    );
  });
});
