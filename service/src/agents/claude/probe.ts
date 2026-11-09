import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { MessageQueue } from './message-queue';

// Loaded on first use: it's large, and the service starts without it.
export const sdk = () => import('@anthropic-ai/claude-agent-sdk');

// Claude Code keeps its plan with its task tools only when asked to; the Plan shows it.
// Read at each start, as switching profiles changes which Claude folder it uses.
export const claudeEnv = () => ({ ...process.env, CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' });

/**
 * Asks a Claude Code process that never gets a message, then stops it; in
 * a folder, it runs there with the environment a chat's process gets.
 */
export async function probe<T>(ask: (process: Query) => Promise<T>, cwd?: string): Promise<T> {
  const { query } = await sdk();
  const input = new MessageQueue<SDKUserMessage>();
  const options = cwd ? { cwd, permissionMode: 'default' as const, env: claudeEnv() } : { permissionMode: 'default' as const };
  const process = query({ prompt: input, options });
  try {
    return await ask(process);
  } finally {
    input.end();
    process.close();
  }
}
