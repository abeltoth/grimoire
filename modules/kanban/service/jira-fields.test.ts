import { describe, expect, it } from 'vitest';
import { ToolFailed } from '@grimoire/service/claude/connectors';
import {
  columnOf,
  jiraSaid,
  plainText,
  readSearch,
  readSite,
  readTransitions,
} from './jira-fields';
import { SITE, SITES, TRANSITIONS, issue, text } from './jira-testing';

describe('reading the Atlassian connector’s answers', () => {
  it('picks the first site with Jira, its address without a trailing slash', () => {
    expect(readSite(text(SITES))).toEqual({ cloudId: 'cloud-1', url: SITE });
    expect(readSite(text({ resources: [{ id: 'c', url: 'http://plain.example' }] }))).toEqual({
      cloudId: 'c',
      url: '',
    });
    expect(() => readSite(text([]))).toThrow(
      'getAccessibleAtlassianResources listed no site with a cloud ID',
    );
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
    expect(readSearch(text({ issues: [], nextPageToken: 'x', isLast: true }), SITE)).toEqual({
      issues: [],
    });
    // JSON may come after a line of prose, or as structured content.
    expect(
      readSearch(
        { content: [{ type: 'text', text: 'Found 0 issues' }], structuredContent: { issues: [] } },
        '',
      ),
    ).toEqual({ issues: [] });
    expect(
      readSearch(
        {
          content: [
            { type: 'text', text: 'Found 1 issue' },
            ...text([issue('A-1', 'A', 'new')]).content,
          ],
        },
        '',
      ).issues.map((found) => [found.key, found.url]),
    ).toEqual([['A-1', '']]);
  });

  it('says what didn’t match in an answer it can’t read', () => {
    expect(() =>
      readSearch({ content: [{ type: 'text', text: '# Issues\n- GRIM-1' }] }, SITE),
    ).toThrow("searchJiraIssuesUsingJql didn't answer in JSON: # Issues");
    expect(() => readSearch({ content: [] }, SITE)).toThrow(
      'searchJiraIssuesUsingJql answered with no text',
    );
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
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fill' }] }],
            },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Test' }] }],
            },
          ],
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

describe('reading an issue’s transitions', () => {
  it('reads Jira’s own shape, or a plain list with the status flat, each in the column its category says', () => {
    expect(readTransitions(text(TRANSITIONS))).toEqual([
      { id: '11', name: 'Start', status: 'In Progress', column: 'doing' },
      { id: '21', name: 'Review', status: 'In Review', column: 'doing' },
      { id: '31', name: 'Finish', status: 'Done', column: 'done' },
      { id: '41', name: 'Park', status: 'Backlog', column: 'todo' },
    ]);
    expect(
      readTransitions(
        text([{ id: 5, name: 'Close', to: 'Closed', statusCategory: { name: 'Done' } }]),
      ),
    ).toEqual([{ id: '5', name: 'Close', status: 'Closed', column: 'done' }]);
  });

  it('says what didn’t match in an answer it can’t read', () => {
    expect(() => readTransitions(text({ total: 1 }))).toThrow(
      'getTransitionsForJiraIssue answered with no list of transitions (it has total)',
    );
    expect(() => readTransitions(text([{ name: 'Start' }]))).toThrow(
      "getTransitionsForJiraIssue's transition 1 has no ID (it has name)",
    );
    expect(() =>
      readTransitions(text([{ id: '11', name: 'Start', to: { name: 'In Progress', id: '3' } }])),
    ).toThrow(
      'getTransitionsForJiraIssue\'s transition "Start" says no category of the status it leads to (it has name, id)',
    );
  });

  it('words what Jira said when it refused', () => {
    const refused = (said: string) =>
      new ToolFailed('mcp__claude_ai_Atlassian__transitionJiraIssue', said);
    expect(
      jiraSaid(
        refused('HTTP 400: {"errorMessages":[],"errors":{"resolution":"Resolution is required."}}'),
      ),
    ).toBe('Resolution is required.');
    expect(jiraSaid(refused('{"errorMessages":["You can’t."],"errors":{}}'))).toBe('You can’t.');
    expect(jiraSaid(refused('Transition is not valid'))).toBe('Transition is not valid');
    expect(jiraSaid(refused(''))).toBe('it said no more');
    expect(jiraSaid(new Error('Claude Code exited'))).toBe('Claude Code exited');
  });
});
