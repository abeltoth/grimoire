import type { Entry } from '@grimoire/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAdapter } from '../agents/fake-adapter';
import { Indexer, passagesOf, turnsOf, usesOf } from './indexer';
import { SearchIndex } from './search-index';

const you = (id: string, text: string): Entry => ({ kind: 'user', id, text });
const reply = (id: string, ...texts: string[]): Entry => ({
  kind: 'agent',
  id,
  blocks: [
    { kind: 'thinking', text: 'secret thoughts' },
    ...texts.map((text) => ({ kind: 'text' as const, text })),
    { kind: 'tool', id: 't1', tool: 'Bash', input: { command: 'ls' } },
  ],
});
const found = (index: SearchIndex, query: string) => index.search(query).map((hit) => hit.chatId);

describe('Indexer', () => {
  let index: SearchIndex;
  let fake: FakeAdapter;
  let indexer: Indexer;
  beforeEach(() => {
    index = new SearchIndex(':memory:');
    fake = new FakeAdapter();
    indexer = new Indexer(index, [fake]);
  });
  afterEach(() => index.close());

  it('takes the title, your messages and the text of the replies, not thinking or tools', () => {
    expect(
      passagesOf('Title', [you('u1', 'Hello'), you('u2', '  '), reply('a1', 'One', 'Two')]),
    ).toEqual([
      { kind: 'title', text: 'Title' },
      { kind: 'you', text: 'Hello' },
      { kind: 'agent', text: 'One\n\nTwo' },
    ]);
  });

  it('takes what each turn spent from your message that began it', () => {
    const use = {
      model: 'm',
      input: 1,
      cacheWritten: 2,
      cacheWrittenLong: 3,
      cacheRead: 4,
      output: 5,
    };
    expect(
      turnsOf([
        {
          kind: 'user',
          id: 'u1',
          text: 'Hello',
          tokens: { at: 7, uses: [use, { ...use, subagent: true }] },
        },
        reply('a1', 'Hi'),
        you('u2', 'No reply yet'),
      ]),
    ).toEqual([
      { at: 7, ...use },
      { at: 7, ...use, subagent: true },
    ]);
  });

  it("takes the tools the agent called, the skills it ran, and the /names you wrote, each at its message's time", () => {
    expect(
      usesOf([
        { kind: 'user', id: 'u1', text: '/review the diff', at: 10 },
        {
          kind: 'agent',
          id: 'a1',
          at: 11,
          blocks: [
            { kind: 'text', text: 'Looking' },
            { kind: 'tool', id: 't1', tool: 'Skill', input: { skill: 'code-review' }, skill: 'code-review' },
            { kind: 'tool', id: 't2', tool: 'Read', input: {} },
          ],
        },
        // Without a time of its own, an entry takes its turn's.
        { kind: 'user', id: 'u2', text: 'Again, /not a command', tokens: { at: 20, uses: [] } },
        { kind: 'agent', id: 'a2', blocks: [{ kind: 'tool', id: 't3', tool: 'Bash', input: {} }] },
        // Without either, it's left out.
        you('u3', '/model'),
        reply('a3', 'Hi'),
      ]),
    ).toEqual([
      { at: 10, kind: 'skill', name: 'review' },
      { at: 11, kind: 'tool', name: 'Skill' },
      { at: 11, kind: 'skill', name: 'code-review' },
      { at: 11, kind: 'tool', name: 'Read' },
      { at: 20, kind: 'tool', name: 'Bash' },
    ]);
  });

  it('indexes new chats, reads again only those written in since, and forgets those gone', async () => {
    fake.chats = [
      { id: 'c1', agent: 'fake', title: 'Context meter', cwd: '/work', updatedAt: 1 },
      { id: 'c2', agent: 'fake', title: 'Login test', cwd: '/work', updatedAt: 1 },
    ];
    fake.transcripts.set('c1', [you('u1', 'Draw a meter'), reply('a1', 'Drawn in ticks')]);
    fake.transcripts.set('c2', [you('u1', 'Fix the flaky test')]);
    await indexer.sync();
    expect(fake.transcriptLoads).toBe(2);
    expect(found(index, 'ticks')).toEqual(['c1']);
    expect(found(index, 'secret')).toEqual([]);
    expect(found(index, 'Bash')).toEqual([]);

    fake.chats = [{ ...fake.chats[0]!, updatedAt: 2 }];
    fake.transcripts.set('c1', [you('u1', 'Draw a meter'), reply('a1', 'Redrawn as a dial')]);
    await indexer.sync();
    expect(fake.transcriptLoads).toBe(3);
    expect(found(index, 'dial')).toEqual(['c1']);
    expect(found(index, 'ticks')).toEqual([]);
    expect(found(index, 'flaky')).toEqual([]);
  });

  it('keeps what it indexed of a chat it can’t read, and tries it again next time', async () => {
    fake.chats = [{ id: 'c1', agent: 'fake', title: 'Kept', updatedAt: 1 }];
    await indexer.sync();
    fake.chats = [{ id: 'c1', agent: 'fake', title: 'Kept', updatedAt: 2 }];
    const history = vi.spyOn(fake, 'history').mockRejectedValueOnce(new Error('unreadable'));
    await indexer.sync();
    expect(found(index, 'kept')).toEqual(['c1']);
    await indexer.sync();
    expect(history).toHaveBeenCalledTimes(2);
  });

  it('reads the chats again when told they changed, or once they may have', async () => {
    const sync = vi.spyOn(indexer, 'sync');
    await indexer.syncIfStale(1000, 0);
    expect(sync).toHaveBeenCalledTimes(1);
    await indexer.syncIfStale(60_000);
    expect(sync).toHaveBeenCalledTimes(1);
    indexer.markStale();
    await indexer.syncIfStale(60_000);
    expect(sync).toHaveBeenCalledTimes(2);
    await indexer.syncIfStale(0);
    expect(sync).toHaveBeenCalledTimes(3);
  });
});
