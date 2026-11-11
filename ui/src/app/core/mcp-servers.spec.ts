import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AgentSetup, CommandRequest, SetupItem } from '@grimoire/contract';
import { useFakeBridge } from '../../testing/app-testing';
import { McpServers } from './mcp-servers';

const server = (name: string): SetupItem => ({ name, source: 'user' });

function withServers(servers: Record<string, SetupItem[]>) {
  const fake = useFakeBridge();
  fake.answers['setup.get'] = ({ cwd }: CommandRequest<'setup.get'>) =>
    ({ sections: { mcpServers: servers[cwd ?? ''] ?? [] } }) as unknown as AgentSetup;
  const mcp = TestBed.inject(McpServers);
  const stable = () => TestBed.inject(ApplicationRef).whenStable();
  return { ...fake, mcp, stable };
}

describe('McpServers', () => {
  it('reads a folder’s servers once, whatever its slashes or case', async () => {
    const { mcp, calls, stable } = withServers({ 'C:/Work': [server('jira')] });
    expect(mcp.of('claude-code', 'C:/Work')).toBeUndefined();
    mcp.load('claude-code', 'C:/Work');
    await stable();
    mcp.load('claude-code', 'c:\\work\\');
    expect(mcp.of('claude-code', 'c:\\work\\')).toEqual([server('jira')]);
    expect(calls.filter((c) => c.command === 'setup.get').map((c) => c.request)).toEqual([
      { agent: 'claude-code', cwd: 'C:/Work' },
    ]);
  });

  it('reads them again when the folder’s setup changes, and not another’s', async () => {
    const servers = { '': [server('jira')] };
    const { mcp, emit, calls, stable } = withServers(servers);
    mcp.load('claude-code', undefined);
    await stable();
    servers[''] = [server('jira'), server('git')];
    emit('setup.changed', { agent: 'claude-code', cwd: 'C:/other' });
    emit('setup.changed', { agent: 'claude-code', cwd: '' });
    await stable();
    expect(mcp.of('claude-code', undefined)).toEqual([server('jira'), server('git')]);
    expect(calls.filter((c) => c.command === 'setup.get')).toHaveLength(2);
  });

  it('lists none when the setup can’t be read', async () => {
    const { mcp, answers, stable } = withServers({});
    answers['setup.get'] = () => Promise.reject(new Error('gone'));
    mcp.load('claude-code', 'C:/Work');
    await stable();
    expect(mcp.of('claude-code', 'C:/Work')).toEqual([]);
  });
});
