import { describe, expect, it } from 'vitest';
import type { ChatSummary } from '@grimoire/contract';
import { suggestTags } from './suggest';

const summary = (id: string, updatedAt: number): ChatSummary => ({
  id,
  agent: 'claude-code',
  title: `Chat ${id}`,
  updatedAt,
});

describe('suggestTags', () => {
  it('suggests tags from the titles of the chats, newest first', async () => {
    const asked: string[] = [];
    const tags = await suggestTags({
      agents: () => [
        { id: 'claude-code', capabilities: ['ask'] },
        { id: 'mute', capabilities: [] },
      ],
      listChats: async (agent) =>
        agent === 'claude-code' ? [summary('a', 1), summary('b', 3), summary('c', 2)] : [],
      ask: async (_agent, _instructions, text) => {
        asked.push(text);
        return '["Bug", "ui"]';
      },
    });
    expect(tags).toEqual(['bug', 'ui']);
    expect(asked).toEqual(['Chat b\nChat c\nChat a']);
  });

  it('suggests nothing when no agent answers prompts', async () => {
    expect(
      await suggestTags({
        agents: () => [{ id: 'mute', capabilities: [] }],
        listChats: async () => [],
        ask: async () => '["bug"]',
      }),
    ).toEqual([]);
  });
});
