import type {
  AgentId,
  Approval,
  ApprovalMode,
  ChatStatus,
  ContextUsage,
  EffortLevel,
  Editor,
  Entry,
  FollowUp,
  NewChatSettings,
  OpenChat,
  PlanStep,
  PromptCache,
  QueuedEntry,
} from '@grimoire/contract';

/** An open chat: a chat, or a blank page waiting for its first message. */
export interface Chat {
  /** The chat's ID; a local one while the chat is blank. */
  id: string;
  agent: AgentId;
  /** Empty until the agent names the chat. */
  title: string;
  settings: NewChatSettings;
  status: ChatStatus | 'blank';
  entries: readonly Entry[];
  approvals: readonly Approval[];
  /** Messages you sent while a turn ran, waiting for it to end. */
  queued: readonly QueuedEntry[];
  /** How full the context window is, once the agent reports it. */
  context?: ContextUsage;
  /** What its last reply left in the prompt cache. */
  cache?: PromptCache;
  /** The agent's plan, kept up to date as it works. */
  plan: readonly PlanStep[];
  /** Your messages whose file changes were undone. */
  withdrawn: readonly string[];
  /** Your messages copied from the chat this one was forked from; they can't be undone. */
  copied: readonly string[];
  /** What the agent suggests you send next, while it's idle with nothing queued. */
  suggestion?: string;
  /** The separate tasks the agent offered after its last reply, until a turn begins. */
  followUps?: readonly FollowUp[];
  /**
   * While another chat edits its project: that chat. This one
   * can't edit files until it's made the editing chat.
   */
  readOnly?: Editor;
  /** Why the last turn failed, until the next message. */
  error?: string;
  /** When a blank chat was opened, in ms since the epoch. */
  begunAt?: number;
  /** The first message a blank chat has written in, from its preset. */
  prompt?: string;
}

/** The settings a chat's settings card changes. */
export type Setting = 'agent' | 'model' | 'effort' | 'mode' | 'folder' | 'preset';

/** A pick on the settings card. The agent and folder change only on a blank chat. */
export interface SettingsPick {
  agent?: AgentId;
  model?: string;
  /** Auto, on a blank chat: the model and effort are picked for its first message. */
  autoModel?: boolean;
  effort?: EffortLevel;
  mode?: ApprovalMode;
  cwd?: string;
  /** The MCP servers turned off for this chat, by name. */
  mcpOff?: string[];
}

/** What a new chat begins with: an agent, its settings and maybe a first message written in. */
export interface ChatStart {
  agent: AgentId;
  settings: NewChatSettings;
  prompt?: string;
}

/** A chat as the window keeps it, from the chat the hub has open. */
export function fromOpenChat(chat: OpenChat): Chat {
  return {
    id: chat.id,
    agent: chat.agent,
    title: chat.title,
    settings: chat.settings,
    status: chat.status,
    entries: chat.entries,
    approvals: chat.approvals,
    queued: chat.queued,
    plan: chat.plan ?? [],
    withdrawn: chat.withdrawn ?? [],
    copied: chat.copied ?? [],
    ...(chat.context ? { context: chat.context } : {}),
    ...(chat.cache ? { cache: chat.cache } : {}),
    ...(chat.suggestion ? { suggestion: chat.suggestion } : {}),
    ...(chat.followUps?.length ? { followUps: chat.followUps } : {}),
    ...(chat.readOnly ? { readOnly: chat.readOnly } : {}),
  };
}

/** The entries with this one in, in place of the one with its ID or else at the end. */
export function upsert(entries: readonly Entry[], entry: Entry): readonly Entry[] {
  const index = entries.findIndex((existing) => existing.id === entry.id);
  return index === -1 ? [...entries, entry] : replaceAt(entries, index, entry);
}

/** The entries with text streamed onto one of an agent entry's text blocks. */
export function appendText(
  entries: readonly Entry[],
  entryId: string,
  block: number,
  text: string,
): readonly Entry[] {
  return entries.map((entry) => {
    if (entry.id !== entryId || entry.kind !== 'agent') return entry;
    const target = entry.blocks[block];
    if (!target || target.kind === 'tool') return entry;
    return {
      ...entry,
      blocks: replaceAt(entry.blocks, block, { ...target, text: target.text + text }),
    };
  });
}

function replaceAt<T>(items: readonly T[], index: number, item: T): T[] {
  return items.map((existing, i) => (i === index ? item : existing));
}
