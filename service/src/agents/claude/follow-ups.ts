import type { FollowUp } from '@grimoire/contract';
import { z } from 'zod';
import type { ServerMaker } from './grimoire-tools';
import { isYourEntry } from './entries';
import { type ClaudeMessage, FOLLOW_UPS_TOOL } from './messages';

/**
 * The tool on Grimoire's own tool server (grimoire-tools.ts) that lets the
 * agent offer, now and then, a separate task as a card that opens a new
 * chat: its own name; Claude Code calls it FOLLOW_UPS_TOOL, after the server.
 */
export const FOLLOW_UPS_TOOL_NAME = 'suggest_follow_ups';

/** The most tasks offered after one reply. */
export const MAX_FOLLOW_UPS = 3;

/** What the agent is told of the tool, in its system prompt. */
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
          .describe(
            "The new chat's first message: the task, with what a fresh chat needs to know to do it",
          ),
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

/** The tool, its calls kept in `kept`; always loaded, never deferred behind tool search. */
export function followUpsTool(sdk: ServerMaker, kept: FollowUpsKept) {
  return sdk.tool(
    FOLLOW_UPS_TOOL_NAME,
    DESCRIPTION,
    INPUT,
    async ({ tasks }) => {
      kept.put(toFollowUps(tasks));
      return { content: [{ type: 'text', text: SHOWN }] };
    },
    { annotations: { readOnlyHint: true }, alwaysLoad: true },
  );
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
    for (const block of content as {
      type?: string;
      name?: string;
      input?: { tasks?: unknown };
    }[]) {
      if (block.type !== 'tool_use' || block.name !== FOLLOW_UPS_TOOL) continue;
      const followUps = toFollowUps(block.input?.tasks);
      found = followUps.length ? followUps : undefined;
    }
  }
  return found;
}
