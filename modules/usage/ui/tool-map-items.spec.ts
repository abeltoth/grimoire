import { blocksOf, shadesOf, shortTarget, targetItems, toolItems } from './tool-map-items';

describe('tool map items', () => {
  it('puts the blocks past the most drawn together as "Other", holding them', () => {
    const items = toolItems(
      Array.from({ length: 10 }, (_, i) => ({
        name: `Tool${i}`,
        uses: 1,
        context: 1_000 * (10 - i),
      })),
    );
    const blocks = blocksOf(items);
    expect(blocks).toHaveLength(8);
    expect(blocks.at(-1)).toMatchObject({
      key: 'other',
      name: 'Other · 3 more',
      uses: 3,
      context: 6_000,
    });
    expect(blocks.at(-1)!.rest!.map((item) => item.name)).toEqual(['Tool7', 'Tool8', 'Tool9']);
    expect(blocksOf(items.slice(0, 8))).toHaveLength(8);
  });

  it("names an MCP server's tools together, and one alone for itself", () => {
    expect(
      toolItems([
        { name: 'mcp__claude_ai_Atlassian__getJiraIssue', uses: 3, context: 9_000 },
        { name: 'mcp__claude_ai_Atlassian__searchJira', uses: 2, context: 6_000 },
        { name: 'mcp__grimoire__add_todo', uses: 1, context: 200 },
      ]).map(({ name, tools }) => ({ name, tools })),
    ).toEqual([
      {
        name: 'Atlassian',
        tools: ['mcp__claude_ai_Atlassian__getJiraIssue', 'mcp__claude_ai_Atlassian__searchJira'],
      },
      { name: 'Grimoire: add todo', tools: ['mcp__grimoire__add_todo'] },
    ]);
  });

  it('names a file by its name and a command in full, each with its tool when there are several', () => {
    const chat = { id: 'c1', agent: 'a', title: 'Fix' };
    const target = (tool: string, target: string | undefined) => ({
      tool,
      ...(target ? { target } : {}),
      uses: 1,
      context: 100,
      chats: 1,
      chat,
    });
    expect(
      targetItems([target('Read', '/repo/src/a.ts'), target('Bash', 'npm test')], true).map(
        ({ name, full, code }) => ({ name, full, code }),
      ),
    ).toEqual([
      { name: 'a.ts', full: 'Read · /repo/src/a.ts', code: true },
      { name: 'npm test', full: 'Bash · npm test', code: true },
    ]);
    expect(targetItems([target('mcp__jira__get', undefined)], false)[0]).toMatchObject({
      name: 'Jira: get',
      full: 'Jira: get',
    });
    expect(shortTarget('C:\\repo\\package.json')).toBe('package.json');
    expect(shortTarget('git diff src/a.ts')).toBe('git diff src/a.ts');
  });

  it('shades each block by its context a use, as dark for as heavy', () => {
    const item = (context: number, uses: number) => ({
      key: '',
      name: '',
      full: '',
      context,
      uses,
    });
    const [heaviest, lightest, between] = shadesOf([item(10_000, 1), item(100, 1), item(1_000, 1)]);
    expect([heaviest, lightest]).toEqual([100, 25]);
    expect(between).toBeCloseTo(62.5);
    expect(shadesOf([item(4_000, 2), item(2_000, 1)])).toEqual([100, 100]);
  });
});
