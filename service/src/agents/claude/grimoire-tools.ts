import type { Options, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { AgentTool, ToolChat } from '../tools';
import { FOLLOW_UPS_PROMPT, type FollowUpsKept, followUpsTool } from './follow-ups';
import { FOLLOW_UPS_TOOL } from './messages';

/**
 * Grimoire's own tool server, in the service's process: the one exception
 * to Grimoire never talking to MCP servers (ADR-011). Its tools let the
 * agent offer separate tasks as cards that open new chats (follow-ups.ts),
 * and do what the modules' tools let it.
 */
export const GRIMOIRE_SERVER = 'grimoire';

/** A tool's name as Claude Code calls it, after the server. */
export const toolName = (name: string): string => `mcp__${GRIMOIRE_SERVER}__${name}`;

/** The parts of the Agent SDK the server is made with, loaded when a process starts. */
export interface ServerMaker {
  createSdkMcpServer: typeof createSdkMcpServer;
  tool: typeof tool;
}

/** The chat a process is for, which its tools work in: a spare process's, once a chat claims it. */
export class ProcessChat {
  private chat: ToolChat | undefined;

  get(): ToolChat | undefined {
    return this.chat;
  }

  set(chat: ToolChat): void {
    this.chat = chat;
  }
}

/** What a process's tools work with. */
export interface GrimoireTools {
  /** Where separate tasks offered are kept; left out when the agent isn't to offer them. */
  followUps?: FollowUpsKept;
  /** The modules' tools. */
  tools: readonly AgentTool[];
  chat: ProcessChat;
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
  { followUps, tools, chat }: GrimoireTools,
): Pick<Options, 'mcpServers' | 'allowedTools' | 'systemPrompt'> {
  const served = [
    ...(followUps ? [followUpsTool(sdk, followUps)] : []),
    ...tools.map((tool) => serve(sdk, tool, chat)),
  ];
  return {
    mcpServers: {
      [GRIMOIRE_SERVER]: sdk.createSdkMcpServer({
        name: GRIMOIRE_SERVER,
        tools: served,
        alwaysLoad: true,
      }),
    },
    allowedTools: [
      ...(followUps ? [FOLLOW_UPS_TOOL] : []),
      ...tools.map((tool) => toolName(tool.name)),
    ],
    systemPrompt: [
      ...(followUps ? [FOLLOW_UPS_PROMPT] : []),
      ...tools.map((tool) => tool.prompt),
    ].join('\n\n'),
  };
}

/** A module's tool as the SDK serves it, in `chat`: what it throws, the agent reads as its error. */
function serve(sdk: ServerMaker, served: AgentTool, chat: ProcessChat) {
  return sdk.tool(
    served.name,
    served.description,
    served.input,
    async (args) => {
      try {
        return { content: [{ type: 'text', text: await served.run(args, chat.get()) }] };
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text }], isError: true };
      }
    },
    { alwaysLoad: true },
  );
}
