import type { Options, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { FollowUp } from '@grimoire/contract';
import { z } from 'zod';
import { type ClaudeMessage, FOLLOW_UPS_TOOL, isYourEntry } from './transcript';

/**
 * Grimoire's own tool server, in the service's process: the one exception
 * to Grimoire never talking to MCP servers (ADR-011). Its one tool lets
 * the agent offer, now and then, a separate task as a card that opens a
 * new chat.
 */
export const FOLLOW_UPS_SERVER = 'grimoire';

/** Its tool's own name; Claude Code calls it FOLLOW_UPS_TOOL, after the server. */
export const FOLLOW_UPS_TOOL_NAME = 'suggest_follow_ups';

/** The most tasks offered after one reply. */
export const MAX_FOLLOW_UPS = 3;

/**
 * What the agent is told of the tool. Without it, the SDK gives Claude
 * Code an empty system prompt, its tools' own words aside; this is the
 * whole of it, so nothing else the agent is told changes.
 */
export const FOLLOW_UPS_PROMPT =
  'Grimoire, the app this chat is in, gives you the tool suggest_follow_ups. Call it rarely: only when ' +
  'a clearly separate, substantial piece of work has come up that the user would plausibly want in its ' +
  'own chat. Never for the next step of the current task, small fixes, routine turns, or just because ' +
  'something could be done. Most turns get none, and one task is usually enough. The user sees them as ' +
  'cards under your reply, so there is no need to repeat them.';

const DESCRIPTION =
  'Offer the user up to 3 separate tasks as cards under your reply; clicking one opens a new chat with ' +
  'its prompt written in, not sent. Use it rarely: only for a clearly separate, substantial piece of work ' +
  'the user would plausibly want in its own chat, never for the next step of the current task, small ' +
  'fixes or routine turns. Most turns get none; one task is usually enough.';

/** What the agent hears back. */
const SHOWN = 'Shown to the user as cards under your reply.';

const INPUT = {
  tasks: z
    .array(
      z.object({
        title: z.string().describe('A few words naming the task'),
        prompt: z
          .string()
          .describe("The new chat's first message: the task, with what a fresh chat needs to know to do it"),
      }),
    )
    .min(1)
    .max(MAX_FOLLOW_UPS),
};

/** Where a process's tool keeps the tasks it was given, until its turn ends. */
export class FollowUpsKept {
  private kept: FollowUp[] | undefined;

  /** The tasks given in the turn, the last call's; then none, for the next turn. */
  take(): FollowUp[] | undefined {
    const kept = this.kept;
    this.kept = undefined;
    return kept;
  }

  put(followUps: FollowUp[]): void {
    this.kept = followUps;
  }
}

/** The parts of the Agent SDK the server is made with, loaded when a process starts. */
export interface ServerMaker {
  createSdkMcpServer: typeof createSdkMcpServer;
  tool: typeof tool;
}

/**
 * The options that give a Claude Code process the tool, and tell the agent
 * of it, its calls kept in `kept`. The tool is allowed without asking, and
 * always loaded, never deferred behind tool search.
 */
export function followUpOptions(
  sdk: ServerMaker,
  kept: FollowUpsKept,
): Pick<Options, 'mcpServers' | 'allowedTools' | 'systemPrompt'> {
  const suggest = sdk.tool(
    FOLLOW_UPS_TOOL_NAME,
    DESCRIPTION,
    INPUT,
    async ({ tasks }) => {
      kept.put(toFollowUps(tasks));
      return { content: [{ type: 'text', text: SHOWN }] };
    },
    { annotations: { readOnlyHint: true }, alwaysLoad: true },
  );
  return {
    mcpServers: {
      [FOLLOW_UPS_SERVER]: sdk.createSdkMcpServer({ name: FOLLOW_UPS_SERVER, tools: [suggest], alwaysLoad: true }),
    },
    allowedTools: [FOLLOW_UPS_TOOL],
    systemPrompt: FOLLOW_UPS_PROMPT,
  };
}

/** The tasks as cards: each trimmed, those without a title or prompt left out, at most three. */
export function toFollowUps(tasks: unknown): FollowUp[] {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .flatMap((task: { title?: unknown; prompt?: unknown } | null): FollowUp[] => {
      const title = typeof task?.title === 'string' ? task.title.trim() : '';
      const prompt = typeof task?.prompt === 'string' ? task.prompt.trim() : '';
      return title && prompt ? [{ title, prompt }] : [];
    })
    .slice(0, MAX_FOLLOW_UPS);
}

/**
 * The tasks offered in a saved chat's last turn, from its last call of the
 * tool since your last entry; undefined when there are none.
 */
export function savedFollowUps(messages: readonly ClaudeMessage[]): FollowUp[] | undefined {
  let found: FollowUp[] | undefined;
  for (const message of messages) {
    if (isYourEntry(message)) found = undefined;
    if (message.type !== 'assistant' || message.parent_tool_use_id) continue;
    const content = (message.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as { type?: string; name?: string; input?: { tasks?: unknown } }[]) {
      if (block.type !== 'tool_use' || block.name !== FOLLOW_UPS_TOOL) continue;
      const followUps = toFollowUps(block.input?.tasks);
      found = followUps.length ? followUps : undefined;
    }
  }
  return found;
}
