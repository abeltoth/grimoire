import type {
  AgentCommand,
  AgentInfo,
  AgentModels,
  ChatId,
  ChatSettings,
  ChatSummary,
  Entry,
  PlanStep,
  SettingsChange,
} from '@grimoire/contract';
import type { AgentAdapter, ChatEvents, ChatHistory, LiveChat } from './adapter';

/** A run of the fake agent, which a test drives through `events`. */
export interface FakeRun {
  chatId: ChatId;
  settings: ChatSettings;
  resume: boolean;
  events: ChatEvents;
  sent: string[];
  /** The entry IDs of the messages sent, in the same order. */
  sentIds: string[];
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
    });
  }

  /** Copies the chat up to and with your entry, as the new chat `fork-n`. */
  async fork(chatId: ChatId, cwd: string, entryId: string, title: string): Promise<ChatId> {
    const entries = this.transcripts.get(chatId) ?? [];
    const at = entries.findIndex((entry) => entry.id === entryId);
    const next = entries.findIndex((entry, i) => i > at && entry.kind === 'user');
    const id = `fork-${this.chats.length + 1}`;
    this.transcripts.set(id, entries.slice(0, next === -1 ? undefined : next));
    this.chats.push({ id, agent: this.info.id, title, cwd, updatedAt: Date.now() });
    return id;
  }

  async title(chatId: ChatId): Promise<string> {
    return this.chats.find((chat) => chat.id === chatId)?.title ?? '';
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

  run(chatId: ChatId, settings: ChatSettings, resume: boolean, events: ChatEvents): LiveChat {
    const run: FakeRun = {
      chatId,
      settings,
      resume,
      events,
      sent: [],
      sentIds: [],
      undone: [],
      interrupts: 0,
      configured: [],
      closed: false,
    };
    this.runs.push(run);
    return {
      send: (text, id) => {
        run.sent.push(text);
        run.sentIds.push(id);
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
