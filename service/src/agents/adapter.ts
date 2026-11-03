import type {
  AgentCommand,
  AgentInfo,
  AgentModels,
  Answer,
  Approval,
  ApprovalDecision,
  ChatId,
  ChatSettings,
  ChatStatus,
  ChatSummary,
  ContextUsage,
  PromptCache,
  Enclosure,
  Entry,
  PlanStep,
  PlanUsage,
  SettingsChange,
} from '@grimoire/contract';

/** A chat as the agent lists it; its dog-ears are Grimoire's (ADR-009). */
export type SavedChat = Omit<ChatSummary, 'dogEars'>;

/** One agent, such as Claude Code. The hub reaches agents only through this (ADR-006). */
export interface AgentAdapter {
  readonly info: AgentInfo;
  /** The agent's chats, most recent first. */
  listChats(cwd?: string): Promise<SavedChat[]>;
  /** A saved chat: its transcript, and the plan as the agent last left it. */
  history(chatId: ChatId, cwd: string): Promise<ChatHistory>;
  /**
   * Copies a chat, up to the end of the turn your entry `entryId` began,
   * into a new chat with this title; returns the new chat's ID.
   * Agents that can't fork leave it out.
   */
  fork?(chatId: ChatId, cwd: string, entryId: string, title: string): Promise<ChatId>;
  /** Gives a saved chat a new title. Agents that can't rename chats leave it out. */
  rename?(chatId: ChatId, cwd: string, title: string): Promise<void>;
  /** The chat's title; empty until the agent names it. */
  title(chatId: ChatId, cwd: string): Promise<string>;
  models(): Promise<AgentModels>;
  /** The commands and skills you can use in a folder. Agents without them leave it out. */
  commands?(cwd: string): Promise<AgentCommand[]>;
  /** The subscription's limits and how much of them is used. Agents without a plan leave it out. */
  usage?(): Promise<PlanUsage>;
  /**
   * Starts the agent's process for a chat: a new chat under the given ID,
   * or, with `resume`, an existing one. Messages go in through send().
   * A new chat can be given its title; a resumed one keeps its own.
   */
  run(
    chatId: ChatId,
    settings: ChatSettings,
    resume: boolean,
    events: ChatEvents,
    title?: string,
  ): LiveChat;
  /**
   * Starts a new chat with its first message, when the agent picks the
   * chat's ID itself, as it does on a spare process (ADR-010). `bind` gets
   * the ID before any event. Without this, the hub picks the ID and calls run().
   */
  start?(
    settings: ChatSettings,
    text: string,
    id: string,
    bind: (chatId: ChatId) => ChatEvents,
    title?: string,
    enclosures?: Enclosure[],
  ): Promise<LiveChat>;
  /** Keeps a spare process started, so the next new chat opens at once (ADR-010). */
  warm?(): void;
  /** Stops any spare process, for when the service stops. */
  dispose?(): void;
}

export interface ChatHistory {
  entries: Entry[];
  plan: PlanStep[];
  /** What the last reply left in the prompt cache, when the agent records it. */
  cache?: PromptCache;
}

/** A chat whose agent process is running. */
export interface LiveChat {
  /**
   * Sends your message, with any pictures and files; `id` is its entry's ID,
   * which the agent keeps so undo() can find it.
   */
  send(text: string, id: string, enclosures?: Enclosure[]): void;
  /** Stops the running turn; the chat stays live. */
  interrupt(): Promise<void>;
  /** Changes the model or permission; the agent takes it from its next request. */
  configure(change: SettingsChange): Promise<void>;
  /**
   * Restores the files to how they were before your entry with this ID.
   * Rejects, saying why, when the agent can't. Agents without undo leave it out.
   */
  undo?(entryId: string): Promise<void>;
  /** Stops the agent process. */
  close(): void;
}

/** What a live chat reports to the hub. */
export interface ChatEvents {
  status(status: Exclude<ChatStatus, 'idle' | 'waiting'>): void;
  /** A new or changed entry, complete. */
  entry(entry: Entry): void;
  /** Text streamed into a block of an entry the hub already has. */
  text(entryId: string, block: number, text: string): void;
  /** Asks for a decision. `signal` aborts when the agent stops waiting for it. */
  approval(request: ApprovalRequest, signal: AbortSignal): Promise<Verdict>;
  /** The agent named or renamed the chat. */
  title(title: string): void;
  /** How much of the context window the chat now fills. */
  context(usage: ContextUsage): void;
  /** A turn ended, leaving this in the prompt cache. */
  cache(cache: PromptCache): void;
  /** The agent changed its plan. */
  plan(plan: PlanStep[]): void;
  turnEnded(error?: string): void;
  /** The agent process ended, on close() or by itself. */
  closed(error?: string): void;
}

export type ApprovalRequest = Omit<Approval, 'chatId'>;

/** Your decision on an approval: allow or deny, or the answers to its questions. */
export type Verdict = ApprovalDecision | { answers: Answer[] };
