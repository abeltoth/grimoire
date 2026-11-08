import { describe, expect, it } from 'vitest';
import { toolName } from './connectors';

describe('toolName', () => {
  it('calls a connector’s tool as Claude Code names it, after its server', () => {
    expect(toolName('claude.ai Atlassian', 'getJiraIssue')).toBe('mcp__claude_ai_Atlassian__getJiraIssue');
    expect(toolName('claude.ai Claude Docs', 'guide')).toBe('mcp__claude_ai_Claude_Docs__guide');
    expect(toolName('my-server_2', 'x')).toBe('mcp__my-server_2__x');
  });
});
