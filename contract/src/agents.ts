import type { Approval } from './approvals';
import type { ChatSettings, EffortLevel } from './chat-settings';
import type { Attachment, Entry } from './entries';

/**
 * The agent hub's contract (ADR-006): chats with any agent, in terms that
 * aren't specific to one. Each agent's adapter maps its own messages onto
 * these types.
 */

export type AgentId = string;
/** The agent's own session ID, so terminal tools see the same chat. */
export type ChatId = string;

/** What an agent supports beyond chatting. Features that need one show only for agents that have it. */
/**
 * What an agent can do beyond chatting; "compact" sums a chat up to free its
 * context, and "sign-in" switches the account every chat uses.
 */
export type AgentCapability = 'rename' | 'fork' | 'undo' | 'compact' | 'sign-in' | 'ask';

export interface AgentInfo {
  id: AgentId;
  name: string;
  capabilities: AgentCapability[];
}

/** A model an agent offers. */
export interface AgentModel {
  /** What ChatSettings.model takes. */
  id: string;
  name: string;
  description?: string;
  /** The effort levels it takes, least first; missing when it has none. */
  efforts?: EffortLevel[];
  /** The effort it runs at when a chat names none, as your agent's own settings give it; missing when they don't say. */
  effort?: EffortLevel;
}

export interface AgentModels {
  models: AgentModel[];
  /** The model a chat gets when its settings name none. */
  default?: string;
  /**
   * The model the agent recommends for Grimoire's quick jobs, such as
   * picking a chat's model or naming it; Settings can put another in its place.
   */
  quick?: string;
}

/** The account an agent is signed in with. */
export interface AgentAccount {
  email: string;
  /** The subscription, such as "pro" or "max"; null when the agent doesn't say. */
  plan: string | null;
  /** When the sign-in runs out unless it's renewed, in ms since the epoch; null when the agent doesn't say. */
  expiresAt: number | null;
}

/** A sign-in waiting for you in the browser. */
export interface PendingSignIn {
  /** The account being signed in to. */
  email: string;
  /** The sign-in page, to open by hand when the browser didn't open by itself; null until the agent gives it. */
  url: string | null;
}

/** Who an agent is signed in as, and any sign-in under way. */
export interface AgentSignIn {
  agent: AgentId;
  /** Null while it's signed out. */
  account: AgentAccount | null;
  pending: PendingSignIn | null;
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
}

/** What a live chat is doing. Idle chats aren't running a turn. */
export type ChatStatus = 'idle' | 'thinking' | 'writing' | 'waiting';

/** How much of the agent's context window a chat fills, in tokens. */
export interface ContextUsage {
  used: number;
  limit: number;
}

/**
 * The prompt cache a chat's last reply left. Until it runs out, continuing
 * reads the chat's context from the cache; after, it reads it all again.
 */
export interface PromptCache {
  /** The tokens the chat's context holds: what continuing re-reads once the cache has run out. */
  tokens: number;
  /** When the cache runs out, in ms since the epoch. */
  until: number;
}

/** Where a subagent is with its task: still at it, done, failed, or stopped before it was done. */
export type SubagentState = 'working' | 'done' | 'failed' | 'stopped';

/** What a subagent did, and where it is with its task. */
export interface SubagentRun {
  /** Its replies and tools; its task, the tool call's input, left out. */
  entries: Entry[];
  /** Missing while the agent hasn't said. */
  state?: SubagentState;
  /** How it ran and what it took; missing while the agent hasn't said. */
  stats?: SubagentStats;
}

/** How a subagent ran and what its run took; each part missing until the agent says. */
export interface SubagentStats {
  effort?: EffortLevel;
  /** Whether it ran in the background, the agent going on without waiting for it. */
  background?: boolean;
  /** 1 for a subagent the chat's agent started, 2 for one its subagent started, and so on. */
  depth?: number;
  durationMs?: number;
  tokens?: number;
  toolUses?: number;
  /** Its tool calls by kind, once it ended. */
  tools?: { read: number; search: number; shell: number; edit: number; other: number };
  /** The lines its edits added and removed, once it ended. */
  lines?: { added: number; removed: number };
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
  attachments?: Attachment[];
}

/** One of an agent's commands or skills, used by writing "/name" at the start of a message. */
export interface AgentCommand {
  name: string;
  description: string;
  /** What it takes after its name, such as "<file>". */
  argumentHint?: string;
  kind: 'command' | 'skill';
}

/**
 * A separate task the agent offers after a reply, as a card: clicking it
 * opens a new chat with its prompt written in, not sent.
 */
export interface FollowUp {
  /** A few words naming the task. */
  title: string;
  /** The new chat's first message, written in for you to send. */
  prompt: string;
}

/**
 * The chat that edits while another open chat sent the same entry in
 * parallel only reads (ADR-011). Of the chats sent in parallel, one edits:
 * the first opened, until you make another the editing chat. The others
 * can't edit files. Any other chat edits.
 */
export interface Editor {
  chatId: ChatId;
  /** Empty until the agent names the chat. */
  title: string;
}

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
  /** What its last reply left in the prompt cache; missing until it has replied. */
  cache?: PromptCache;
  /** The agent's plan; empty until it makes one. */
  plan: PlanStep[];
  /** Your messages whose file changes were undone; their edits show as withdrawn. */
  withdrawn: string[];
  /**
   * Your messages copied from the chat this one was forked from. The agent
   * keeps no file checkpoints for them, so they can't be undone.
   */
  copied: string[];
  /** What the agent suggests you send next, while the chat is idle with nothing queued. */
  suggestion?: string;
  /** The separate tasks the agent offered after its last reply, until a turn begins. */
  followUps?: FollowUp[];
  /** While another chat it was sent in parallel with edits: that chat. This one can't edit files. */
  readOnly?: Editor;
}
