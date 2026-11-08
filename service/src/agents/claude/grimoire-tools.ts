import type { Options, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { FOLLOW_UPS_PROMPT, type FollowUpsKept, followUpsTool } from './follow-ups';
import { FOLLOW_UPS_TOOL } from './transcript';
import { ADD_TODO_PROMPT, ADD_TODO_TOOL, type AddTodo, type TodoChat, addTodoTool } from './todos';

/**
 * Grimoire's own tool server, in the service's process: the one exception
 * to Grimoire never talking to MCP servers (ADR-011). Its tools let the
 * agent offer separate tasks as cards that open new chats (follow-ups.ts),
 * and add tasks to your Kanban board (todos.ts).
 */
export const GRIMOIRE_SERVER = 'grimoire';

/** The parts of the Agent SDK the server is made with, loaded when a process starts. */
export interface ServerMaker {
  createSdkMcpServer: typeof createSdkMcpServer;
  tool: typeof tool;
}

/** What a process's tools work with. */
export interface GrimoireTools {
  /** Where separate tasks offered are kept; left out when the agent isn't to offer them. */
  followUps?: FollowUpsKept;
  /** The chat the process is for, and where the cards it adds go. */
  todos: { chat: TodoChat; add: AddTodo };
}

/**
 * The options that give a Claude Code process Grimoire's tools, and tell
 * the agent of them. The tools are allowed without asking, and always
 * loaded, never deferred behind tool search. Without the system prompt, the
 * SDK gives Claude Code an empty one, its tools' own words aside; this is
 * the whole of it, so nothing else the agent is told changes.
 */
export function grimoireOptions(
  sdk: ServerMaker,
  { followUps, todos }: GrimoireTools,
): Pick<Options, 'mcpServers' | 'allowedTools' | 'systemPrompt'> {
  const tools = [
    ...(followUps ? [followUpsTool(sdk, followUps)] : []),
    addTodoTool(sdk, todos.chat, todos.add),
  ];
  return {
    mcpServers: {
      [GRIMOIRE_SERVER]: sdk.createSdkMcpServer({ name: GRIMOIRE_SERVER, tools, alwaysLoad: true }),
    },
    allowedTools: [...(followUps ? [FOLLOW_UPS_TOOL] : []), ADD_TODO_TOOL],
    systemPrompt: [...(followUps ? [FOLLOW_UPS_PROMPT] : []), ADD_TODO_PROMPT].join('\n\n'),
  };
}
