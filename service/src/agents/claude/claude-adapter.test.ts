import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeAdapter } from './claude-adapter';
import { toAgentModels } from './models';

/** What the fake Claude Code processes answer, and what was asked of them. */
const claude = {
  models: [] as ModelInfo[],
  commands: [] as { name: string; description: string; argumentHint?: string }[],
  skills: [] as string[],
  failNext: false,
  asked: [] as { cwd?: string; ask: string }[],
  closed: 0,
};

vi.mock('./probe', async (original) => ({
  ...(await original<typeof import('./probe')>()),
  sdk: async () => ({
    query: ({ options }: { options: { cwd?: string } }) => {
      const ask = (what: string, answer: () => unknown) => async () => {
        claude.asked.push({ ...(options.cwd ? { cwd: options.cwd } : {}), ask: what });
        if (claude.failNext) {
          claude.failNext = false;
          throw new Error('Claude Code is not signed in');
        }
        return answer();
      };
      return {
        supportedModels: ask('models', () => claude.models),
        supportedCommands: ask('commands', () => claude.commands),
        reloadSkills: async () => ({ skills: claude.skills.map((name) => ({ name })) }),
        close: () => claude.closed++,
      };
    },
  }),
}));

// Your own Claude Code settings stay out of the test.
vi.mock('./effort', async (original) => ({
  ...(await original<typeof import('./effort')>()),
  readUserSettings: () => ({}),
}));

const opus = {
  value: 'opus',
  displayName: 'Opus',
  description: 'Most capable',
  resolvedModel: 'claude-opus-5-5',
} as ModelInfo;

beforeEach(() => {
  Object.assign(claude, { models: [opus], commands: [], skills: [], failNext: false });
  claude.asked = [];
  claude.closed = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ClaudeAdapter', () => {
  it('asks Claude Code for its models once, and again after it failed to say', async () => {
    const adapter = new ClaudeAdapter();
    claude.failNext = true;
    await expect(adapter.models()).rejects.toThrow('not signed in');
    const expected = toAgentModels([opus], {});
    expect(await adapter.models()).toEqual(expected);
    expect(await adapter.models()).toEqual(expected);
    expect(claude.asked).toEqual([{ ask: 'models' }, { ask: 'models' }]);
    expect(claude.closed).toBe(2);
  });

  it('lists a folder’s commands and skills, without its plumbing or a name twice', async () => {
    claude.commands = [
      { name: 'review', description: 'Review the diff', argumentHint: '[pr]' },
      { name: '__internal', description: '' },
      { name: 'commit', description: 'Commit' },
      { name: 'review', description: 'Another review' },
    ];
    claude.skills = ['commit'];
    expect(await new ClaudeAdapter().commands('/work')).toEqual([
      { name: 'review', description: 'Review the diff', argumentHint: '[pr]', kind: 'command' },
      { name: 'commit', description: 'Commit', kind: 'skill' },
    ]);
    expect(claude.asked).toEqual([{ cwd: '/work', ask: 'commands' }]);
  });

  it('keeps a folder’s commands for a minute, and forgets them on a reset', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    const adapter = new ClaudeAdapter();
    await adapter.commands('/work');
    vi.setSystemTime(59_000);
    await adapter.commands('/work');
    await adapter.commands('/other');
    expect(claude.asked).toHaveLength(2);

    vi.setSystemTime(61_000);
    await adapter.commands('/work');
    adapter.reset();
    await adapter.commands('/other');
    await adapter.models();
    await adapter.models();
    expect(claude.asked.map(({ cwd, ask }) => `${ask} ${cwd ?? ''}`.trim())).toEqual([
      'commands /work',
      'commands /other',
      'commands /work',
      'commands /other',
      'models',
    ]);
  });

  it('asks again for a folder’s commands after Claude Code failed to say', async () => {
    const adapter = new ClaudeAdapter();
    claude.failNext = true;
    await expect(adapter.commands('/work')).rejects.toThrow();
    expect(await adapter.commands('/work')).toEqual([]);
    expect(claude.asked).toHaveLength(2);
  });
});
