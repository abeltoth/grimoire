import type { ToolResult } from '@grimoire/service/claude/connectors';

/** What the Jira files' tests share: the Atlassian connector's answers as Jira writes them. */
export const SITE = 'https://acme.atlassian.net';
export const text = (json: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(json) }],
});

/** An issue as Jira's REST API writes it. */
export const issue = (
  key: string,
  summary: string,
  category: string,
  change: Record<string, unknown> = {},
) => ({
  id: '10001',
  key,
  fields: {
    summary,
    status: {
      name: change['status'] ?? 'Status',
      statusCategory: { key: category, name: 'Category' },
    },
    issuetype: { name: 'Story' },
    priority: { name: 'Medium' },
    description: null,
    ...change,
  },
});

export const SITES = [
  {
    id: 'confluence-only',
    url: 'https://wiki.example.com',
    name: 'wiki',
    scopes: ['read:confluence-content.all'],
  },
  { id: 'cloud-1', url: `${SITE}/`, name: 'acme', scopes: ['read:jira-work', 'write:jira-work'] },
];

/** The transitions an issue in To Do allows, as Jira's REST API writes them. */
export const TRANSITIONS = {
  expand: 'transitions',
  transitions: [
    {
      id: '11',
      name: 'Start',
      to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    },
    {
      id: '21',
      name: 'Review',
      to: { name: 'In Review', statusCategory: { key: 'indeterminate' } },
    },
    {
      id: '31',
      name: 'Finish',
      to: { name: 'Done', statusCategory: { key: 'done' } },
      hasScreen: false,
    },
    { id: '41', name: 'Park', to: { name: 'Backlog', statusCategory: { key: 'new' } } },
  ],
};
