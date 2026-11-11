import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolFailed } from '@grimoire/service/claude/connectors';
import { setActiveProfile } from '@grimoire/service/core/app-state';
import { TRANSITIONS, fakeConnectors, issue, openBoard, text } from './jira-testing';
import { JiraMoves } from './jira-moves';
import { JIRA_ALLOWED, JIRA_READ_ONLY } from './jira-tools';
import { JiraSyncer } from './jira-sync';
import { CardStore } from './store';

describe('moving Jira cards in Jira', () => {
  let now: number;
  let db: ReturnType<typeof openBoard>;
  let cards: CardStore;
  let emit: ReturnType<typeof vi.fn<(event: string, payload: unknown) => void>>;
  /** The issue's status in Jira now; a transition changes it. */
  let status: { name: string; statusCategory: { key: string } };
  /** The transitions Jira allows the issue. */
  let transitions: (typeof TRANSITIONS)['transitions'];
  /** What Jira says as it refuses a transition, while it does. */
  let refuse: string | undefined;
  let fake: ReturnType<typeof fakeConnectors>;
  let opened: number;
  let moves: JiraMoves;

  beforeEach(async () => {
    now = 1_000;
    db = openBoard(':memory:');
    cards = new CardStore(db, undefined, () => now);
    emit = vi.fn<(event: string, payload: unknown) => void>();
    status = { name: 'To Do', statusCategory: { key: 'new' } };
    transitions = TRANSITIONS.transitions;
    refuse = undefined;
    fake = fakeConnectors({}, [{ issues: [issue('GRIM-1', 'Context meter', 'new')] }], {
      getTransitionsForJiraIssue: () => text({ ...TRANSITIONS, transitions }),
      transitionJiraIssue: ({ transition }) => {
        if (refuse) throw new ToolFailed('mcp__claude_ai_Atlassian__transitionJiraIssue', refuse);
        status = TRANSITIONS.transitions.find(
          (t) => t.id === (transition as { id: string }).id,
        )!.to;
        return text({});
      },
      getJiraIssue: () => text(issue('GRIM-1', 'Context meter, as Jira has it', '', { status })),
    });
    await new JiraSyncer(
      cards,
      () => 'jql',
      fake.open,
      () => {},
      undefined,
      () => now,
    ).sync();
    fake.calls.length = 0;
    opened = 0;
    const open = (allowed: ReadonlySet<string>) => {
      opened++;
      return fake.open(allowed);
    };
    moves = new JiraMoves(cards, open, emit, undefined, () => now);
  });

  const meter = () => cards.list().find((card) => card.jira?.key === 'GRIM-1')!;

  it('lists the transitions into a column, one, several or none, or all of them', async () => {
    expect(await moves.transitions('jira:personal:GRIM-1', 'done')).toEqual([
      { id: '31', name: 'Finish', status: 'Done', column: 'done' },
    ]);
    expect((await moves.transitions('jira:personal:GRIM-1', 'doing')).map((t) => t.status)).toEqual(
      ['In Progress', 'In Review'],
    );
    fake.calls.length = 0;
    transitions = TRANSITIONS.transitions.filter((t) => t.to.statusCategory.key !== 'new');
    expect(await moves.transitions('jira:personal:GRIM-1', 'todo')).toEqual([]);
    expect(fake.calls).toEqual([
      { tool: 'getTransitionsForJiraIssue', args: { cloudId: 'cloud-1', issueIdOrKey: 'GRIM-1' } },
    ]);
    // Change status lists them all, those into its own column too.
    transitions = TRANSITIONS.transitions;
    expect((await moves.transitions('jira:personal:GRIM-1')).map((t) => t.status)).toEqual([
      'In Progress',
      'In Review',
      'Done',
      'Backlog',
    ]);
    await expect(moves.transitions('mine')).rejects.toThrow('There is no such Jira card');
  });

  it('makes one, reads the issue again for its card, and tells every window, on the process kept', async () => {
    const [finish] = await moves.transitions('jira:personal:GRIM-1', 'done');
    now = 2_000;
    const after = await moves.transition('jira:personal:GRIM-1', finish!);
    expect(fake.calls.map((c) => c.tool)).toEqual([
      'getAccessibleAtlassianResources',
      'getTransitionsForJiraIssue',
      'transitionJiraIssue',
      'getJiraIssue',
    ]);
    expect(fake.calls[2]!.args).toEqual({
      cloudId: 'cloud-1',
      issueIdOrKey: 'GRIM-1',
      transition: { id: '31' },
    });
    expect(fake.calls[3]!.args).toEqual({
      cloudId: 'cloud-1',
      issueIdOrKey: 'GRIM-1',
      fields: ['summary', 'description', 'status', 'issuetype', 'priority'],
    });
    expect(after.find((card) => card.id === 'jira:personal:GRIM-1')).toMatchObject({
      title: 'Context meter, as Jira has it',
      column: 'done',
      createdAt: 1_000,
      jira: { key: 'GRIM-1', status: 'Done' },
    });
    expect(emit).toHaveBeenCalledWith('kanban.changed', { cards: after });
    // One process for both steps, the one allowed the tool that writes, which the sync's isn't.
    expect(opened).toBe(1);
    expect(fake.allowed).toEqual([JIRA_READ_ONLY, JIRA_ALLOWED]);
    expect([...JIRA_ALLOWED].filter((tool) => !JIRA_READ_ONLY.has(tool))).toEqual([
      'transitionJiraIssue',
    ]);
    expect(fake.close).toHaveBeenCalledTimes(1);
    moves.close();
    await vi.waitFor(() => expect(fake.close).toHaveBeenCalledTimes(2));
  });

  it('gives the card the status the transition leads to when the issue can’t be read again', async () => {
    const unread = fakeConnectors({}, [], {
      transitionJiraIssue: () => text({}),
      getJiraIssue: () => text('Not found'),
    });
    moves = new JiraMoves(cards, unread.open, emit);
    const review = { id: '21', name: 'Review', status: 'In Review', column: 'doing' } as const;
    const after = await moves.transition('jira:personal:GRIM-1', review);
    expect(after.find((card) => card.id === 'jira:personal:GRIM-1')).toMatchObject({
      title: 'Context meter',
      column: 'doing',
      jira: { status: 'In Review' },
    });
  });

  it('leaves the card as it was when Jira refuses, saying what Jira said, and keeps the process', async () => {
    refuse = '{"errorMessages":[],"errors":{"resolution":"Resolution is required."}}';
    const [finish] = await moves.transitions('jira:personal:GRIM-1', 'done');
    await expect(moves.transition('jira:personal:GRIM-1', finish!)).rejects.toThrow(
      'Jira didn’t move GRIM-1 to Done: Resolution is required.',
    );
    expect(meter()).toMatchObject({ column: 'todo', jira: { status: 'Status' } });
    expect(emit).not.toHaveBeenCalled();
    refuse = undefined;
    await moves.transition('jira:personal:GRIM-1', finish!);
    expect(opened).toBe(1);
    expect(meter().column).toBe('done');
  });

  it('says why it can’t reach Jira, and tries again on the next move', async () => {
    const none = fakeConnectors(null);
    moves = new JiraMoves(cards, none.open, emit);
    await expect(moves.transitions('jira:personal:GRIM-1', 'done')).rejects.toThrow(
      'There’s no Atlassian connector here',
    );
    expect(none.close).toHaveBeenCalledTimes(1);
    const auth = fakeConnectors({ status: 'needs-auth' });
    moves = new JiraMoves(cards, auth.open, emit);
    await expect(moves.transitions('jira:personal:GRIM-1')).rejects.toThrow(
      'The Atlassian connector needs connecting again on claude.ai',
    );
    await expect(moves.transitions('jira:personal:GRIM-1')).rejects.toThrow(
      'needs connecting again',
    );
    expect(auth.allowed).toHaveLength(2);
  });

  it('keeps a sync begun before the issue was read again from putting back what it found', async () => {
    let answer: (() => void) | undefined;
    const slow = fakeConnectors({}, [], {
      searchJiraIssuesUsingJql: async () => {
        await new Promise<void>((resolve) => (answer = resolve));
        return text({
          issues: [issue('GRIM-2', 'Ribbons', 'new'), issue('GRIM-1', 'Context meter', 'new')],
        });
      },
    });
    now = 2_000;
    const syncing = new JiraSyncer(
      cards,
      () => 'jql',
      slow.open,
      emit,
      undefined,
      () => now,
    ).sync();
    await vi.waitFor(() => expect(answer).toBeDefined());
    now = 3_000;
    const [finish] = await moves.transitions('jira:personal:GRIM-1', 'done');
    await moves.transition('jira:personal:GRIM-1', finish!);
    answer!();
    await syncing;
    // The sync found it as it was, to do: it stays where it went, in its place in Jira's order.
    expect(
      cards.list().map((card) => `${card.column} ${card.jira!.key} ${card.jira!.status}`),
    ).toEqual(['todo GRIM-2 Status', 'done GRIM-1 Done']);
  });

  it('starts a process of its own for another profile', async () => {
    await moves.transitions('jira:personal:GRIM-1');
    setActiveProfile(db, 'work');
    await expect(moves.transitions('jira:personal:GRIM-1')).rejects.toThrow(
      'There is no such Jira card',
    );
    const work = fakeConnectors({}, [{ issues: [issue('W-1', 'Work', 'new')] }]);
    await new JiraSyncer(cards, () => 'jql', work.open, emit).sync();
    await moves.transitions('jira:work:W-1');
    expect(opened).toBe(2);
    // The sync's process, and the personal profile's.
    await vi.waitFor(() => expect(fake.close).toHaveBeenCalledTimes(2));
  });
});
