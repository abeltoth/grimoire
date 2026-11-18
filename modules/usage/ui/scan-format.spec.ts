import type { UsageSpan } from '@grimoire/contract';
import {
  behaviourCount,
  behaviourName,
  behaviourRule,
  counted,
  overlapping,
  sourceSlices,
  tipCommand,
} from './scan-format';

describe('scan formats', () => {
  it("names Claude Code's ways of working, keeping its own name for one it doesn't know", () => {
    expect(behaviourName('long_context')).toBe('Long context');
    expect(behaviourName('brand_new')).toBe('brand new');
    expect(behaviourRule('long_context')).toContain('150K');
    expect(behaviourRule('brand_new')).toBeUndefined();
  });

  it('counts whole chats for the ways of working the scan counts by chat', () => {
    expect(behaviourCount('long_context', 4002)).toBe('4,002 requests');
    expect(behaviourCount('cron', 1)).toBe('1 chat');
    expect(behaviourCount('subagent_heavy', 3)).toBe('3 chats');
    expect(counted(1, 'request', 'requests')).toBe('1 request');
  });

  it('splits the whole between the chat, its subagents and its skills, and keeps plugins and MCP servers apart', () => {
    const span: UsageSpan = {
      requests: 10,
      chats: 1,
      behaviours: [],
      advice: [],
      sources: [
        { kind: 'skill', name: 'commit', share: 15 },
        { kind: 'mcp', name: 'docs', share: 9 },
        { kind: 'agent', name: 'Explore', share: 5 },
        { kind: 'plugin', name: 'tools', share: 2 },
      ],
    };
    expect(sourceSlices(span)).toEqual([
      { name: 'Chat', value: 80 },
      { name: 'commit · skill', value: 15 },
      { name: 'Explore · subagent', value: 5 },
    ]);
    expect(overlapping(span).map((source) => source.name)).toEqual(['docs', 'tools']);
    // Shares rounded past the whole leave the chat none.
    expect(
      sourceSlices({ ...span, sources: [{ kind: 'skill', name: 'all', share: 101 }] })[0],
    ).toEqual({ name: 'Chat', value: 0 });
  });

  it('finds the command a tip gives', () => {
    expect(tipCommand('run /clear')).toBe('/clear');
    expect(tipCommand('/effort high')).toBe('/effort high');
    expect(tipCommand('up to 4 at once')).toBeUndefined();
    expect(tipCommand(undefined)).toBeUndefined();
  });
});
