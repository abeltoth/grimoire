import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { GRIMOIRE_SERVER, type ServerMaker, grimoireOptions } from './grimoire-tools';
import { ADD_TODO_PROMPT, ADD_TODO_TOOL, ADD_TODO_TOOL_NAME, type AddTodo, TodoChat } from './todos';

type Handler = (args: { title: string; notes?: string; folder?: string }) => Promise<unknown>;

/** The SDK's server maker, keeping the tools it's given and the server's. */
function maker() {
  const tools = new Map<string, { description: string; handler: Handler }>();
  const servers: { name: string; tools: { name: string }[] }[] = [];
  const sdk = {
    tool: (name: string, description: string, _input: unknown, handler: Handler) => {
      tools.set(name, { description, handler });
      return { name };
    },
    createSdkMcpServer: (options: { name: string; tools: { name: string }[] }) => {
      servers.push(options);
      return { type: 'sdk', name: options.name };
    },
  } as unknown as ServerMaker;
  return { sdk, tools, servers };
}

const cwd = path.resolve('/git/grimoire');
const chat = { chatId: 'chat-1', agent: 'claude-code', cwd };

/** The cards the tool added, each with the chat it was added in; like a board, `add` turns away one without a title. */
let added: Parameters<AddTodo>[];
let add: AddTodo;
beforeEach(() => {
  added = [];
  add = (draft, madeIn) => {
    if (!draft.title) throw new Error('A card needs a title');
    added.push([draft, madeIn]);
  };
});

/** The add_todo tool, in a chat that has begun unless `begun` is false. */
function addTodo(begun = true) {
  const { sdk, tools } = maker();
  const todoChat = new TodoChat();
  if (begun) todoChat.set(chat);
  grimoireOptions(sdk, { todos: { chat: todoChat, add } });
  return tools.get(ADD_TODO_TOOL_NAME)!;
}

const said = (text: string, isError?: boolean) => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError } : {}),
});

describe('the add_todo tool', () => {
  it('is named as Claude Code calls it, after the server', () => {
    expect(ADD_TODO_TOOL).toBe(`mcp__${GRIMOIRE_SERVER}__${ADD_TODO_TOOL_NAME}`);
  });

  it('tells the agent to add a card only when asked, or for a separate task to track', () => {
    expect(ADD_TODO_PROMPT).toContain('only when the user asks for a to-do');
    expect(ADD_TODO_PROMPT).toContain('clearly separate task comes up that should be tracked');
    expect(addTodo().description).toContain('Use it only when the user asks for a to-do');
  });

  it('is on the server, allowed without asking, even when the agent offers no separate tasks', () => {
    const { sdk, servers } = maker();
    const options = grimoireOptions(sdk, { todos: { chat: new TodoChat(), add } });
    expect(options.allowedTools).toEqual([ADD_TODO_TOOL]);
    expect(Object.keys(options.mcpServers!)).toEqual([GRIMOIRE_SERVER]);
    expect(servers[0]!.tools.map((tool) => tool.name)).toEqual([ADD_TODO_TOOL_NAME]);
    expect(options.systemPrompt).toBe(ADD_TODO_PROMPT);
  });

  it('adds a card in the chat’s folder, tidied, made in the chat, and says so', async () => {
    await expect(addTodo().handler({ title: ' Context meter ', notes: ' From the usage events.\n' })).resolves.toEqual(
      said('Added "Context meter" to To do on the user\'s Kanban board.'),
    );
    expect(added).toEqual([[{ title: 'Context meter', notes: 'From the usage events.', cwd }, chat]]);
  });

  it('puts the card in the folder named, one not absolute taken from the chat’s', async () => {
    const elsewhere = path.resolve('/git/breeder');
    await addTodo().handler({ title: 'A', folder: elsewhere });
    await addTodo().handler({ title: 'B', folder: '../breeder' });
    await addTodo().handler({ title: 'C', folder: '  ' });
    expect(added.map(([draft]) => draft.cwd)).toEqual([elsewhere, elsewhere, cwd]);
  });

  it('tells the agent when the card was turned away, or its chat isn’t known yet', async () => {
    await expect(addTodo().handler({ title: '  ' })).resolves.toEqual(said('A card needs a title', true));
    await expect(addTodo(false).handler({ title: 'Context meter' })).resolves.toEqual(
      said('There is no chat to add the task in yet.', true),
    );
    expect(added).toEqual([]);
  });
});
