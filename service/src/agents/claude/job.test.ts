import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import type { JobRequest } from '../adapter';
import { type StartQuery, runJob } from './job';

const request: JobRequest = { cwd: '/work', text: '/doctor', mode: 'plan' };

/** A stand-in for Claude Code that sends these messages and keeps what it was started with. */
function claude(messages: object[]) {
  const started: { request: JobRequest; abort: AbortController }[] = [];
  const start: StartQuery = async (request, abort) => {
    started.push({ request, abort });
    return (async function* () {
      for (const message of messages) yield message as SDKMessage;
    })();
  };
  return { start, started };
}

const init = { type: 'system', subtype: 'init', claude_code_version: '2.1.319' };
const reply = (id: string, output: number) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: {
    id,
    model: 'claude-sonnet-5-5',
    role: 'assistant',
    content: [{ type: 'text', text: 'Looking' }],
    usage: { input_tokens: 10, output_tokens: output, cache_read_input_tokens: 100 },
  },
});

describe('runJob', () => {
  it('gives the last answer, what it spent and the version that ran it', async () => {
    const { start, started } = claude([
      init,
      reply('m1', 5),
      reply('m2', 7),
      { type: 'result', subtype: 'success', is_error: false, result: 'All healthy' },
    ]);
    const seen: number[] = [];
    const result = await runJob(
      request,
      (uses) => seen.push(uses.reduce((sum, use) => sum + use.output, 0)),
      new AbortController().signal,
      start,
    );
    expect(started[0]!.request).toEqual(request);
    expect(seen).toEqual([5, 12]);
    expect(result).toEqual({
      text: 'All healthy',
      agentVersion: '2.1.319',
      tokens: [
        expect.objectContaining({
          model: 'claude-sonnet-5-5',
          input: 20,
          cacheRead: 200,
          output: 12,
        }),
      ],
    });
  });

  it('says why a run failed', async () => {
    const { start } = claude([
      init,
      { type: 'result', subtype: 'error_max_turns', is_error: true },
    ]);
    const result = await runJob(request, () => {}, new AbortController().signal, start);
    expect(result).toMatchObject({ text: '', error: 'error_max_turns' });
  });

  it('stops Claude Code and rejects once aborted', async () => {
    const { start, started } = claude([init, reply('m1', 5)]);
    const abort = new AbortController();
    abort.abort();
    await expect(runJob(request, () => {}, abort.signal, start)).rejects.toThrow('Stopped');
    expect(started[0]!.abort.signal.aborted).toBe(true);
  });
});
