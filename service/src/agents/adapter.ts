import type {
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
  Entry,
  PlanStep,
  SettingsChange,
} from '@grimoire/contract';

/** One agent, such as Claude Code. The hub reaches agents only through this (ADR-006). */
export interface AgentAdapter {
  readonly info: AgentInfo;
  /** The agent's chats, most recent first. */
  listChats(cwd?: string): Promise<ChatSummary[]>;
  /** A saved chat: its transcript, and the plan as the agent last left it. */
  history(chatId: ChatId, cwd: string): Promise<ChatHistory>;
  /** The chat's title; empty until the agent names it. */
  title(chatId: ChatId, cwd: string): Promise<string>;
  models(): Promise<AgentModels>;
  /**
   * Starts the agent's process for a chat: a new chat under the given ID,
   * or, with `resume`, an existing one. Messages go in through send().
   */
  run(chatId: ChatId, settings: ChatSettings, resume: boolean, events: ChatEvents): LiveChat;
  /**
   * Starts a new chat with its first message, when the agent picks the
   * chat's ID itself, as it does on a spare process (ADR-010). `bind` gets
   * the ID before any event. Without this, the hub picks the ID and calls run().
   */
  start?(settings: ChatSettings, text: string, bind: (chatId: ChatId) => ChatEvents): Promise<LiveChat>;
  /** Keeps a spare process started, so the next new chat opens at once (ADR-010). */
  warm?(): void;
  /** Stops any spare process, for when the service stops. */
  dispose?(): void;
}

export interface ChatHistory {
  entries: Entry[];
  plan: PlanStep[];
}

/** A chat whose agent process is running. */
export interface LiveChat {
  send(text: string): void;
  /** Stops the running turn; the chat stays live. */
  interrupt(): Promise<void>;
  /** Changes the model or permission; the agent takes it from its next request. */
  configure(change: SettingsChange): Promise<void>;
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
  /** The agent changed its plan. */
  plan(plan: PlanStep[]): void;
  turnEnded(error?: string): void;
  /** The agent process ended, on close() or by itself. */
  closed(error?: string): void;
}

export type ApprovalRequest = Omit<Approval, 'chatId'>;

/** Your decision on an approval: allow or deny, or the answers to its questions. */
export type Verdict = ApprovalDecision | { answers: Answer[] };
