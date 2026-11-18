import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolFailed } from '@grimoire/service/claude/connectors';
import { fakeConnectors, issue, openBoard, text } from './jira-testing';
import { JiraMoves } from './jira-moves';
import { CardStore } from './store';

const chat = { chatId: 'chat-1', agent: 'claude-code', cwd: '/git/grimoire' };
const draft = {
  summary: 'Draw the context meter',
  description: 'From the usage events.',
  project: 'GRIM',
  issueType: 'Task',
};

describe('creating a Jira issue you confirmed', () => {
  let cards: CardStore;
  let emit: ReturnType<typeof vi.fn<(event: string, payload: unknown) => void>>;
  /** What Jira says as it refuses to create the issue, while it does. */
  let refuse: string | undefined;
  let fake: ReturnType<typeof fakeConnectors>;

  beforeEach(() => {
    cards = new CardStore(openBoard(':memory:'), undefined, () => 1_000);
    emit = vi.fn<(event: string, payload: unknown) => void>();
    refuse = undefined;
    fake = fakeConnectors({}, [], {
      atlassianUserInfo: () => text({ account_id: 'me-1', name: 'Me' }),
      createJiraIssue: () => {
        if (refuse) throw new ToolFailed('mcp__claude_ai_Atlassian__createJiraIssue', refuse);
        return text({ id: '10042', key: 'GRIM-42', self: 'https://acme/rest/api/3/issue/10042' });
      },
      getJiraIssue: () =>
        text(issue('GRIM-42', 'Draw the context meter', 'new', { status: { name: 'To Do' } })),
    });
  });

  it('creates it assigned to you, puts it on the board and links the chat to it', async () => {
    const moves = new JiraMoves(cards, fake.open, emit);
    const after = await moves.create(draft, chat);
    expect(fake.calls.find((call) => call.tool === 'createJiraIssue')!.args).toEqual({
      cloudId: 'cloud-1',
      projectKey: 'GRIM',
      issueTypeName: 'Task',
      summary: 'Draw the context meter',
      description: 'From the usage events.',
      assignee_account_id: 'me-1',
    });
    expect(after.find((card) => card.id === 'jira:personal:GRIM-42')).toMatchObject({
      kind: 'jira',
      title: 'Draw the context meter',
      column: 'todo',
      chats: [{ ...chat, at: 1_000 }],
      jira: { key: 'GRIM-42', status: 'To Do', url: 'https://acme.atlassian.net/browse/GRIM-42' },
    });
    expect(emit).toHaveBeenCalledWith('kanban.changed', { cards: after });
    moves.close();
  });

  it('makes the card from the draft when the issue can’t be read', async () => {
    const unread = fakeConnectors({}, [], {
      atlassianUserInfo: () => text({}),
      createJiraIssue: () => text({ key: 'GRIM-42' }),
      getJiraIssue: () => text('Not found'),
    });
    const moves = new JiraMoves(cards, unread.open, emit);
    const after = await moves.create(draft, chat);
    expect(unread.calls.find((call) => call.tool === 'createJiraIssue')!.args).not.toHaveProperty(
      'assignee_account_id',
    );
    expect(after.find((card) => card.id === 'jira:personal:GRIM-42')).toMatchObject({
      title: 'Draw the context meter',
      notes: 'From the usage events.',
      jira: { status: 'To Do', type: 'Task', url: 'https://acme.atlassian.net/browse/GRIM-42' },
    });
    moves.close();
  });

  it('creates nothing when Jira refuses, saying what Jira said', async () => {
    refuse = '{"errorMessages":[],"errors":{"project":"valid project is required"}}';
    const moves = new JiraMoves(cards, fake.open, emit);
    await expect(moves.create(draft, chat)).rejects.toThrow(
      'Jira didn’t create the issue: valid project is required',
    );
    expect(cards.list()).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
    moves.close();
  });

  it('turns away a draft with no summary or no project before asking Jira', async () => {
    const moves = new JiraMoves(cards, fake.open, emit);
    await expect(moves.create({ ...draft, summary: ' ' }, chat)).rejects.toThrow(
      'A Jira issue needs a summary',
    );
    await expect(moves.create({ ...draft, project: '' }, chat)).rejects.toThrow(
      'A Jira issue needs a project',
    );
    expect(fake.allowed).toEqual([]);
  });
});
