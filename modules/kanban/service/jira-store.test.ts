import { beforeEach, describe, expect, it } from 'vitest';
import type { FetchedIssue } from './jira-fields';
import { JiraCards, jiraCardId } from './jira-store';
import { openBoard } from './jira-testing';

const found = (key: string, column: FetchedIssue['column'], summary = key): FetchedIssue => ({
  key,
  summary,
  description: '',
  url: `https://acme.atlassian.net/browse/${key}`,
  type: 'Story',
  priority: 'Medium',
  status: column === 'done' ? 'Done' : column === 'doing' ? 'In Progress' : 'To Do',
  column,
});

let jira: JiraCards;
const keys = (profile = 'personal') => jira.list(profile).map((card) => card.jira?.key);

beforeEach(() => {
  jira = new JiraCards(openBoard(':memory:'));
});

describe('JiraCards', () => {
  it('puts the issues found on the board column by column, each column in Jira’s order', () => {
    jira.replace('personal', [found('A', 'done'), found('B', 'todo'), found('C', 'doing')], 1);
    expect(keys()).toEqual(['B', 'C', 'A']);
    expect(jira.list('personal')[0]).toEqual({
      id: jiraCardId('personal', 'B'),
      kind: 'jira',
      title: 'B',
      notes: '',
      cwd: '',
      column: 'todo',
      createdAt: 1,
      jira: {
        key: 'B',
        url: 'https://acme.atlassian.net/browse/B',
        type: 'Story',
        priority: 'Medium',
        status: 'To Do',
      },
    });
    expect(jira.state('personal')).toEqual({ status: 'synced', syncedAt: 1 });
  });

  it('replaces them each sync, keeping when each was first seen and whether it was closed', () => {
    jira.replace('personal', [found('A', 'todo'), found('B', 'todo')], 1);
    jira.close('personal', jiraCardId('personal', 'A'), true, 2);
    jira.replace('personal', [found('C', 'todo'), found('A', 'todo', 'A, renamed')], 3);
    expect(
      jira.list('personal').map(({ title, createdAt, closedAt }) => [title, createdAt, closedAt]),
    ).toEqual([
      ['C', 3, undefined],
      ['A, renamed', 1, 2],
    ]);
    jira.close('personal', jiraCardId('personal', 'A'), false, 4);
    expect(jira.list('personal')[1]!.closedAt).toBeUndefined();
  });

  it('keeps an issue updated since a sync began as it was updated', () => {
    jira.replace('personal', [found('A', 'todo')], 1);
    jira.update('personal', { key: 'A', status: 'Done', column: 'done' }, 5);
    jira.replace('personal', [found('A', 'todo')], 6, 4);
    expect(jira.list('personal')[0]).toMatchObject({ title: 'A', column: 'done' });
    // A sync begun after the update takes what Jira says.
    jira.replace('personal', [found('A', 'todo')], 8, 7);
    expect(jira.list('personal')[0]!.column).toBe('todo');
  });

  it('keeps each profile’s cards and syncs apart', () => {
    jira.replace('personal', [found('A', 'todo')], 1);
    jira.replace('work', [found('A', 'todo'), found('W', 'todo')], 2);
    expect([keys(), keys('work')]).toEqual([['A'], ['A', 'W']]);
    expect(jira.has('personal', jiraCardId('work', 'W'))).toBe(false);
    expect(jira.keyOf('work', jiraCardId('work', 'W'))).toBe('W');
    expect(jira.keyOf('personal', jiraCardId('work', 'W'))).toBeUndefined();
    expect(jiraCardId('work', 'A')).not.toBe(jiraCardId('personal', 'A'));
  });

  it('notes a sync that failed, keeping the issues and when it last synced', () => {
    expect(jira.state('personal')).toEqual({ status: 'none' });
    jira.replace('personal', [found('A', 'todo')], 1);
    jira.note('personal', 'failed', 'Jira is down');
    expect(jira.state('personal')).toEqual({
      status: 'failed',
      error: 'Jira is down',
      syncedAt: 1,
    });
    expect(keys()).toEqual(['A']);
  });
});
