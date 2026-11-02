/**
 * The agent hub's contract (ADR-006): chats with any agent, in terms that
 * aren't specific to one. Each agent's adapter maps its own messages onto
 * these types.
 */

export type AgentId = string;
/** The agent's own session ID, so terminal tools see the same chat. */
export type ChatId = string;

/** What an agent supports beyond chatting. Features that need one show only for agents that have it. */
export type AgentCapability = 'rename' | 'fork' | 'undo';

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

/** The settings you can change once a chat has begun. */
export type SettingsChange = Pick<ChatSettings, 'model' | 'mode'>;

/** A model an agent offers. */
export interface AgentModel {
  /** What ChatSettings.model takes. */
  id: string;
  name: string;
  description?: string;
}

export interface AgentModels {
  models: AgentModel[];
  /** The model a chat gets when its settings name none. */
  default?: string;
}

/** The folders your chats ran in, most recent first, and your home folder. */
export interface RecentFolders {
  home: string;
  recent: string[];
}

/** A chat as the agent lists it, open or not. */
export interface ChatSummary {
  id: ChatId;
  agent: AgentId;
  title: string;
  cwd?: string;
  /** ms since the epoch. */
  updatedAt: number;
  /** Which of its dog-ears are folded. */
  dogEars: DogEar[];
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
  /** When the agent asked, in ms since the epoch. */
  at?: number;
  /** The agent's own description of the request, when it gives one. */
  title?: string;
  /** What Always allow would allow from now on; missing when the agent doesn't offer it. */
  alwaysAllow?: AlwaysAllow;
  /**
   * When set, the agent asks you these questions instead of asking to use a
   * tool. Answer them with agents.answer.
   */
  questions?: Question[];
}

export interface AlwaysAllow {
  /** The rule, such as the command `git push`; missing when it covers the whole tool. */
  rule?: string;
  /** Where it applies: this chat, this project, or every project. */
  scope: 'chat' | 'project' | 'everywhere';
}

/** A question the agent asks before it continues, with options to tick. */
export interface Question {
  question: string;
  /** A short label for the question, such as "Library". */
  header?: string;
  options: QuestionOption[];
  /** Whether you may tick more than one option. */
  multiSelect: boolean;
}

export interface QuestionOption {
  label: string;
  description?: string;
  /** The agent recommends this option. */
  recommended?: boolean;
}

/** Your answer to one question: the options you ticked, and anything in your own words. */
export interface Answer {
  chosen: string[];
  ownWords?: string;
}

export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny';

/** How much of the agent's context window a chat fills, in tokens. */
export interface ContextUsage {
  used: number;
  limit: number;
}

/** One step of the agent's plan for the chat, which it keeps up to date as it works. */
export interface PlanStep {
  text: string;
  status: 'pending' | 'active' | 'done';
  /** What the agent says while it works on it, such as "Running the tests". */
  activeText?: string;
}

/** A message you sent while a turn ran: it waits until the turn ends. */
export interface QueuedEntry {
  id: string;
  text: string;
}

/** One of an agent's commands or skills, used by writing "/name" at the start of an entry. */
export interface AgentCommand {
  name: string;
  description: string;
  /** What it takes after its name, such as "<file>". */
  argumentHint?: string;
  kind: 'command' | 'skill';
}

/** A dog-ear on a chapter's page: the top corner pins it, the bottom one stars it. */
export type DogEar = 'pin' | 'star';

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
  /** Messages waiting for the turn to end, in the order they go. */
  queued: QueuedEntry[];
  /** Missing until the agent reports it. */
  context?: ContextUsage;
  /** The agent's plan; empty until it makes one. */
  plan: PlanStep[];
  /** Your entries whose file changes were undone; their edits show as withdrawn. */
  withdrawn: string[];
  /** The dog-ears folded down on the chapter. */
  dogEars: DogEar[];
  /** Your tags for it, in the order you added them. */
  tags: string[];
  /**
   * Your entries copied from the chat this one was forked from. The agent
   * keeps no file checkpoints for them, so they can't be undone.
   */
  copied: string[];
}

