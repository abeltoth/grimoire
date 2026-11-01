import type {
  AgentInfo,
  ApprovalDecision,
  ChatId,
  ChatSettings,
  ChatStatus,
  ChatSummary,
  Entry,
} from '@grimoire/contract';

/** One agent, such as Claude Code. The hub reaches agents only through this (ADR-006). */
export interface AgentAdapter {
  readonly info: AgentInfo;
  /** The agent's chats, most recent first. */
  listChats(cwd?: string): Promise<ChatSummary[]>;
  transcript(chatId: ChatId, cwd: string): Promise<Entry[]>;
  /** The chat's title; empty until the agent names it. */
  title(chatId: ChatId, cwd: string): Promise<string>;
  /**
   * Starts the agent's process for a chat: a new chat under the given ID,
   * or, with `resume`, an existing one. Messages go in through send().
   */
  run(chatId: ChatId, settings: ChatSettings, resume: boolean, events: ChatEvents): LiveChat;
}

/** A chat whose agent process is running. */
export interface LiveChat {
  send(text: string): void;
  /** Stops the running turn; the chat stays live. */
  interrupt(): Promise<void>;
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
  approval(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision>;
  /** The agent named or renamed the chat. */
  title(title: string): void;
  turnEnded(error?: string): void;
  /** The agent process ended, on close() or by itself. */
  closed(error?: string): void;
}

export interface ApprovalRequest {
  id: string;
  tool: string;
  input: unknown;
  title?: string;
  canAlwaysAllow: boolean;
}
