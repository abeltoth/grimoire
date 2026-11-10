import type { Entry, SubagentState, ToolResult } from '@grimoire/contract';
import { type ApiMessage, type ClaudeMessage, toolResult } from './messages';

/** The tool a subagent ends its run with, its report to the agent that asked in its input's `message`. */
export const HANDBACK_TOOL = 'SubagentHandback';

/** The tool an agent sends a subagent another message with, which resumes its run. */
export const SEND_TOOL = 'SendMessage';

/**
 * The ID Claude Code keeps a subagent's saved run by, from the result of the
 * tool call that started it; undefined when it names none. Older results
 * end on "agentId: …"; newer ones say the run's report comes "as a message
 * from" it; a message sent to a subagent resumes it, and its result names it
 * as "resumedAgentId".
 */
export function subagentAgentId(result: string): string | undefined {
  return (/^agentId: ([\w-]+)/m.exec(result) ??
    /message from "([\w-]+)"/.exec(result) ??
    /"resumedAgentId":\s*"([\w-]+)"/.exec(result))?.[1];
}

/** A tool call that handed a subagent a task, or sent one a message: what it gave, and its result. */
export interface SubagentCall {
  prompt?: string;
  /** Whom a message was sent to, when the call sent one. */
  sentTo?: string;
  result?: ToolResult;
}

/**
 * The tool call `toolId` among the messages: the task it handed a subagent,
 * or whom it sent a message, and its result once it has one. Undefined when
 * it isn't among them.
 */
export function subagentCallIn(
  messages: readonly ClaudeMessage[],
  toolId: string,
): SubagentCall | undefined {
  let call: SubagentCall | undefined;
  for (const message of messages) {
    const content = (message.message as ApiMessage | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (message.type === 'assistant' && block.type === 'tool_use' && block.id === toolId) {
        const { prompt, to } = (block.input ?? {}) as { prompt?: unknown; to?: unknown };
        call = {
          ...call,
          ...(typeof prompt === 'string' ? { prompt } : {}),
          ...(block.name === SEND_TOOL && typeof to === 'string' ? { sentTo: to } : {}),
        };
      } else if (
        message.type === 'user' &&
        block.type === 'tool_result' &&
        block.tool_use_id === toolId
      ) {
        call = { ...call, result: toolResult(block) };
      }
    }
  }
  return call;
}

/** Whether a saved subagent's run began with the task `prompt`: its first message is the task it was given. */
export function runBeganWith(messages: readonly ClaudeMessage[], prompt: string): boolean {
  const first = messages.find((message) => message.type === 'user');
  const content = (first?.message as ApiMessage | undefined)?.content;
  const text =
    typeof content === 'string'
      ? content
      : (content ?? [])
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join('\n');
  return !!text && text.trim() === prompt.trim();
}

/**
 * Where a saved subagent is with its task: done once it handed its report
 * back, else as the result of the tool call that started it says.
 */
export function savedSubagentState(
  entries: readonly Entry[],
  result: ToolResult | undefined,
): SubagentState {
  const handedBack = entries.some(
    (entry) =>
      entry.kind === 'agent' &&
      entry.blocks.some((b) => b.kind === 'tool' && b.tool === HANDBACK_TOOL),
  );
  if (handedBack) return 'done';
  if (!result) return 'stopped';
  return result.isError ? 'failed' : 'done';
}
