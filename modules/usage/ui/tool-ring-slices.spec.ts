import { folderName, groupSlices, toolSlices } from './tool-ring-slices';

describe('tool ring slices', () => {
  it("slices the tools by their context, an MCP server's together, those that break down keyed", () => {
    expect(
      toolSlices([
        { name: 'Bash', uses: 112, context: 61_000 },
        { name: 'Grep', uses: 30, context: 4_000 },
        { name: 'mcp__claude_ai_Atlassian__getJiraIssue', uses: 3, context: 9_000 },
        { name: 'mcp__claude_ai_Atlassian__searchJira', uses: 2, context: 6_000 },
        { name: 'mcp__grimoire__add_todo', uses: 1, context: 200 },
        // A tool whose results couldn't be measured has no slice.
        { name: 'TaskUpdate', uses: 9, context: 0 },
      ]),
    ).toEqual([
      { name: 'Bash', value: 61_000, note: '112 uses', key: 'Bash' },
      { name: 'Grep', value: 4_000, note: '30 uses' },
      { name: 'Atlassian', value: 15_000, note: '5 uses' },
      { name: 'Grimoire: add todo', value: 200, note: '1 use' },
    ]);
  });

  it("slices a tool's groups, with the rest of its context as Other", () => {
    expect(
      groupSlices('Bash', {
        uses: 10,
        context: 5_000,
        groups: [{ name: 'git diff', uses: 4, context: 3_000, cwd: '/repo' }],
        more: 3,
      }),
    ).toEqual([
      { name: 'git diff', value: 3_000, note: '4 uses' },
      { name: 'Other', value: 2_000, rest: true, count: 3 },
    ]);
    expect(
      groupSlices('Read', {
        uses: 1,
        context: 900,
        groups: [{ name: 'C:/repo/src', uses: 1, context: 900, cwd: 'c:\\repo' }],
        more: 0,
      })[0],
    ).toEqual({ name: 'src', title: 'C:/repo/src', value: 900, note: '1 use' });
  });

  it("names a folder by its place in the chat's folder, or by its last two parts", () => {
    expect(folderName('C:/repo/modules/usage', 'C:\\repo\\')).toBe('modules/usage');
    expect(folderName('C:/repo', 'C:/repo')).toBe('repo');
    expect(folderName('C:/Temp/scratchpad/e2e/out', 'C:/repo')).toBe('e2e/out');
    expect(folderName('C:/repo-two/a', 'C:/repo')).toBe('repo-two/a');
    expect(folderName('/')).toBe('/');
  });
});
