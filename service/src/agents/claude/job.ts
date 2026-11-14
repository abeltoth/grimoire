import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { TokenUse } from '@grimoire/contract';
import type { JobRequest, JobResult } from '../adapter';
import { MODES } from './drive';
import type { ClaudeMessage } from './messages';
import { claudeEnv, sdk } from './probe';
import { ClaudeTranscript } from './transcript';

/** Starts a Claude Code run; the SDK's own `query`, or a stand-in in tests. */
export type StartQuery = (
  request: JobRequest,
  abortController: AbortController,
) => Promise<AsyncIterable<SDKMessage>>;

/** Claude Code in the folder, with your setup, its session not saved, so it stays out of the History. */
const startQuery: StartQuery = async (request, abortController) => {
  const { query } = await sdk();
  return query({
    prompt: request.text,
    options: {
      cwd: request.cwd,
      ...(request.model ? { model: request.model } : {}),
      ...(request.effort ? { effort: request.effort } : {}),
      permissionMode: MODES[request.mode],
      persistSession: false,
      env: claudeEnv(),
      abortController,
    },
  });
};

/**
 * Runs one message through Claude Code unseen and gives its last answer,
 * what it spent and the version that ran it. A slash command, such as
 * /doctor, runs as it would in a chat. Rejects once `signal` aborts.
 */
export async function runJob(
  request: JobRequest,
  progress: (uses: TokenUse[]) => void,
  signal: AbortSignal,
  start: StartQuery = startQuery,
): Promise<JobResult> {
  const abortController = new AbortController();
  if (signal.aborted) abortController.abort();
  signal.addEventListener('abort', () => abortController.abort(), { once: true });
  let tokens: TokenUse[] = [];
  const transcript = new ClaudeTranscript(true, {
    entry: () => {},
    text: () => {},
    status: () => {},
    plan: () => {},
    tokens: (uses) => {
      tokens = uses;
      progress(uses);
    },
  });
  let agentVersion: string | undefined;
  for await (const message of await start(request, abortController)) {
    if (signal.aborted) throw new Error('Stopped');
    if (message.type === 'system' && message.subtype === 'init')
      agentVersion = message.claude_code_version;
    if (message.type === 'result') {
      const version = agentVersion ? { agentVersion } : {};
      if (message.subtype === 'success') return { text: message.result, tokens, ...version };
      return { text: '', tokens, ...version, error: message.subtype };
    }
    transcript.apply(message as ClaudeMessage);
  }
  if (signal.aborted) throw new Error('Stopped');
  return { text: '', tokens, ...(agentVersion ? { agentVersion } : {}), error: 'no answer' };
}
