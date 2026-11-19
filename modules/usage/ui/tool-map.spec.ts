import type { CommandRequest, TokenTotals, ToolCall, UsedTool } from '@grimoire/contract';
import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';
import { blocksOf, shadesOf } from './tool-map';

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

  async function showMap(tools: UsedTool[], calls: ToolCall[] = []) {
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
    fake.answers['search.toolCalls'] = () => calls;
    const rendered = await render(fake.bridge);
    await openPageTab(rendered.fixture, rendered.el, 'Ledger');
    [...rendered.el.querySelectorAll<HTMLButtonElement>('gr-usage-page .tabs button')]
      .find((button) => button.textContent!.trim() === 'Tokens')!
      .click();
    await rendered.fixture.whenStable();
    const blocks = () => [
      ...rendered.el.querySelectorAll<HTMLButtonElement>('gr-usage-tool-map .block'),
    ];
    return { ...fake, ...rendered, blocks };
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
    expect(texts('gr-usage-page .split')).toContain('Context by tool');
    expect(texts('gr-usage-tool-map .block .name')).toEqual(['Read', 'Bash', 'Atlassian']);
    expect(texts('gr-usage-tool-map .block .figures')).toEqual([
      '182K · 40 uses',
      '61K · 112 uses',
      '15K · 5 uses',
    ]);
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
    const order = [...el.querySelectorAll('gr-usage-pie, gr-usage-tool-map, gr-usage-breakdown')];
    expect(order.map((node) => node.tagName.toLowerCase()).slice(0, 2)).toEqual([
      'gr-usage-pie',
      'gr-usage-tool-map',
    ]);
  });

  it('reads out the block under the pointer, and the whole without one', async () => {
    const { fixture, texts, blocks } = await showMap([
      { name: 'Read', uses: 40, context: 180_000 },
      { name: 'Grep', uses: 85, context: 12_000 },
    ]);
    const readout = () => texts('gr-usage-tool-map .readout')[0]!.replace(/\s+/g, ' ');
    expect(readout()).toBe(
      '192K tokens of context from 125 uses · pick a tool for its heaviest calls',
    );
    blocks()[0]!.dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();
    expect(readout()).toBe('Read 180K tokens of context · 40 uses · 4.5K a use');
    expect(blocks()[1]!.classList).toContain('dim');
  });

  it('lists the heaviest calls of the block picked, each opening its chat', async () => {
    const call = { agent: 'claude-code', tool: 'Read', at: now - 60_000 };
    const { fixture, texts, calls, blocks, el } = await showMap(
      [{ name: 'Read', uses: 40, context: 180_000 }],
      [
        {
          ...call,
          chatId: 'c1',
          title: 'Fix login',
          cwd: 'C:/work',
          target: 'C:\\work\\package-lock.json',
          context: 38_000,
        },
        { ...call, chatId: 'c2', title: '', target: 'npm test', context: 1_200 },
      ],
    );
    blocks()[0]!.click();
    await fixture.whenStable();
    const asked = calls.find((c) => c.command === 'search.toolCalls')!;
    expect((asked.request as CommandRequest<'search.toolCalls'>).tools).toEqual(['Read']);
    expect(texts('gr-usage-tool-map .calls .sub')).toEqual(['The heaviest calls of Read']);
    expect(texts('gr-usage-tool-map .calls .target')).toEqual(['package-lock.json', 'npm test']);
    expect(texts('gr-usage-tool-map .calls b')).toEqual(['38K', '1.2K']);
    expect(texts('gr-usage-tool-map .calls .chat')).toEqual(['Fix login', 'Untitled']);

    el.querySelector<HTMLButtonElement>('gr-usage-tool-map .calls .chat')!.click();
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'agents.open')!.request).toEqual({
      agent: 'claude-code',
      chatId: 'c1',
      settings: { cwd: 'C:/work' },
    });

    // Picked again, the list closes.
    blocks()[0]!.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-usage-tool-map .calls')).toBeNull();
  });

  it('says so when no tool could be measured', async () => {
    const { texts } = await showMap([{ name: 'Read', uses: 4, context: 0 }]);
    expect(texts('gr-usage-tool-map .none')).toEqual([
      'No tool’s context could be measured over this span.',
    ]);
  });

  it('puts the tools past the most drawn together as "Other"', () => {
    const tools = Array.from({ length: 14 }, (_, i) => ({
      name: `Tool${i}`,
      uses: 1,
      context: 1_000 * (14 - i),
    }));
    const blocks = blocksOf(tools);
    expect(blocks).toHaveLength(12);
    expect(blocks.at(-1)).toEqual({
      key: 'other',
      name: 'Other · 3 more',
      tools: ['Tool11', 'Tool12', 'Tool13'],
      uses: 3,
      context: 6_000,
    });
    // As heavy a use, each is as dark.
    expect(shadesOf(blocksOf([tools[0]!, { ...tools[1]!, context: 14_000 }]))).toEqual([100, 100]);
  });
});