declare module './commands' {
  interface CommandMap {
    'agents.list': { request: Record<string, never>; response: AgentInfo[] };
    'agents.models': { request: { agent: AgentId }; response: AgentModels };
    /** The agent's commands and skills in a folder; your home folder when there's none. */
    'agents.commands': { request: { agent: AgentId; cwd?: string }; response: AgentCommand[] };
    /** The folders your chats with any agent ran in. */
    'agents.folders': { request: Record<string, never>; response: RecentFolders };
    /** The agent's chats, most recent first, optionally only those in one folder. */
    'agents.chats': { request: { agent: AgentId; cwd?: string }; response: ChatSummary[] };
    /** The chats open as chapters, in ribbon order, remembered across restarts. */
    'agents.openChats': { request: Record<string, never>; response: OpenChat[] };
    /** Opens a chat: loads its transcript, and later messages continue it. */
    'agents.open': {
      request: { agent: AgentId; chatId: ChatId; settings: ChatSettings };
      response: OpenChat;
    };
    /** Starts a new chat with a first message. */
    'agents.start': {
      request: { agent: AgentId; settings: NewChatSettings; text: string; title?: string };
      response: OpenChat;
    };
    /** Renames a chat, with the agent, so the agent's own tools show the new title too. */
    'agents.rename': { request: { chatId: ChatId; title: string }; response: void };
    /** Sends a message; while a turn runs, it's queued and goes when the turn ends. */
    'agents.send': { request: { chatId: ChatId; text: string }; response: void };
    /** Changes a chat's model or permission; a running chat takes it from its next request. */
    'agents.configure': { request: { chatId: ChatId; change: SettingsChange }; response: void };
    /**
     * Restores the files to how they were before one of your entries, while
     * the chat is idle. The edits of that entry and those after it are withdrawn.
     */
    'agents.undo': { request: { chatId: ChatId; entryId: string }; response: void };
    /**
     * Copies a chat, up to the end of the turn one of your entries began,
     * into a new chat: a variant, such as "Context meter (a)". It opens as a
     * chapter, and the original stays as it was.
     */
    'agents.fork': { request: { chatId: ChatId; entryId: string }; response: OpenChat };
    /** Folds a chat's dog-ear down, or unfolds it: pins or stars the chat, or takes that back. */
    'agents.dogEar': {
      request: { chatId: ChatId; dogEar: DogEar; folded: boolean };
      response: void;
    };
    /** Sets a chat's tags, in the order you added them. */
    'agents.tag': { request: { chatId: ChatId; tags: string[] }; response: void };
    /** Takes a message out of the queue; false when it had already gone. */
    'agents.unqueue': { request: { chatId: ChatId; id: string }; response: boolean };
    /**
     * Stops the running turn. The queued messages are withdrawn, not sent,
     * and come back in the response.
     */
    'agents.interrupt': { request: { chatId: ChatId }; response: QueuedEntry[] };
    'agents.decide': {
      request: { approvalId: string; decision: ApprovalDecision };
      response: void;
    };
    /** Answers an approval's questions, one answer per question, in order. */
    'agents.answer': { request: { approvalId: string; answers: Answer[] }; response: void };
    /**
     * Closes a chat's chapter and stops its agent process. The chat itself
     * stays with the agent.
     */
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
    /** The queue changed: the messages now waiting for the turn to end. */
    'agents.queued': { chatId: ChatId; queued: QueuedEntry[] };
    /** How much of the context window the chat now fills. */
    'agents.context': { chatId: ChatId; context: ContextUsage };
    /** The chat's settings changed. */
    'agents.settings': { chatId: ChatId; settings: ChatSettings };
    /** The agent changed its plan. */
    'agents.plan': { chatId: ChatId; plan: PlanStep[] };
    /** A chat's dog-ears changed: the ones now folded down. */
    'agents.dogEars': { chatId: ChatId; dogEars: DogEar[] };
    'agents.tags': { chatId: ChatId; tags: string[] };
    /** Edits were undone: your entries whose file changes are now withdrawn. */
    'agents.withdrawn': { chatId: ChatId; withdrawn: string[] };
  }
}
