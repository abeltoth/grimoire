import { describe, expect, it } from 'vitest';
import {
  FOLLOW_UPS_PROMPT,
  FOLLOW_UPS_SERVER,
  FOLLOW_UPS_TOOL_NAME,
  FollowUpsKept,
  type ServerMaker,
  followUpOptions,
  savedFollowUps,
  toFollowUps,
} from './follow-ups';
import { type ClaudeMessage, ClaudeTranscript, FOLLOW_UPS_TOOL } from './transcript';

const docs = { title: 'Docs', prompt: 'Write the docs' };

/** The SDK's server maker, keeping the tool it's given. */
function maker() {
  const made: { name?: string; description?: string; handler?: (args: { tasks: unknown[] }) => Promise<unknown> } = {};
  const sdk = {
    tool: (name: string, description: string, _input: unknown, handler: typeof made.handler) => {
      Object.assign(made, { name, description, handler });
      return { name };
    },
    createSdkMcpServer: (options: { name: string }) => ({ type: 'sdk', name: options.name }),
  } as unknown as ServerMaker;
  return { sdk, made };
}

const call = (id: string, tasks: unknown, parent: string | null = null): ClaudeMessage => ({
  type: 'assistant',
  parent_tool_use_id: parent,
  message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name: FOLLOW_UPS_TOOL, input: { tasks } }] },
});
const yours = (text: string): ClaudeMessage => ({
  type: 'user',
  uuid: text,
  parent_tool_use_id: null,
  message: { content: text },
});
const result = (id: string): ClaudeMessage => ({
  type: 'user',
  parent_tool_use_id: null,
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'Shown to the user as cards under your reply.' }] },
});

describe('the follow-ups tool', () => {
  it('is named as Claude Code calls it, after its server', () => {
    expect(FOLLOW_UPS_TOOL).toBe(`mcp__${FOLLOW_UPS_SERVER}__${FOLLOW_UPS_TOOL_NAME}`);
  });

  it('tells the agent to use it rarely, for separate work only', () => {
    expect(FOLLOW_UPS_PROMPT).toContain('Call it rarely');
    expect(FOLLOW_UPS_PROMPT).toContain('clearly separate, substantial piece of work');
    expect(FOLLOW_UPS_PROMPT).toContain('Never for the next step of the current task');
    expect(FOLLOW_UPS_PROMPT).toContain('Most turns get none');
    const { sdk, made } = maker();
    followUpOptions(sdk, new FollowUpsKept());
    expect(made.description).toContain('Use it rarely');
  });

  it('is allowed without asking, and its calls kept until the turn ends, answered shortly', async () => {
    const { sdk, made } = maker();
    const kept = new FollowUpsKept();
    const options = followUpOptions(sdk, kept);
    expect(options.allowedTools).toEqual([FOLLOW_UPS_TOOL]);
    expect(Object.keys(options.mcpServers!)).toEqual([FOLLOW_UPS_SERVER]);
    expect(options.systemPrompt).toBe(FOLLOW_UPS_PROMPT);

    await expect(made.handler!({ tasks: [{ title: ' Docs ', prompt: ' Write the docs\n' }] })).resolves.toEqual({
      content: [{ type: 'text', text: 'Shown to the user as cards under your reply.' }],
    });
    expect(kept.take()).toEqual([docs]);
    expect(kept.take()).toBeUndefined();
  });

  it('keeps three cards at most, trimmed, leaving out those without a title or prompt', () => {
    const many = ['a', 'b', 'c', 'd'].map((n) => ({ title: n, prompt: `Do ${n}` }));
    expect(toFollowUps(many).map((card) => card.title)).toEqual(['a', 'b', 'c']);
    expect(toFollowUps([{ title: '  ', prompt: 'x' }, { title: 'y' }, null, docs])).toEqual([docs]);
    expect(toFollowUps('nonsense')).toEqual([]);
  });
});

describe('a call of the follow-ups tool in the transcript', () => {
  it('has no row, live or saved', () => {
    for (const live of [true, false]) {
      const transcript = new ClaudeTranscript(live);
      transcript.apply({
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          id: 'm1',
          content: [
            { type: 'text', text: 'Done.' },
            { type: 'tool_use', id: 't1', name: FOLLOW_UPS_TOOL, input: { tasks: [docs] } },
          ],
        },
      });
      transcript.apply(result('t1'));
      expect(transcript.entries).toEqual([{ kind: 'agent', id: 'm1', blocks: [{ kind: 'text', text: 'Done.' }] }]);
    }
  });
});

describe('savedFollowUps', () => {
  it("rebuilds the cards from the last turn's call", () => {
    const release = { title: 'Release', prompt: 'Cut a release' };
    expect(savedFollowUps([yours('Hi'), call('t1', [docs]), result('t1'), call('t2', [release]), result('t2')])).toEqual([
      release,
    ]);
  });

  it('has none once you wrote again, nor from a helper or an empty call', () => {
    expect(savedFollowUps([yours('Hi'), call('t1', [docs]), result('t1'), yours('More')])).toBeUndefined();
    expect(savedFollowUps([yours('Hi'), call('t1', [docs], 'agent-1')])).toBeUndefined();
    expect(savedFollowUps([yours('Hi'), call('t1', [docs]), call('t2', [])])).toBeUndefined();
    expect(savedFollowUps([])).toBeUndefined();
  });
});
