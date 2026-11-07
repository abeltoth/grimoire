import { describe, expect, it } from 'vitest';
import { mcpOff, mcpSettings } from './mcp';

describe('mcpOff', () => {
  it("joins those off in every chat with the chat's own, each once, sorted", () => {
    expect(mcpOff(['slack', 'github'], { mcpOff: ['github', 'linear'] })).toEqual(['github', 'linear', 'slack']);
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
