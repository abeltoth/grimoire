import { statsLine, toolsInWords } from './stats-line';

describe('statsLine', () => {
  it('reads what the run took, as far as the agent said', () => {
    expect(
      statsLine({
        durationMs: 377_885,
        tokens: 165_941,
        toolUses: 41,
        lines: { added: 183, removed: 5 },
      }),
    ).toBe('6m 17s · 165.9K tokens · 41 tool calls · +183 −5');
    expect(statsLine({ toolUses: 1, lines: { added: 0, removed: 0 } })).toBe('1 tool call');
    expect(statsLine({})).toBe('');
  });

  it('names the kinds of tool calls it made, once it ended', () => {
    expect(toolsInWords({ tools: { read: 3, search: 1, shell: 32, edit: 0, other: 1 } })).toBe(
      '3 reads, 1 search, 32 shell commands, 1 other tool call',
    );
    expect(toolsInWords({ toolUses: 4 })).toBe('');
  });
});
