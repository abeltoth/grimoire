import { describe, expect, it } from 'vitest';
import type { TokenSource } from '@grimoire/contract';
import { type Spent, byModel, sourceOf, tokenUse } from './reply-tokens';

const usage = { input_tokens: 10, output_tokens: 2 };

describe('reply tokens', () => {
  it('credits a reply to its subagent, or outside one to its skill', () => {
    expect(sourceOf({ type: 'assistant', attributionSkill: 'commit' })).toEqual({
      kind: 'skill',
      name: 'commit',
    });
    expect(
      sourceOf({ type: 'assistant', attributionAgent: 'Explore', attributionSkill: 'commit' }),
    ).toEqual({ kind: 'subagent', name: 'Explore' });
    expect(sourceOf({ type: 'assistant' })).toBeUndefined();
  });

  it('counts a reply’s tokens with what it ran under, and none for Claude Code’s own notes', () => {
    const source = { kind: 'skill', name: 'commit' } as const;
    expect(tokenUse({ model: 'claude-opus-5-5', usage }, false, source)).toMatchObject({
      model: 'claude-opus-5-5',
      source,
      input: 10,
      output: 2,
    });
    expect(tokenUse({ model: '<synthetic>', usage }, false, undefined)).toBeUndefined();
  });

  it('adds up a turn by model, the chat’s own apart from its subagents’ and each skill’s', () => {
    const commit: TokenSource = { kind: 'skill', name: 'commit' };
    const replies: [string, TokenSource | undefined][] = [
      ['msg_1', undefined],
      ['msg_2', commit],
      ['msg_3', commit],
      ['msg_4', undefined],
    ];
    const spent: Spent = new Map(
      replies.map(([id, source]) => [
        id,
        tokenUse({ model: 'claude-opus-5-5', usage }, false, source)!,
      ]),
    );
    expect(byModel(spent).map(({ source, input }) => [source?.name, input])).toEqual([
      [undefined, 20],
      ['commit', 20],
    ]);
  });
});
