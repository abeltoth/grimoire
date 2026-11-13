import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatId, Entry } from '@grimoire/contract';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { LabelStore } from './label-store';
import { type LabelSettings, type LabelSources, Labeller, due } from './labeller';
import { MIGRATIONS } from './migrations';

const you = (n: number): Entry[] =>
  Array.from({ length: n }, (_, i) => ({ kind: 'user', id: `u${i}`, text: `Message ${i}` }));

/** A chat, the agent and the History as labelling sees them, with what was asked and done. */
function world() {
  const state = {
    entries: you(1),
    answer: '{"title": "Context meter", "summary": "Adds a meter.", "tags": ["ui", "bug"]}',
    tags: new Map<ChatId, readonly string[]>(),
    list: ['bug', 'ui'] as readonly string[],
    asked: [] as { instructions: string; text: string }[],
    done: [] as unknown[][],
    log: [] as string[],
    settings: { autoTitles: true, autoTags: true, autoSummaries: true } as LabelSettings,
  };
  const sources: LabelSources = {
    transcript: async () => state.entries,
    ask: async (_agent, instructions, text) => {
      state.asked.push({ instructions, text });
      return state.answer;
    },
    rename: async (chatId, title) => void state.done.push(['rename', chatId, title]),
    tagsOf: async (chatId) => state.tags.get(chatId) ?? [],
    setTags: async (chatId, tags) => {
      state.tags.set(chatId, tags);
      state.done.push(['tags', chatId, tags]);
    },
    setSummary: async (chatId, summary) => void state.done.push(['summary', chatId, summary]),
    tagList: async () => state.list,
  };
  const db = openDatabase(':memory:');
  migrate(db, 'auto-labels', MIGRATIONS);
  const store = new LabelStore(db);
  const labeller = new Labeller(
    sources,
    store,
    () => state.settings,
    (m) => state.log.push(m),
  );
  return { state, store, labeller };
}

const chat = (title = 'Add a meter') => ({ id: 'c1', agent: 'claude-code', cwd: '/work', title });

/** Lets the queued chats be labelled. */
const settle = (labeller: Labeller) => labeller.settled();

let w: ReturnType<typeof world>;
beforeEach(() => {
  w = world();
});

describe('due', () => {
  it('labels a chat after your first message, then every fifth', () => {
    expect([0, 1, 2, 4, 5, 6, 10].map(due)).toEqual([false, true, false, false, true, false, true]);
  });
});

describe('Labeller', () => {
  it('names, tags and sums up a chat after its first turn, from your tag list', async () => {
    w.labeller.turnEnded(chat());
    await settle(w.labeller);
    expect(w.state.asked).toHaveLength(1);
    expect(w.state.asked[0]!.instructions).toContain('The list: bug, ui.');
    expect(w.state.asked[0]!.text).toContain('You: Message 0');
    expect(w.state.done).toEqual([
      ['rename', 'c1', 'Context meter'],
      ['summary', 'c1', 'Adds a meter.'],
      ['tags', 'c1', ['ui', 'bug']],
    ]);
    expect(w.store.labelled('c1')).toEqual({ turns: 1, title: 'Context meter' });

    // The same turn count again asks nothing; nor does a turn that isn't due.
    w.labeller.turnEnded(chat('Context meter'));
    w.state.entries = you(2);
    w.labeller.turnEnded(chat('Context meter'));
    await settle(w.labeller);
    expect(w.state.asked).toHaveLength(1);
  });

  it('keeps a title given after its own, and never adds back a tag you took off', async () => {
    w.labeller.turnEnded(chat());
    await settle(w.labeller);
    w.labeller.tagsNow('c1', ['ui']);
    w.state.tags.set('c1', ['ui']);
    w.state.done = [];

    w.state.entries = you(5);
    w.state.answer = '{"title": "Meter", "summary": "Now in the footer.", "tags": ["bug", "ui"]}';
    w.labeller.turnEnded(chat('My own name'));
    await settle(w.labeller);
    expect(w.state.asked[1]!.instructions).not.toContain('"title"');
    expect(w.state.done).toEqual([['summary', 'c1', 'Now in the footer.']]);
    expect(w.store.labelled('c1')).toEqual({ turns: 5, title: 'Context meter' });
  });

  it('asks only for what Settings turns on, and nothing while it’s all off', async () => {
    w.state.settings = { autoTitles: false, autoTags: true, autoSummaries: false };
    w.state.list = [];
    w.labeller.turnEnded(chat());
    await settle(w.labeller);
    // No tag list leaves nothing to ask for.
    expect(w.state.asked).toEqual([]);
    expect(w.store.labelled('c1')).toEqual({ turns: 1 });

    w.state.settings = { autoTitles: false, autoTags: false, autoSummaries: false };
    w.labeller.turnEnded({ ...chat(), id: 'c2' });
    await settle(w.labeller);
    expect(w.store.labelled('c2')).toBeUndefined();
  });

  it('labels a past chat whatever its count of messages, but only once', async () => {
    w.state.entries = you(3);
    await w.labeller.labelPast(chat());
    await w.labeller.labelPast(chat());
    expect(w.state.asked).toHaveLength(1);
    expect(w.store.labelled('c1')).toEqual({ turns: 3, title: 'Context meter' });
  });

  it('logs a chat it couldn’t label, and goes on to the next', async () => {
    w.state.answer = 'not json';
    w.labeller.turnEnded(chat());
    await settle(w.labeller);
    expect(w.state.done).toEqual([]);
    expect(w.store.labelled('c1')).toEqual({ turns: 1 });

    const broken = world();
    broken.state.answer = '';
    const labeller = new Labeller(
      {
        ...({} as LabelSources),
        transcript: () => Promise.reject(new Error('gone')),
      },
      broken.store,
      () => broken.state.settings,
      (m) => broken.state.log.push(m),
    );
    labeller.turnEnded(chat());
    labeller.turnEnded({ ...chat(), id: 'c2' });
    await settle(labeller);
    expect(broken.state.log).toEqual([
      "Couldn't label a chat: gone",
      "Couldn't label a chat: gone",
    ]);
  });

  it('labels nothing more once stopped', async () => {
    w.labeller.stop();
    w.labeller.turnEnded(chat());
    await settle(w.labeller);
    expect(w.state.asked).toEqual([]);
  });
});
