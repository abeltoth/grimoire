import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentTool, ToolChat } from '../tools';
import {
  GRIMOIRE_SERVER,
  ProcessChat,
  type ServerMaker,
  grimoireOptions,
  toolName,
} from './grimoire-tools';

type Handler = (args: { what: string }) => Promise<unknown>;

/** The SDK's server maker, keeping the tools it's given, how, and the server's. */
function maker() {
  const tools = new Map<string, { description: string; handler: Handler; extras: unknown }>();
  const servers: { name: string; tools: { name: string }[] }[] = [];
  const sdk = {
    tool: (
      name: string,
      description: string,
      _input: unknown,
      handler: Handler,
      extras: unknown,
    ) => {
      tools.set(name, { description, handler, extras });
      return { name };
    },
    createSdkMcpServer: (options: { name: string; tools: { name: string }[] }) => {
      servers.push(options);
      return { type: 'sdk', name: options.name };
    },
  } as unknown as ServerMaker;
  return { sdk, tools, servers };
}

const chat: ToolChat = {
  chatId: 'chat-1',
  agent: 'claude-code',
  cwd: path.resolve('/git/grimoire'),
};

/** A module's tool that answers with what it was asked and the chat's folder, and turns away "nothing". */
const echo: AgentTool = {
  name: 'echo',
  description: 'Says it back',
  prompt: 'You have the tool echo.',
  input: {},
  run: (args, madeIn) => {
    const { what } = args as { what: string };
    if (what === 'nothing') throw new Error('Nothing to say');
    return `${what} in ${madeIn?.cwd ?? 'no chat'}`;
  },
};

const said = (text: string, isError?: boolean) => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError } : {}),
});

describe("Grimoire's tool server", () => {
  it('names each tool as Claude Code calls it, after the server', () => {
    expect(toolName('echo')).toBe(`mcp__${GRIMOIRE_SERVER}__echo`);
  });

  it("serves the modules' tools, allowed without asking and always loaded, and tells the agent of them", () => {
    const { sdk, tools, servers } = maker();
    const options = grimoireOptions(sdk, { tools: [echo], chat: new ProcessChat() });
    expect(Object.keys(options.mcpServers!)).toEqual([GRIMOIRE_SERVER]);
    expect(servers[0]!.tools.map((tool) => tool.name)).toEqual(['echo']);
    expect(tools.get('echo')!.description).toBe('Says it back');
    expect(tools.get('echo')!.extras).toEqual({ alwaysLoad: true });
    expect(options.allowedTools).toEqual(['mcp__grimoire__echo']);
    expect(options.systemPrompt).toBe('You have the tool echo.');
  });

  it("runs a tool in the process's chat, once one claims it, and an error as the tool's", async () => {
    const { sdk, tools } = maker();
    const processChat = new ProcessChat();
    grimoireOptions(sdk, { tools: [echo], chat: processChat });
    const { handler } = tools.get('echo')!;
    await expect(handler({ what: 'Hello' })).resolves.toEqual(said('Hello in no chat'));
    processChat.set(chat);
    await expect(handler({ what: 'Hello' })).resolves.toEqual(said(`Hello in ${chat.cwd}`));
    await expect(handler({ what: 'nothing' })).resolves.toEqual(said('Nothing to say', true));
  });
});
