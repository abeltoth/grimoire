import type {
  AgentCommand,
  AgentInfo,
  AgentModels,
  ChatId,
  ChatSettings,
  ChatSummary,
  Attachment,
  Entry,
  FollowUp,
  SubagentRun,
  SubagentStats,
  PlanStep,
  PromptCache,
  SettingsChange,
} from '@grimoire/contract';
import type { AgentAdapter, ChatEvents, ChatHistory, LiveChat } from './adapter';

/** A run of the fake agent, which a test drives through `events`. */
export interface FakeRun {
  chatId: ChatId;
  settings: ChatSettings;
  resume: boolean;
  /** The title a new chat was started with. */
  title?: string;
  events: ChatEvents;
  sent: string[];
  /** The entry IDs of the messages sent, in the same order. */
  sentIds: string[];
  /** The pictures and files sent with each message, in the same order. */
  sentAttachments: Attachment[][];
  undone: string[];
  interrupts: number;
  configured: SettingsChange[];
  closed: boolean;
}

/** An agent for tests: it records what the hub asks of it and replies only when the test says so. */
export class FakeAdapter implements AgentAdapter {
  readonly info: AgentInfo = { id: 'fake', name: 'Fake agent', capabilities: [] };
  readonly runs: FakeRun[] = [];
  chats: ChatSummary[] = [];
  transcripts = new Map<ChatId, Entry[]>();
  plans = new Map<ChatId, PlanStep[]>();
  caches = new Map<ChatId, PromptCache>();
  /** The separate tasks each saved chat's last turn offered. */
  followUps = new Map<ChatId, FollowUp[]>();
  /** Saved subagents' runs, by the tool call that started each. */
  subagents = new Map<string, SubagentRun>();
  transcriptLoads = 0;
  /** When set, undo fails with this. */
  undoError?: string;

  async listChats(cwd?: string): Promise<ChatSummary[]> {
    return this.chats.filter((chat) => !cwd || chat.cwd === cwd);
  }

  async history(chatId: ChatId): Promise<ChatHistory> {
    this.transcriptLoads++;
    return structuredClone({
      entries: this.transcripts.get(chatId) ?? [],
      plan: this.plans.get(chatId) ?? [],
      ...(this.caches.has(chatId) ? { cache: this.caches.get(chatId) } : {}),
      ...(this.followUps.has(chatId) ? { followUps: this.followUps.get(chatId) } : {}),
    });
  }

  async subagent(_chatId: ChatId, _cwd: string, toolId: string): Promise<SubagentRun> {
    return structuredClone(this.subagents.get(toolId) ?? { entries: [] });
  }

  async subagentStats(_chatId: ChatId, _cwd: string, toolId: string): Promise<SubagentStats> {
    return structuredClone(this.subagents.get(toolId)?.stats ?? {});
  }

  /** Copies the chat up to and with your message, as the new chat `fork-n`. */
  async fork(chatId: ChatId, cwd: string, entryId: string, title: string): Promise<ChatId> {
    const entries = this.transcripts.get(chatId) ?? [];
    const at = entries.findIndex((entry) => entry.id === entryId);
    const next = entries.findIndex((entry, i) => i > at && entry.kind === 'user');
    const id = `fork-${this.chats.length + 1}`;
    this.transcripts.set(id, entries.slice(0, next === -1 ? undefined : next));
    // Newer than every chat before it, without reading the clock.
    const updatedAt = Math.max(0, ...this.chats.map((chat) => chat.updatedAt)) + 1;
    this.chats.push({ id, agent: this.info.id, title, cwd, updatedAt });
    return id;
  }

  async title(chatId: ChatId): Promise<string> {
    return this.chats.find((chat) => chat.id === chatId)?.title ?? '';
  }

  /** What Auto picks for a new chat, by its first message's text; nothing for any other. */
  readonly picks = new Map<string, Pick<ChatSettings, 'model' | 'effort'>>();

  async pickModel(text: string): Promise<Pick<ChatSettings, 'model' | 'effort'> | undefined> {
    return this.picks.get(text);
  }

  async models(): Promise<AgentModels> {
    return {
      models: [
        { id: 'big', name: 'Big model' },
        { id: 'small', name: 'Small model' },
      ],
      default: 'big',
    };
  }

  /** The folders commands were asked for. */
  readonly commandFolders: string[] = [];

  async commands(cwd: string): Promise<AgentCommand[]> {
    this.commandFolders.push(cwd);
    return [
      { name: 'compact', description: 'Free up context', kind: 'command' },
      { name: 'simplify', description: 'Review the changed code', kind: 'skill' },
    ];
  }

  /** The titles chats were renamed to, by chat. */
  readonly renamed = new Map<ChatId, string>();

  async rename(chatId: ChatId, _cwd: string, title: string): Promise<void> {
    this.renamed.set(chatId, title);
  }

  run(
    chatId: ChatId,
    settings: ChatSettings,
    resume: boolean,
    events: ChatEvents,
    title?: string,
  ): LiveChat {
    const run: FakeRun = {
      chatId,
      settings,
      resume,
      ...(title ? { title } : {}),
      events,
      sent: [],
      sentIds: [],
      sentAttachments: [],
      undone: [],
      interrupts: 0,
      configured: [],
      closed: false,
    };
    this.runs.push(run);
    return {
      send: (text, id, attachments = []) => {
        run.sent.push(text);
        run.sentIds.push(id);
        run.sentAttachments.push(attachments);
      },
      interrupt: async () => void run.interrupts++,
      configure: async (change) => void run.configured.push(change),
      undo: async (entryId) => {
        if (this.undoError) throw new Error(this.undoError);
        run.undone.push(entryId);
      },
      close: () => void (run.closed = true),
    };
  }

  /** The latest run of a chat. */
  runOf(chatId: ChatId): FakeRun {
    const run = this.runs.findLast((r) => r.chatId === chatId);
    if (!run) throw new Error(`No run for ${chatId}`);
    return run;
  }
}
