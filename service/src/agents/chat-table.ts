import type { DatabaseSync } from 'node:sqlite';
import type {
  AgentId,
  Attachment,
  ChatId,
  ChatSettings,
  ChatStatus,
  ContextUsage,
  Entry,
  FollowUp,
  PlanStep,
  PromptCache,
  QueuedEntry,
  SubagentRun,
} from '@grimoire/contract';
import { EntryIds } from '../storage/entry-ids';
import { OpenChats } from '../storage/open-chats';
import { Parallels } from '../storage/parallels';
import type { AgentAdapter, LiveChat } from './adapter';

/** An open chat, as the hub keeps it in memory. */
export interface ChatState {
  id: ChatId;
  agent: AgentAdapter;
  title: string;
  settings: ChatSettings;
  status: ChatStatus;
  entries: Entry[];
  /** Messages you sent while a turn ran; the next goes when it ends. */
  queued: QueuedEntry[];
  /** How full the context window is, once the agent reports it. */
  context?: ContextUsage;
  /** What the last reply left in the prompt cache. */
  cache?: PromptCache;
  plan: PlanStep[];
  /** Your messages whose file changes were undone. */
  withdrawn: string[];
  /** Your messages copied from the chat this one was forked from. */
  copied: string[];
  /** What the agent suggests you send next, until a turn begins or something is queued. */
  suggestion?: string;
  /** The separate tasks the agent offered after its last reply, until a turn begins or you take each. */
  followUps?: FollowUp[];
  /** While another chat it was sent in parallel with edits: that chat. This one can't edit files. */
  editor?: ChatId;
  /** While the agent process runs. */
  live?: LiveChat;
  /** How many processes the chat has had; what an earlier one still reports is dropped. */
  processes: number;
  /** The agent was signed in to another account during a turn: the process starts again once it ends. */
  restart: boolean;
  /** What the subagents its tool calls started did while it was live, and where they are, by tool call. */
  subagents: Map<string, SubagentRun>;
  /** Streamed text not sent to windows yet, per entry and block. */
  pendingText: Map<string, { entryId: string; block: number; text: string }>;
  flushTimer?: NodeJS.Timeout;
}

/** What the hub keeps across restarts, in Grimoire's database. */
export interface HubStore {
  /** The open chats, so they reopen after a restart. */
  chats: OpenChats;
  /** Your messages whose edits were undone. */
  withdrawn: EntryIds;
  /** Your messages a fork copied; the agent can't undo them. */
  copied: EntryIds;
  /** The chats sent one entry in parallel, and the one that edits each group. */
  parallels: Parallels;
}

export function hubStore(db: DatabaseSync): HubStore {
  return {
    chats: new OpenChats(db),
    withdrawn: new EntryIds(db, 'withdrawn'),
    copied: new EntryIds(db, 'copied'),
    parallels: new Parallels(db),
  };
}

/** The agents, and the chats open with them: what the hub's parts share. */
export class ChatTable {
  readonly adapters = new Map<AgentId, AgentAdapter>();
  readonly chats = new Map<ChatId, ChatState>();

  adapter(agent: AgentId): AgentAdapter {
    const adapter = this.adapters.get(agent);
    if (!adapter) throw new Error(`Unknown agent: ${agent}`);
    return adapter;
  }

  /** An open chat; asking for one that isn't open throws. */
  chat(chatId: ChatId): ChatState {
    const chat = this.chats.get(chatId);
    if (!chat) throw new Error('This chat is not open');
    return chat;
  }

  /** Keeps a chat as open, idle, with these entries. */
  track(
    id: ChatId,
    agent: AgentAdapter,
    settings: ChatSettings,
    entries: Entry[],
    title: string,
  ): ChatState {
    const chat: ChatState = {
      id,
      agent,
      title,
      settings,
      status: 'idle',
      entries,
      queued: [],
      plan: [],
      withdrawn: [],
      copied: [],
      processes: 0,
      restart: false,
      subagents: new Map(),
      pendingText: new Map(),
    };
    this.chats.set(id, chat);
    return chat;
  }
}

export function userEntry(id: string, text: string, attachments: Attachment[]): Entry {
  return { kind: 'user', id, text, ...(attachments.length ? { attachments } : {}) };
}
