import { describe, expect, it } from 'vitest';
import type { Connector } from '@grimoire/service/claude/connectors';
import { atlassianIn, fetchJira } from './jira';
import { fakeConnectors, issue } from './jira-testing';
import { JIRA_READ_ONLY, JIRA_TOOLS } from './jira-tools';

describe('finding the Atlassian connector', () => {
  it('takes the one with the tools the sync calls, among several named Atlassian', () => {
    const connector = (
      name: string,
      status: Connector['status'],
      tools: string[] = [],
    ): Connector => ({
      name,
      status,
      tools,
    });
    const rovo = connector('claude.ai Atlassian Rovo', 'needs-auth');
    const atlassian = connector('claude.ai Atlassian', 'connected', Object.values(JIRA_TOOLS));
    expect(atlassianIn([connector('claude.ai Slack', 'connected'), rovo, atlassian])).toBe(
      atlassian,
    );
    const other = connector('claude.ai Atlassian (2)', 'connected');
    expect(atlassianIn([rovo, other])).toBe(other);
    expect(atlassianIn([rovo])).toBe(rovo);
    expect(atlassianIn([connector('claude.ai Slack', 'connected')])).toBeUndefined();
  });
});

describe('fetching your Jira issues', () => {
  it('finds nothing where there’s no Atlassian connector, and says when it needs connecting again', async () => {
    const none = fakeConnectors(null);
    expect(await fetchJira(none.open, 'jql')).toEqual({ outcome: 'none' });
    expect(none.calls).toEqual([]);
    expect(none.close).toHaveBeenCalled();
    expect(await fetchJira(fakeConnectors({ status: 'disabled' }).open, 'jql')).toEqual({
      outcome: 'none',
    });
    expect(await fetchJira(fakeConnectors({ status: 'needs-auth' }).open, 'jql')).toEqual({
      outcome: 'needs-auth',
    });
    expect(
      await fetchJira(fakeConnectors({ status: 'failed', error: 'HTTP 500' }).open, 'jql'),
    ).toEqual({
      outcome: 'failed',
      error: 'HTTP 500',
    });
    expect(await fetchJira(fakeConnectors({ tools: ['getJiraIssue'] }).open, 'jql')).toEqual({
      outcome: 'failed',
      error:
        'claude.ai Atlassian has no getAccessibleAtlassianResources or searchJiraIssuesUsingJql; it has getJiraIssue',
    });
  });

  it('allows only tools that read, and asks for the issues a page at a time, up to the most', async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      issue(`GRIM-${i + 1}`, `Task ${i + 1}`, 'new'),
    );
    const { open, calls, allowed, close } = fakeConnectors({}, [
      { issues: many.slice(0, 50), nextPageToken: 'p2' },
      { issues: [many[49], ...many.slice(50)], nextPageToken: 'p3' },
      { issues: [issue('GRIM-999', 'Never asked for', 'new')] },
    ]);
    const fetched = await fetchJira(open, 'assignee = currentUser()');
    expect([...allowed[0]!].sort()).toEqual([...JIRA_READ_ONLY].sort());
    expect(JIRA_READ_ONLY.has('createJiraIssue')).toBe(false);
    expect(JIRA_READ_ONLY.has('transitionJiraIssue')).toBe(false);
    expect(calls).toEqual([
      { tool: 'getAccessibleAtlassianResources', args: {} },
      {
        tool: 'searchJiraIssuesUsingJql',
        args: {
          cloudId: 'cloud-1',
          jql: 'assignee = currentUser()',
          fields: ['summary', 'description', 'status', 'issuetype', 'priority'],
          maxResults: 50,
        },
      },
      {
        tool: 'searchJiraIssuesUsingJql',
        args: expect.objectContaining({ maxResults: 50, nextPageToken: 'p2' }),
      },
      {
        tool: 'searchJiraIssuesUsingJql',
        args: expect.objectContaining({ maxResults: 40, nextPageToken: 'p3' }),
      },
    ]);
    expect(fetched.outcome === 'synced' && fetched.issues.map((found) => found.key)).toHaveLength(
      61,
    );
    expect(close).toHaveBeenCalled();
  });

  it('says why when a tool fails or answers in a shape it can’t read', async () => {
    const { open } = fakeConnectors({}, ['not json']);
    expect(await fetchJira(open, 'jql')).toEqual({
      outcome: 'failed',
      error: 'searchJiraIssuesUsingJql answered with no list of issues (it has string)',
    });
  });
});
