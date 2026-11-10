import type { Block, ToolResult } from '@grimoire/contract';
import type { ReplyUsage } from './cache';

/** The parts of Claude Code's messages the transcript reads; live and saved messages share them. */
export interface ClaudeMessage {
  type: string;
  uuid?: string;
  parent_tool_use_id?: string | null;
  message?: unknown;
  event?: unknown;
  /** A note Claude Code added to a run, rather than what someone wrote. */
  is_meta?: boolean;
  /** Who sent a message into a run: the agent that asked a subagent is its "coordinator". */
  origin?: { kind?: string };
}

export interface ApiMessage {
  id?: string;
  model?: string;
  usage?: ReplyUsage;
  content?: string | ApiBlock[];
}

export interface ApiBlock {
  /** An image block's picture. */
  source?: { type: string; media_type?: string; data?: string };
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | ApiBlock[];
  is_error?: boolean;
}

export interface StreamEvent {
  type: string;
  index?: number;
  message?: ApiMessage;
  content_block?: ApiBlock;
  delta?: { type: string; text?: string; thinking?: string };
}

/** Claude Code's word on a task it runs, such as a subagent: that it began, or how it ended. */
export interface TaskMessage {
  subtype?: string;
  tool_use_id?: string;
  status?: string;
}

/**
 * Claude Code's word on a hook it runs: that it began, what it printed so
 * far, or how it ended. It says so only for the hooks it runs itself, such
 * as commands, never for an SDK callback, so Grimoire's own don't show.
 */
export interface HookMessage {
  subtype?: string;
  hook_id?: string;
  /** Such as "PostToolUse:Edit": the event, and on a tool's events the tool. */
  hook_name?: string;
  hook_event?: string;
  output?: string;
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  outcome?: string;
}

/**
 * The tool Grimoire gives the agent to offer separate tasks with
 * (follow-ups.ts): they show as cards under the reply, so its call has no row.
 */
export const FOLLOW_UPS_TOOL = 'mcp__grimoire__suggest_follow_ups';

/** The tool Claude Code runs a skill with; its input names the skill. */
const SKILL_TOOL = 'Skill';

/** A block of a message as an entry's block; undefined for one that shows no row. */
export function toBlock(block: ApiBlock): Block | undefined {
  switch (block.type) {
    case 'text':
      return { kind: 'text', text: block.text ?? '' };
    case 'thinking':
      return { kind: 'thinking', text: block.thinking ?? '' };
    case 'tool_use': {
      if (block.name === FOLLOW_UPS_TOOL) return undefined;
      const input = block.input ?? {};
      const skill = block.name === SKILL_TOOL ? (input as { skill?: unknown }).skill : undefined;
      return {
        kind: 'tool',
        id: block.id ?? '',
        tool: block.name ?? '',
        input,
        ...(typeof skill === 'string' && skill ? { skill } : {}),
      };
    }
    default:
      return undefined;
  }
}

export function toolResult(block: ApiBlock): ToolResult {
  const text =
    typeof block.content === 'string'
      ? block.content
      : (block.content ?? [])
          .filter((part) => part.type === 'text')
          .map((part) => part.text ?? '')
          .join('\n');
  return { text, isError: block.is_error === true };
}
