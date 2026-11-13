import { describe, expect, it } from 'vitest';
import type { ChatSummary, Entry, LabelProgress } from '@grimoire/contract';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { LabelStore } from './label-store';
import { Labeller } from './labeller';
import { MIGRATIONS } from './migrations';
import { PastChats } from './past-chats';

const summary = (id: string, updatedAt: number, agent = 'claude-code'): ChatSummary => ({
  id,
  agent,
  title: `Chat ${id}`,
  cwd: '/work',
  updatedAt,
});

function past(answer = '["Bug", "ui"]') {
  const told: LabelProgress[] = [];
  const asked: { instructions: string; text: string }[] = [];
  const labelled: string[] = [];
  const db = openDatabase(':memory:');
  migrate(db, 'auto-labels', MIGRATIONS);
  const store = new LabelStore(db);
  store.label('old', 1);
  const entries: Entry[] = [{ kind: 'user', id: 'u1', text: 'Hi' }];
  const labeller = new Labeller(
    {
      transcript: async (_agent, chatId) => {
        labelled.push(chatId);
        return entries;
      },
      ask: async () => '{"summary": "Says hi."}',
      rename: async () => {},
      tagsOf: async () => [],
      setTags: async () => {},
      setSummary: async () => {},
      tagList: async () => [],
    },
    store,
    () => ({ autoTitles: false, autoTags: false, autoSummaries: true }),
    () => {},
  );
  const chats = new PastChats(
    {
      agents: () => [
        { id: 'claude-code', capabilities: ['ask'] },
        { id: 'mute', capabilities: [] },
      ],
      listChats: async (agent) =>
        agent === 'claude-code'
          ? [summary('a', 1), summary('old', 3), summary('b', 2)]
          : [summary('m', 9, 'mute')],
      ask: async (_agent, instructions, text) => {
        asked.push({ instructions, text });
        return answer;
      },
    },
    labeller,
    store,
    (progress) => told.push(progress),
  );
  return { chats, told, asked, labelled };
}

describe('PastChats', () => {
  it('labels every past chat never labelled, newest first, telling how far it’s come', async () => {
    const { chats, told, labelled } = past();
    expect(await chats.count()).toBe(2);
    await chats.start();
    expect(labelled).toEqual(['b', 'a']);
    expect(told).toEqual([
      { done: 0, total: 0, running: true },
      { done: 0, total: 2, running: true },
      { done: 1, total: 2, running: true },
      { done: 2, total: 2, running: true },
      { done: 2, total: 2, running: false },
    ]);
    expect(chats.where()).toEqual({ done: 2, total: 2, running: false });
    expect(await chats.count()).toBe(0);
  });

  it('stops after the chat under way', async () => {
    const { chats, labelled } = past();
    const run = chats.start();
    chats.stop();
    await run;
    expect(labelled).toEqual([]);
    expect(chats.where().running).toBe(false);
  });

  it('suggests tags from the titles of the chats, newest first', async () => {
    const { chats, asked } = past();
    expect(await chats.suggest()).toEqual(['bug', 'ui']);
    expect(asked[0]!.text).toBe('Chat old\nChat b\nChat a');
  });
});
