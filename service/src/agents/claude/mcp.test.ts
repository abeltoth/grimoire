import { describe, expect, it } from 'vitest';
import { mcpOff, mcpSettings, mcpStates } from './mcp';

describe('mcpOff', () => {
  it("joins those off in every chat with the chat's own, each once, sorted", () => {
    expect(mcpOff(['slack', 'github'], { mcpOff: ['github', 'linear'] })).toEqual([
      'github',
      'linear',
      'slack',
    ]);
    expect(mcpOff([], {})).toEqual([]);
    expect(mcpOff(['github'])).toEqual(['github']);
  });
});

describe('mcpSettings', () => {
  it('denies the servers by name, and sets nothing when none are off', () => {
    expect(mcpSettings(['github', 'claude.ai Gmail'])).toEqual({
      deniedMcpServers: [{ serverName: 'github' }, { serverName: 'claude.ai Gmail' }],
    });
    expect(mcpSettings([])).toEqual({});
  });
});

describe('mcpStates', () => {
  it('says how each server is, with its tools counted, leaving out Grimoire’s own', () => {
    expect(
      mcpStates([
        {
          name: 'github',
          status: 'connected',
          source: 'user',
          tools: [{ name: 'issues' }, { name: 'pulls' }],
        },
        { name: 'linear', status: 'failed', error: 'Connection closed' },
        { name: 'grimoire', status: 'connected', source: 'sdk', tools: [{ name: 'note' }] },
      ]),
    ).toEqual([
      { name: 'github', status: 'connected', tools: 2 },
      { name: 'linear', status: 'failed', error: 'Connection closed', tools: 0 },
    ]);
  });
});
