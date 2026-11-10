import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fork, generatedTitle, history, listChats, rename, subagent, title } from './saved-chats';

/** What Claude Code saved, by folder; `undefined` for a chat saved in another folder. */
const saved = vi.hoisted(() => ({
  info: undefined as { customTitle?: string; summary?: string } | undefined,
  calls: [] as unknown[][],
  messages: [] as object[],
}));
vi.mock('./probe', async (original) => ({
  ...(await original<typeof import('./probe')>()),
  sdk: async () => ({
    listSessions: async () => [
      { sessionId: 'old', summary: 'Old', lastModified: 1 },
      { sessionId: 'new', summary: 'New', customTitle: 'Newest', cwd: 'C:/work', lastModified: 2 },
    ],
    getSessionInfo: async (_id: string, options?: { dir?: string }) =>
      options?.dir ? saved.info : { summary: 'anywhere' },
    getSessionMessages: async () => saved.messages,
    listSubagents: async () => [],
    getSubagentMessages: async () => [],
    renameSession: async (...args: unknown[]) => saved.calls.push(['rename', ...args]),
    forkSession: async (...args: unknown[]) => {
      saved.calls.push(['fork', ...args]);
      return { sessionId: 'copy' };
    },
  }),
}));

beforeEach(() => {
  saved.info = undefined;
  saved.calls = [];
  saved.messages = [];
});

describe('saved chats', () => {
  it('lists the chats, most recent first, by the title given or else the summary', async () => {
    expect(await listChats('claude-code')).toEqual([
      { id: 'new', agent: 'claude-code', title: 'Newest', cwd: 'C:/work', updatedAt: 2 },
      { id: 'old', agent: 'claude-code', title: 'Old', updatedAt: 1 },
    ]);
  });

  it("gives a chat's title, and the generated one only once it has one", async () => {
    saved.info = { summary: 'Fix the meter' };
    expect(await title('c1', 'C:/work')).toBe('Fix the meter');
    expect(await generatedTitle('c1', 'C:/work')).toBeUndefined();
    saved.info = { summary: 'Fix the meter', customTitle: 'Meter' };
    expect(await title('c1', 'C:/work')).toBe('Meter');
    expect(await generatedTitle('c1', 'C:/work')).toBe('Meter');
  });

  it('looks in its folder for a chat saved there, and in every folder for one that is not', async () => {
    saved.info = { summary: 'here' };
    await rename('c1', 'C:/work', 'Meter');
    saved.info = undefined;
    await rename('c1', 'C:/elsewhere', 'Meter');
    expect(saved.calls).toEqual([
      ['rename', 'c1', 'Meter', { dir: 'C:/work' }],
      ['rename', 'c1', 'Meter', {}],
    ]);
  });

  it('copies a chat under its new title, up to the end of the turn your message began', async () => {
    saved.info = { summary: 'here' };
    const yours = (uuid: string) => ({ type: 'user', uuid, message: { content: 'Hi' } });
    saved.messages = [yours('u1'), { type: 'assistant', uuid: 'a1' }, yours('u2')];
    expect(await fork('c1', 'C:/work', 'u1', 'Meter (2)')).toBe('copy');
    await fork('c1', 'C:/work', 'u2', 'Meter (3)');
    expect(saved.calls).toEqual([
      ['fork', 'c1', { dir: 'C:/work', title: 'Meter (2)', upToMessageId: 'a1' }],
      ['fork', 'c1', { dir: 'C:/work', title: 'Meter (3)' }],
    ]);
    await expect(fork('c1', 'C:/work', 'u9', 'Meter (4)')).rejects.toThrow('not in the chat');
  });

  it('shows an empty chat, and no run for a subagent it never started', async () => {
    expect(await history('c1', 'C:/work')).toEqual({ entries: [], plan: [] });
    expect(await subagent('c1', 'C:/work', 't1')).toEqual({ entries: [] });
  });
});
