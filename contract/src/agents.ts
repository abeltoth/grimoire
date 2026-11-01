/**
 * The agent hub's contract (ADR-006): chats with any agent, in terms that
 * aren't specific to one. Each agent's adapter maps its own messages onto
 * these types.
 */

export type AgentId = string;
/** The agent's own session ID, so terminal tools see the same chat. */
export type ChatId = string;

/** What an agent supports beyond chatting. Features that need one show only for agents that have it. */
export type AgentCapability = 'rename' | 'fork' | 'undo' | 'tags';

export interface AgentInfo {
  id: AgentId;
  name: string;
  capabilities: AgentCapability[];
}

/** How freely the agent may act: ask first, accept edits, plan only, or allow everything. */
export type ApprovalMode = 'ask' | 'accept-edits' | 'plan' | 'allow-all';

export interface ChatSettings {
  /** The project folder the agent works in. */
  cwd: string;
  /** The agent's model ID; the agent's default when left out. */
  model?: string;
  mode?: ApprovalMode;
}

/** Settings for a new chat; the folder defaults to your home folder. */
export type NewChatSettings = Omit<ChatSettings, 'cwd'> & { cwd?: string };

/** A chat as the agent lists it, open or not. */
export interface ChatSummary {
  id: ChatId;
  agent: AgentId;
  title: string;
  cwd?: string;
  /** ms since the epoch. */
  updatedAt: number;
}

/** What a live chat is doing. Idle chats aren't running a turn. */
export type ChatStatus = 'idle' | 'thinking' | 'writing' | 'waiting';

/** One entry in a transcript. */
export type Entry = UserEntry | AgentEntry;

export interface UserEntry {
  kind: 'user';
  id: string;
  text: string;
  /** When it was written, in ms since the epoch, when known. */
  at?: number;
}

export interface AgentEntry {
  kind: 'agent';
  id: string;
  blocks: Block[];
  /** When it was written, in ms since the epoch, when known. */
  at?: number;
}

export type Block = TextBlock | ThinkingBlock | ToolBlock;

export interface TextBlock {
  kind: 'text';
  text: string;
}

export interface ThinkingBlock {
  kind: 'thinking';
  text: string;
}

/** A tool the agent called, such as reading a file or running a command. */
export interface ToolBlock {
  kind: 'tool';
  id: string;
  tool: string;
  input: unknown;
  /** Missing while the tool runs. */
  result?: ToolResult;
}

export interface ToolResult {
  text: string;
  isError: boolean;
}

/** The agent wants to use a tool and waits for your decision. */
export interface Approval {
  id: string;
  chatId: ChatId;
  tool: string;
  input: unknown;
  /** The agent's own description of the request, when it gives one. */
  title?: string;
  /** Whether the agent offers to remember an "always allow". */
  canAlwaysAllow: boolean;
}

export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny';

/** A chat the hub has open: its transcript so far and what it's doing. */
export interface OpenChat {
  id: ChatId;
  agent: AgentId;
  /** Empty until the agent names the chat. */
  title: string;
  settings: ChatSettings;
  status: ChatStatus;
  entries: Entry[];
  approvals: Approval[];
}

declare module './commands' {
  interface CommandMap {
    'agents.list': { request: Record<string, never>; response: AgentInfo[] };
    /** The agent's chats, most recent first, optionally only those in one folder. */
    'agents.chats': { request: { agent: AgentId; cwd?: string }; response: ChatSummary[] };
    /** Opens a chat: loads its transcript, and later messages continue it. */
    'agents.open': {
      request: { agent: AgentId; chatId: ChatId; settings: ChatSettings };
      response: OpenChat;
    };
    /** Starts a new chat with a first message. */
    'agents.start': {
      request: { agent: AgentId; settings: NewChatSettings; text: string };
      response: OpenChat;
    };
    /** Sends a message; while a turn runs, the agent takes it when it can. */
    'agents.send': { request: { chatId: ChatId; text: string }; response: void };
    /** Stops the running turn. */
    'agents.interrupt': { request: { chatId: ChatId }; response: void };
    'agents.decide': {
      request: { approvalId: string; decision: ApprovalDecision };
      response: void;
    };
    /** Closes a chat and stops its agent process. The chat itself stays with the agent. */
    'agents.close': { request: { chatId: ChatId }; response: void };
  }
}

declare module './events' {
  interface EventMap {
    'agents.status': { chatId: ChatId; status: ChatStatus };
    /** A new or changed entry, complete. */
    'agents.entry': { chatId: ChatId; entry: Entry };
    /** Text streamed into a block of an entry since the last event, batched. */
    'agents.text': { chatId: ChatId; entryId: string; block: number; text: string };
    'agents.approval': { approval: Approval };
    /** An approval was decided, or dropped because the turn stopped. */
    'agents.approvalSettled': { chatId: ChatId; approvalId: string };
    'agents.turnEnded': { chatId: ChatId; error?: string };
    'agents.title': { chatId: ChatId; title: string };
  }
}
