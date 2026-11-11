import type { Card } from '@grimoire/contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveProfile } from '@grimoire/service/core/app-state';
import { SITE, fakeConnectors, issue, openBoard } from './jira-testing';
import { JiraSyncer } from './jira-sync';
import { CardStore } from './store';

describe('Jira cards on the board', () => {
  let now: number;
  let db: ReturnType<typeof openBoard>;
  let cards: CardStore;
  let pages: unknown[];
  let emit: ReturnType<typeof vi.fn<(event: string, payload: unknown) => void>>;
  let syncer: JiraSyncer;

  beforeEach(() => {
    now = 1_000;
    db = openBoard(':memory:');
    cards = new CardStore(db, undefined, () => now);
    pages = [];
    emit = vi.fn<(event: string, payload: unknown) => void>();
    const open = (allowed: ReadonlySet<string>) => fakeConnectors({}, pages).open(allowed);
    syncer = new JiraSyncer(
      cards,
      () => 'assignee = currentUser()',
      open,
      emit,
      undefined,
      () => now,
    );
  });

  const titles = (all: Card[] = cards.list()) =>
    all.filter((card) => !card.closedAt).map((card) => `${card.column} ${card.title}`);

  it('puts the issues found in their columns, after your own cards, each with what Jira says of it', async () => {
    cards.save({ title: 'Mine', notes: '', cwd: '/git' });
    pages.push({
      issues: [
        issue('GRIM-2', 'Night theme', 'done', {
          status: { name: 'Closed', statusCategory: { key: 'done' } },
        }),
        issue('GRIM-1', 'Context meter', 'new', { description: 'Fill it in.' }),
      ],
    });
    expect(await syncer.sync()).toEqual({ status: 'synced', syncedAt: 1_000, syncing: false });
    expect(titles()).toEqual(['todo Mine', 'todo Context meter', 'done Night theme']);
    expect(cards.list()[1]).toEqual({
      id: 'jira:personal:GRIM-1',
      kind: 'jira',
      title: 'Context meter',
      notes: 'Fill it in.',
      cwd: '',
      column: 'todo',
      createdAt: 1_000,
      chats: [],
      jira: {
        key: 'GRIM-1',
        url: `${SITE}/browse/GRIM-1`,
        type: 'Story',
        priority: 'Medium',
        status: 'Status',
      },
    });
    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      'kanban.jira',
      'kanban.changed',
      'kanban.jira',
    ]);
    expect(emit.mock.calls[0]![1]).toEqual({ jira: { status: 'none', syncing: true } });
  });

  it('replaces them each sync, keeping a closed one closed and the chats each began, and Jira’s columns', async () => {
    pages.push({
      issues: [issue('GRIM-1', 'Context meter', 'new'), issue('GRIM-2', 'Night theme', 'new')],
    });
    await syncer.sync();
    const [meter, night] = cards.list();
    cards.close(night!.id, true);
    // A chat begun from a Jira card leaves it where Jira has it.
    cards.link(meter!.id, { chatId: 'chat-1', agent: 'claude-code', cwd: '/git' });
    expect(titles()).toEqual(['todo Context meter']);
    expect(() => cards.move(meter!.id, 'done')).toThrow('A Jira card changes in Jira');
    expect(() => cards.save({ id: meter!.id, title: 'Mine now', notes: '', cwd: '/git' })).toThrow(
      'A Jira card changes in Jira',
    );

    now = 2_000;
    pages.push({
      issues: [
        issue('GRIM-2', 'Night theme', 'indeterminate'),
        issue('GRIM-1', 'Context meter, again', 'indeterminate'),
        issue('GRIM-3', 'Ribbons', 'new'),
      ],
    });
    await syncer.sync();
    expect(titles()).toEqual(['todo Ribbons', 'doing Context meter, again']);
    const again = cards.list().find((card) => card.jira?.key === 'GRIM-1')!;
    expect(again).toMatchObject({ createdAt: 1_000, chats: [{ chatId: 'chat-1', at: 1_000 }] });
    expect(cards.list().find((card) => card.jira?.key === 'GRIM-2')).toMatchObject({
      closedAt: 1_000,
    });

    // One the query no longer finds goes; one closed opens again where Jira has it.
    pages.push({ issues: [issue('GRIM-2', 'Night theme', 'indeterminate')] });
    await syncer.sync();
    cards.close('jira:personal:GRIM-2', false);
    expect(titles()).toEqual(['doing Night theme']);
    expect(syncer.state()).toEqual({ status: 'synced', syncedAt: 2_000, syncing: false });
  });

  it('shows nothing where there’s no Atlassian connector, and keeps the last issues when a sync fails', async () => {
    const none = new JiraSyncer(cards, () => 'jql', fakeConnectors(null).open, emit);
    expect(await none.sync()).toEqual({ status: 'none', syncing: false });
    expect(cards.list()).toEqual([]);

    pages.push({ issues: [issue('GRIM-1', 'Context meter', 'new')] }, 'not json');
    await syncer.sync();
    now = 5_000;
    expect(await syncer.sync()).toEqual({
      status: 'failed',
      error: 'searchJiraIssuesUsingJql answered with no list of issues (it has string)',
      syncedAt: 1_000,
      syncing: false,
    });
    expect(titles()).toEqual(['todo Context meter']);
  });

  it('runs one sync at a time, skips one asked for soon after the last, and keeps each profile’s apart', async () => {
    pages.push({ issues: [issue('GRIM-1', 'Context meter', 'new')] });
    const [first, second] = await Promise.all([syncer.sync(), syncer.sync()]);
    expect(first).toEqual(second);
    now = 30_000;
    await syncer.sync({ ifOlderThan: 60_000 });
    expect(titles()).toEqual(['todo Context meter']);

    setActiveProfile(db, 'work');
    expect(cards.list()).toEqual([]);
    expect(syncer.state()).toEqual({ status: 'none', syncing: false });
    pages.push({ issues: [issue('GRIM-1', 'Context meter at work', 'new')] });
    await syncer.sync({ ifOlderThan: 60_000 });
    expect(cards.list().map((card) => card.id)).toEqual(['jira:work:GRIM-1']);
    setActiveProfile(db, 'personal');
    expect(titles()).toEqual(['todo Context meter']);
  });
});
