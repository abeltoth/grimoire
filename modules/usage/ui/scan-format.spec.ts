import type { UsageSpan } from '@grimoire/contract';
import { tipCommand, tipReason } from './scan-format';

describe('scan formats', () => {
  const span: UsageSpan = {
    requests: 10,
    chats: 1,
    behaviours: [],
    advice: [],
    sources: [
      { kind: 'skill', name: 'commit', share: 15 },
      { kind: 'mcp', name: 'docs', share: 12 },
      { kind: 'skill', name: 'doctor', share: 3 },
    ],
  };
  const tip = (key: string, share: number) => ({ key, share, title: 'Do it' });

  it('says why a tip about a way of working is given, from its share', () => {
    expect(tipReason(tip('long_context', 61.4), span)).toBe(
      '61% of your usage was in requests past 150K tokens of context',
    );
    expect(tipReason(tip('brand_new', 20), span)).toBeUndefined();
  });

  it('names the source a tip is about: the one of its kind with its share, or the largest', () => {
    expect(tipReason(tip('skill', 15), span)).toBe('/commit took 15% of your usage');
    expect(tipReason(tip('skill', 11), span)).toBe('/commit took 11% of your usage');
    expect(tipReason(tip('mcp_server', 12), span)).toBe(
      'The docs MCP server took 12% of your usage',
    );
    expect(tipReason(tip('plugin', 10), span)).toBeUndefined();
  });

  it('finds the command a tip gives', () => {
    expect(tipCommand('run /clear')).toBe('/clear');
    expect(tipCommand('/effort high')).toBe('/effort high');
    expect(tipCommand('up to 4 at once')).toBeUndefined();
    expect(tipCommand(undefined)).toBeUndefined();
  });
});
