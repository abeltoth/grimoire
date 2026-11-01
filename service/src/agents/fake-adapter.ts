import type {
  AgentInfo,
  AgentModels,
  ChatId,
  ChatSettings,
  ChatSummary,
  Entry,
  SettingsChange,
} from '@grimoire/contract';
import type { AgentAdapter, ChatEvents, LiveChat } from './adapter';

/** A run of the fake agent, which a test drives through `events`. */
export interface FakeRun {
  chatId: ChatId;
  settings: ChatSettings;
  resume: boolean;
  events: ChatEvents;
  sent: string[];
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
  transcriptLoads = 0;

  async listChats(cwd?: string): Promise<ChatSummary[]> {
    return this.chats.filter((chat) => !cwd || chat.cwd === cwd);
  }

  async transcript(chatId: ChatId): Promise<Entry[]> {
    this.transcriptLoads++;
    return structuredClone(this.transcripts.get(chatId) ?? []);
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

  run(chatId: ChatId, settings: ChatSettings, resume: boolean, events: ChatEvents): LiveChat {
    const run: FakeRun = {
      chatId,
      settings,
      resume,
      events,
      sent: [],
      interrupts: 0,
      configured: [],
      closed: false,
    };
    this.runs.push(run);
    return {
      send: (text) => void run.sent.push(text),
      interrupt: async () => void run.interrupts++,
      configure: async (change) => void run.configured.push(change),
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
