import { vi } from 'vitest';
import type { Connector, Connectors, ToolResult } from '@grimoire/service/claude/connectors';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { MIGRATIONS } from './migrations';

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

/** Grimoire's database with the board's tables. */
export function openBoard(file: string) {
  const db = openDatabase(file);
  migrate(db, 'kanban', MIGRATIONS);
  return db;
}

/** What the fake Atlassian connector's other tools answer, by tool. */
export type Answers = Record<
  string,
  (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>
>;

/**
 * A fake Claude Code process with an Atlassian connector: its status, and
 * its tools' answers, each search the next of `pages`.
 */
export function fakeConnectors(
  connector: Partial<Connector> | null,
  pages: unknown[] = [{ issues: [] }],
  answers: Answers = {},
) {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  const allowed: ReadonlySet<string>[] = [];
  const close = vi.fn();
  const listed: Connector[] = [
    { name: 'claude.ai Claude Docs', status: 'connected', tools: ['guide'] },
    ...(connector
      ? [
          {
            name: 'claude.ai Atlassian',
            status: 'connected' as const,
            tools: [
              'getAccessibleAtlassianResources',
              'searchJiraIssuesUsingJql',
              'getJiraIssue',
              'getTransitionsForJiraIssue',
              'transitionJiraIssue',
              'createJiraIssue',
            ],
            ...connector,
          },
        ]
      : []),
  ];
  const open = async (allow: ReadonlySet<string>): Promise<Connectors> => {
    allowed.push(allow);
    return {
      list: async () => listed,
      call: async (_connector, tool, args) => {
        if (!allow.has(tool))
          throw new Error(`Grimoire doesn't call claude.ai Atlassian's tool "${tool}"`);
        calls.push({ tool, args });
        if (answers[tool]) return answers[tool](args);
        if (tool === 'getAccessibleAtlassianResources') return text(SITES);
        if (tool === 'searchJiraIssuesUsingJql') return text(pages.shift());
        throw new Error(`No ${tool}`);
      },
      close,
    };
  };
  return { open, calls, allowed, close };
}
