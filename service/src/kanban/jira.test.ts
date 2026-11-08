import type { Card } from '@grimoire/contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connector, Connectors, ToolResult } from '../agents/claude/connectors';
import { CommandRegistry } from '../registry';
import { setActiveProfile } from '../storage/app-state';
import { openDatabase } from '../storage/database';
import { registerJira } from './commands';
import { JIRA_READ_ONLY, JIRA_TOOLS, atlassianIn, columnOf, fetchJira, plainText, readSearch, readSite } from './jira';
import { JiraSyncer } from './jira-sync';
import { CardStore } from './store';

const SITE = 'https://acme.atlassian.net';
const text = (json: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(json) }] });

/** An issue as Jira's REST API writes it. */
const issue = (key: string, summary: string, category: string, change: Record<string, unknown> = {}) => ({
  id: '10001',
  key,
  fields: {
    summary,
    status: { name: change['status'] ?? 'Status', statusCategory: { key: category, name: 'Category' } },
    issuetype: { name: 'Story' },
    priority: { name: 'Medium' },
    description: null,
    ...change,
  },
});

const SITES = [
  { id: 'confluence-only', url: 'https://wiki.example.com', name: 'wiki', scopes: ['read:confluence-content.all'] },
  { id: 'cloud-1', url: `${SITE}/`, name: 'acme', scopes: ['read:jira-work', 'write:jira-work'] },
];

/**
 * A fake Claude Code process with an Atlassian connector: its status, and
 * its tools' answers, each search the next of `pages`.
 */
function fakeConnectors(connector: Partial<Connector> | null, pages: unknown[] = [{ issues: [] }]) {
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
            tools: ['getAccessibleAtlassianResources', 'searchJiraIssuesUsingJql', 'createJiraIssue'],
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
        calls.push({ tool, args });
        if (tool === 'getAccessibleAtlassianResources') return text(SITES);
        if (tool === 'searchJiraIssuesUsingJql') return text(pages.shift());
        throw new Error(`No ${tool}`);
      },
      close,
    };
  };
  return { open, calls, allowed, close };
}

describe('reading the Atlassian connector’s answers', () => {
  it('picks the first site with Jira, its address without a trailing slash', () => {
    expect(readSite(text(SITES))).toEqual({ cloudId: 'cloud-1', url: SITE });
    expect(readSite(text({ resources: [{ id: 'c', url: 'http://plain.example' }] }))).toEqual({
      cloudId: 'c',
      url: '',
    });
    expect(() => readSite(text([]))).toThrow('getAccessibleAtlassianResources listed no site with a cloud ID');
    expect(() => readSite(text({ sites: 'none' }))).toThrow("didn't answer with a list of sites");
  });

  it('reads a page of issues, from Jira’s own shape or a flat one, with the token for the next', () => {
    const page = readSearch(
      text({
        issues: [
          issue('GRIM-1', 'Context meter', 'indeterminate', {
            status: { name: 'In Review', statusCategory: { key: 'indeterminate' } },
            priority: { name: 'High' },
            issuetype: { name: 'Bug' },
            description: 'Fill it in.\n',
          }),
          { key: 'GRIM-2', summary: 'Night theme', status: 'Done', statusCategory: 'Done' },
        ],
        nextPageToken: 'page-2',
        isLast: false,
      }),
      SITE,
    );
    expect(page).toEqual({
      issues: [
        {
          key: 'GRIM-1',
          url: `${SITE}/browse/GRIM-1`,
          summary: 'Context meter',
          description: 'Fill it in.',
          type: 'Bug',
          priority: 'High',
          status: 'In Review',
          column: 'doing',
        },
        {
          key: 'GRIM-2',
          url: `${SITE}/browse/GRIM-2`,
          summary: 'Night theme',
          description: '',
          type: '',
          priority: '',
          status: 'Done',
          column: 'done',
        },
      ],
      next: 'page-2',
    });
    expect(readSearch(text({ issues: [], nextPageToken: 'x', isLast: true }), SITE)).toEqual({ issues: [] });
    // JSON may come after a line of prose, or as structured content.
    expect(
      readSearch({ content: [{ type: 'text', text: 'Found 0 issues' }], structuredContent: { issues: [] } }, ''),
    ).toEqual({ issues: [] });
    expect(
      readSearch(
        { content: [{ type: 'text', text: 'Found 1 issue' }, ...text([issue('A-1', 'A', 'new')]).content] },
        '',
      ).issues.map((found) => [found.key, found.url]),
    ).toEqual([['A-1', '']]);
  });

  it('says what didn’t match in an answer it can’t read', () => {
    expect(() => readSearch({ content: [{ type: 'text', text: '# Issues\n- GRIM-1' }] }, SITE)).toThrow(
      "searchJiraIssuesUsingJql didn't answer in JSON: # Issues",
    );
    expect(() => readSearch({ content: [] }, SITE)).toThrow('searchJiraIssuesUsingJql answered with no text');
    expect(() => readSearch(text({ total: 0, results: 'none' }), SITE)).toThrow(
      'searchJiraIssuesUsingJql answered with no list of issues (it has total, results)',
    );
    expect(() => readSearch(text({ issues: [{ id: '1' }] }), SITE)).toThrow(
      "searchJiraIssuesUsingJql's issue 1 has no key",
    );
    expect(() => readSearch(text({ issues: [{ key: 'A-1', fields: {} }] }), SITE)).toThrow(
      "searchJiraIssuesUsingJql's issue A-1 has no summary",
    );
  });

  it('puts an issue in the column its status’s category says', () => {
    expect(columnOf({ key: 'new', name: 'To Do' })).toBe('todo');
    expect(columnOf({ key: 'indeterminate', name: 'In Progress' })).toBe('doing');
    expect(columnOf({ key: 'done', name: 'Done' })).toBe('done');
    expect(columnOf({ name: 'In Progress' })).toBe('doing');
    expect(columnOf('To Do')).toBe('todo');
    expect(columnOf(undefined)).toBe('todo');
    expect(columnOf({ key: 'undefined' })).toBe('todo');
  });

  it('writes a description in Atlassian Document Format out as plain text', () => {
    const adf = {
      type: 'doc',
      version: 1,
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Why' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Ask ' },
            { type: 'mention', attrs: { id: 'x', text: '@Abel' } },
            { type: 'text', text: ' first.' },
            { type: 'hardBreak' },
            { type: 'text', text: 'See ', marks: [{ type: 'strong' }] },
            { type: 'inlineCard', attrs: { url: 'https://example.com/spec' } },
          ],
        },
        {
          type: 'orderedList',
          attrs: { order: 1 },
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fill' }] }] },
          ],
        },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Test' }] }] }],
        },
        { type: 'codeBlock', content: [{ type: 'text', text: 'npm test' }] },
      ],
    };
    expect(plainText(adf)).toBe(
      'Why\n\nAsk @Abel first.\nSee https://example.com/spec\n\n1. Read\n2. Fill\n\n- Test\n\nnpm test',
    );
    expect(plainText('  As markdown  ')).toBe('As markdown');
    expect(plainText(null)).toBe('');
  });
});

