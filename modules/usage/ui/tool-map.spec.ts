import type { CommandRequest, TokenTotals, ToolTarget, UsedTool } from '@grimoire/contract';
import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';

describe('UsageToolMap', () => {
  const now = new Date(2026, 10, 9, 15, 30).getTime();
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const zero = { input: 0, cacheWritten: 0, cacheWrittenLong: 0, cacheRead: 0, output: 0 };
  const spent = { ...zero, input: 1_000, cost: { ...zero, input: 10 }, dollars: 10 };
  const chat = { id: 'c1', agent: 'claude-code', title: 'Fix login', cwd: 'C:/work' };

  async function showMap(tools: UsedTool[], targets: ToolTarget[] = []) {
    const fake = fakeBridge();
    fake.answers['usage.plan'] = () => ({ plan: 'max', windows: [], at: 0 });
    fake.answers['usage.breakdown'] = () => null;
    fake.answers['search.tokens'] = ({ since }: CommandRequest<'search.tokens'>): TokenTotals => ({
      since,
      total: spent,
      unpriced: 0,
      chatCount: 1,
      days: [],
      hours: [],
      models: [],
      folders: [],
      sources: [],
      chats: [],
      tools,
      skills: [],
    });
    fake.answers['search.toolTargets'] = () => targets;
    const rendered = await render(fake.bridge);
    await openPageTab(rendered.fixture, rendered.el, 'Ledger');
    [...rendered.el.querySelectorAll<HTMLButtonElement>('gr-usage-page .tabs button')]
      .find((button) => button.textContent!.trim() === 'Tokens')!
      .click();
    await rendered.fixture.whenStable();
    const blocks = () => [
      ...rendered.el.querySelectorAll<HTMLButtonElement>('gr-usage-tool-map .block'),
    ];
    const readout = () =>
      rendered.texts('gr-usage-tool-map .readout')[0]?.replace(/\s+/g, ' ') ?? '';
    const pick = async (name: string) => {
      blocks()
        .find((block) => block.getAttribute('aria-label')!.startsWith(`${name}:`))!
        .click();
      await rendered.fixture.whenStable();
    };
    return { ...fake, ...rendered, blocks, readout, pick };
  }

  it("draws a block for each tool by the context its results added, an MCP server's together", async () => {
    const { el, texts, blocks } = await showMap([
      { name: 'Bash', uses: 112, context: 61_000 },
      { name: 'Read', uses: 40, context: 182_000 },
      { name: 'mcp__claude_ai_Atlassian__getJiraIssue', uses: 3, context: 9_000 },
      { name: 'mcp__claude_ai_Atlassian__searchJira', uses: 2, context: 6_000 },
      // A tool whose results couldn't be measured has no block.
      { name: 'TaskUpdate', uses: 9, context: 0 },
    ]);
    expect(texts('gr-usage-page .split').some((text) => text.startsWith('Context by tool'))).toBe(
      true,
    );
    // What the map shows is behind the icon beside its name.
    expect(el.querySelector('gr-usage-page .split gr-usage-about')).not.toBeNull();
    expect(el.querySelector('gr-usage-page details')).toBeNull();
    expect(texts('gr-usage-tool-map .block .name')).toEqual(['Read', 'Bash', 'Atlassian']);
    expect(texts('gr-usage-tool-map .block .figures')[0]).toBe('182K · 40 uses');
    // The largest block is the largest, and the heaviest a use the darkest.
    const [read, bash, jira] = blocks();
    const area = (block: HTMLElement) =>
      parseFloat(block.style.width) * parseFloat(block.style.height);
    expect(area(read!)).toBeGreaterThan(area(bash!));
    expect(read!.style.getPropertyValue('--shade')).toBe('100%');
    expect(bash!.style.getPropertyValue('--shade')).toBe('25%');
    expect(jira!.getAttribute('aria-label')).toBe(
      'Atlassian: 15K tokens of context, 5 uses, 3K a use',
    );
    // The map sits between the cost's ring and the tips.
    const order = [...el.querySelectorAll('gr-usage-pie, gr-usage-tool-map')];
    expect(order.map((node) => node.tagName.toLowerCase())).toEqual([
      'gr-usage-pie',
      'gr-usage-tool-map',
    ]);
  });

  it("writes a block's name and figures only where they fit, and reads out the one under the pointer", async () => {
    const { fixture, blocks, readout } = await showMap([
      { name: 'Read', uses: 40, context: 120_000 },
      { name: 'Grep', uses: 85, context: 60_000 },
      { name: 'Glob', uses: 2, context: 300 },
    ]);
    const [read, grep, glob] = blocks();
    expect(read!.querySelector('.figures')).not.toBeNull();
    expect(grep!.querySelector('.name')).not.toBeNull();
    expect(glob!.textContent!.trim()).toBe('');
    expect(readout()).toBe(
      '180.3K tokens of context from 127 uses · pick a tool to see what it ran on',
    );
    glob!.dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();
    expect(readout()).toBe('Glob 300 tokens of context · 2 uses · 150 a use');
    expect(read!.classList).toContain('dim');
  });

  it('zooms into what a tool ran on, each file a block opening the chat it added the most to', async () => {
    const { fixture, el, texts, calls, readout, pick, blocks } = await showMap(
      [{ name: 'Read', uses: 40, context: 180_000 }],
      [
        {
          tool: 'Read',
          target: 'C:\\work\\package-lock.json',
          uses: 5,
          context: 60_000,
          chats: 3,
          chat,
        },
        { tool: 'Read', target: 'C:\\work\\a.ts', uses: 2, context: 30_000, chats: 1, chat },
      ],
    );
    await pick('Read');
    const asked = calls.find((c) => c.command === 'search.toolTargets')!;
    expect((asked.request as CommandRequest<'search.toolTargets'>).tools).toEqual(['Read']);
    expect(texts('gr-usage-tool-map .crumbs > *')).toEqual(['All tools', '›', 'Read']);
    expect(texts('gr-usage-tool-map .block .name')).toEqual(['package-lock.json', 'a.ts']);
    expect(blocks()[0]!.classList).toContain('code');
    expect(readout()).toBe(
      '180K tokens of context from 40 uses · pick one to open the chat it added the most to',
    );
    blocks()[0]!.dispatchEvent(new FocusEvent('focus'));
    await fixture.whenStable();
    expect(readout()).toBe(
      'C:\\work\\package-lock.json 60K tokens of context · 5 uses in 3 chats · 12K a use · most in Fix login',
    );

    await pick('C:\\work\\package-lock.json');
    expect(calls.find((c) => c.command === 'agents.open')!.request).toEqual({
      agent: 'claude-code',
      chatId: 'c1',
      settings: { cwd: 'C:/work' },
    });

    // Back to every tool.
    el.querySelector<HTMLButtonElement>('gr-usage-tool-map .crumbs button')!.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-usage-tool-map .crumbs')).toBeNull();
    expect(texts('gr-usage-tool-map .block .name')).toEqual(['Read']);
  });

  it('zooms into "Other" for the tools past the most it draws', async () => {
    const tools = Array.from({ length: 10 }, (_, i) => ({
      name: `Tool${i}`,
      uses: 1,
      context: 1_000 * (10 - i),
    }));
    const { texts, pick, blocks } = await showMap(tools);
    expect(blocks()).toHaveLength(8);
    await pick('Other · 3 more');
    expect(texts('gr-usage-tool-map .crumbs > *')).toEqual(['All tools', '›', 'Other']);
    expect(blocks().map((block) => block.getAttribute('aria-label')!.split(':')[0])).toEqual([
      'Tool7',
      'Tool8',
      'Tool9',
    ]);
  });

  it("says so when what a tool ran on can't be read", async () => {
    const { answers, pick, texts } = await showMap([{ name: 'Read', uses: 4, context: 900 }]);
    answers['search.toolTargets'] = () => {
      throw new Error('The search stopped');
    };
    await pick('Read');
    expect(texts('gr-usage-tool-map .none')).toEqual([
      'What it ran on couldn’t be read: The search stopped',
    ]);
  });

  it('says so when no tool could be measured', async () => {
    const { texts } = await showMap([{ name: 'Read', uses: 4, context: 0 }]);
    expect(texts('gr-usage-tool-map .none')).toEqual([
      'No tool’s context could be measured over this span.',
    ]);
  });
});
