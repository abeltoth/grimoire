import type { McpServerStatus, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { MessageQueue } from './message-queue';

// Loaded on first use: it's large, and the service starts without it.
const sdk = () => import('@anthropic-ai/claude-agent-sdk');

/** What a connector's tool answers: MCP content blocks as its server sent them, and any structured content. */
export interface ToolResult {
  content: { type: string; text?: string; [key: string]: unknown }[];
  structuredContent?: unknown;
}

/** A connector's tool that answered with an error, and what it said, as its server said it. */
export class ToolFailed extends Error {
  constructor(
    readonly tool: string,
    readonly said: string,
  ) {
    super(`${tool} failed: ${said || 'it said no more'}`);
  }
}

/** One of your claude.ai connectors, as Claude Code has it. */
export interface Connector {
  /** Its name, such as "claude.ai Atlassian". */
  name: string;
  status: McpServerStatus['status'];
  /** Why it failed, when it did. */
  error?: string;
  /** Its tools' own names, such as getJiraIssue. */
  tools: string[];
}

/** A Claude Code process kept to reach your claude.ai connectors, with no model turn. */
export interface Connectors {
  /** Your claude.ai connectors, once they're listed and done connecting, or have taken too long. */
  list(): Promise<Connector[]>;
  /**
   * Calls one of a connector's tools that `allowed` names, directly: no
   * model reads it and no tokens are spent. Rejects, saying why, when the
   * tool isn't allowed, Claude Code can't call it so, or the tool fails.
   */
  call(connector: Connector, tool: string, args: Record<string, unknown>): Promise<ToolResult>;
  close(): void;
}

/** How long to wait for Claude Code to list your claude.ai connectors at all, when it lists none. */
const LISTED_MS = 5_000;
/** How long to wait for those listed to connect. */
const CONNECTED_MS = 15_000;
/** What Claude Code says when it can call a tool for a program rather than a model. */
const DIRECT_CALLS = 'mcp_call_result_not_for_model_v1';

/**
 * Starts a Claude Code process that never gets a message, to reach your
 * claude.ai connectors: one of the two exceptions to Grimoire never
 * talking to MCP servers. It loads none of your settings or MCP
 * servers and saves nothing, but signs in as your chats do, so your
 * claude.ai connectors load with it. A tool is called through Claude
 * Code's control channel, which asks no permission: only the tools
 * `allowed` names, by their own names, can be called.
 */
export async function openConnectors(allowed: ReadonlySet<string>): Promise<Connectors> {
  const { query } = await sdk();
  const input = new MessageQueue<SDKUserMessage>();
  const claude = query({
    prompt: input,
    options: {
      tools: [],
      settingSources: [],
      mcpServers: {},
      persistSession: false,
      permissionMode: 'default',
      env: { ...process.env },
    },
  });
  return {
    list: () => listConnectors(claude),
    async call(connector, tool, args) {
      if (!allowed.has(tool)) {
        throw new Error(`Grimoire doesn't call ${connector.name}'s tool "${tool}"`);
      }
      const { capabilities } = (await claude.initializationResult()) as { capabilities?: string[] };
      if (!capabilities?.includes(DIRECT_CALLS)) {
        throw new Error(
          `This Claude Code can't call a connector's tools directly (it lacks ${DIRECT_CALLS}); update it`,
        );
      }
      return callTool(claude, toolName(connector.name, tool), args);
    },
    close() {
      input.end();
      claude.close();
    },
  };
}

/**
 * The name Claude Code calls a connector's tool by: its server's name,
 * each character other than letters, digits, _ and - made _, between
 * mcp__ and __, such as mcp__claude_ai_Atlassian__getJiraIssue.
 */
export function toolName(server: string, tool: string): string {
  return `mcp__${server.replace(/[^a-zA-Z0-9_-]/g, '_')}__${tool}`;
}

/** The claude.ai connectors, waiting for Claude Code to list them, and for them to connect. */
async function listConnectors(claude: Query): Promise<Connector[]> {
  const since = Date.now();
  const connectors = async () => (await claude.mcpServerStatus()).filter(fromClaudeAi);
  let listed = await connectors();
  while (
    listed.length
      ? listed.some((server) => server.status === 'pending') && Date.now() - since < CONNECTED_MS
      : Date.now() - since < LISTED_MS
  ) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    listed = await connectors();
  }
  return listed.map((server) => ({
    name: server.name,
    status: server.status,
    ...(server.error ? { error: server.error } : {}),
    tools: (server.tools ?? []).map((tool) => tool.name),
  }));
}

/** A claude.ai connector, rather than an MCP server of your own. */
function fromClaudeAi(server: McpServerStatus): boolean {
  return server.source === 'claudeai' || server.scope === 'claudeai';
}

/**
 * Calls an MCP tool through Claude Code's control channel, with no model
 * turn: `mcp_call`, which the SDK has but doesn't type or document. Asked
 * for as a program's, its result is the server's own content blocks,
 * neither shortened nor saved.
 */
async function callTool(
  claude: Query,
  tool: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const control = claude as unknown as {
    request(request: object): Promise<{
      response?: { content?: unknown; structuredContent?: unknown; isError?: boolean };
    }>;
  };
  let response;
  try {
    ({ response } = await control.request({
      subtype: 'mcp_call',
      tool,
      arguments: args,
      result_not_for_model: true,
    }));
  } catch (error) {
    throw new Error(`${tool} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const content = Array.isArray(response?.content)
    ? (response.content as ToolResult['content'])
    : [];
  if (response?.isError) {
    throw new ToolFailed(
      tool,
      content
        .map((block) => block.text ?? '')
        .join(' ')
        .trim(),
    );
  }
  return {
    content,
    ...(response?.structuredContent !== undefined
      ? { structuredContent: response.structuredContent }
      : {}),
  };
}