describe('finding the Atlassian connector', () => {
  it('takes the one with the tools the sync calls, among several named Atlassian', () => {
    const connector = (name: string, status: Connector['status'], tools: string[] = []): Connector => ({
      name,
      status,
      tools,
    });
    const rovo = connector('claude.ai Atlassian Rovo', 'needs-auth');
    const atlassian = connector('claude.ai Atlassian', 'connected', Object.values(JIRA_TOOLS));
    expect(atlassianIn([connector('claude.ai Slack', 'connected'), rovo, atlassian])).toBe(atlassian);
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
    expect(await fetchJira(fakeConnectors({ status: 'disabled' }).open, 'jql')).toEqual({ outcome: 'none' });
    expect(await fetchJira(fakeConnectors({ status: 'needs-auth' }).open, 'jql')).toEqual({ outcome: 'needs-auth' });
    expect(await fetchJira(fakeConnectors({ status: 'failed', error: 'HTTP 500' }).open, 'jql')).toEqual({
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
    const many = Array.from({ length: 60 }, (_, i) => issue(`GRIM-${i + 1}`, `Task ${i + 1}`, 'new'));
    const { open, calls, allowed, close } = fakeConnectors({}, [
      { issues: many.slice(0, 50), nextPageToken: 'p2' },
      { issues: [many[49], ...many.slice(50)], nextPageToken: 'p3' },
      { issues: [issue('GRIM-999', 'Never asked for', 'new')] },
    ]);
    const fetched = await fetchJira(open, 'assignee = currentUser()');
    expect([...allowed[0]!].sort()).toEqual([...JIRA_READ_ONLY].sort());
    expect(JIRA_READ_ONLY.has('createJiraIssue')).toBe(false);
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
    expect(fetched.outcome === 'synced' && fetched.issues.map((found) => found.key)).toHaveLength(61);
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

describe('Jira cards on the board', () => {
  let now: number;
  let db: ReturnType<typeof openDatabase>;
  let cards: CardStore;
  let pages: unknown[];
  let emit: ReturnType<typeof vi.fn<(event: string, payload: unknown) => void>>;
  let syncer: JiraSyncer;

  beforeEach(() => {
    now = 1_000;
    db = openDatabase(':memory:');
    cards = new CardStore(db, undefined, () => now);
    pages = [];
    emit = vi.fn<(event: string, payload: unknown) => void>();
    const open = (allowed: ReadonlySet<string>) => fakeConnectors({}, pages).open(allowed);
    syncer = new JiraSyncer(cards, () => 'assignee = currentUser()', open, emit, undefined, () => now);
  });

  const titles = (all: Card[] = cards.list()) =>
    all.filter((card) => !card.closedAt).map((card) => `${card.column} ${card.title}`);

  it('puts the issues found in their columns, after your own cards, each with what Jira says of it', async () => {
    cards.save({ title: 'Mine', notes: '', cwd: '/git' });
    pages.push({
      issues: [
        issue('GRIM-2', 'Night theme', 'done', { status: { name: 'Closed', statusCategory: { key: 'done' } } }),
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
      jira: { key: 'GRIM-1', url: `${SITE}/browse/GRIM-1`, type: 'Story', priority: 'Medium', status: 'Status' },
    });
    expect(emit.mock.calls.map(([event]) => event)).toEqual(['kanban.jira', 'kanban.changed', 'kanban.jira']);
    expect(emit.mock.calls[0]![1]).toEqual({ jira: { status: 'none', syncing: true } });
  });

  it('replaces them each sync, keeping a closed one closed and the chats each began, and Jira’s columns', async () => {
    pages.push({ issues: [issue('GRIM-1', 'Context meter', 'new'), issue('GRIM-2', 'Night theme', 'new')] });
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
    expect(cards.list().find((card) => card.jira?.key === 'GRIM-2')).toMatchObject({ closedAt: 1_000 });

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

  it('answers its commands', async () => {
    const registry = new CommandRegistry();
    registerJira(registry, syncer);
    expect(await registry.dispatch('kanban.jira', {})).toEqual({ status: 'none', syncing: false });
    pages.push({ issues: [] });
    expect(await registry.dispatch('kanban.syncJira', {})).toEqual({
      status: 'synced',
      syncedAt: 1_000,
      syncing: false,
    });
  });
});
