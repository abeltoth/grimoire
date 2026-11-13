import type { AgentId, ChatId, Entry } from '@grimoire/contract';
import type { LabelStore } from './label-store';
import { type Wanted, chatText, labelPrompt, readLabels } from './prompt';

/** A chat to label: whose it is, where it works, and its title now. */
export interface ChatToLabel {
  id: ChatId;
  agent: AgentId;
  cwd: string;
  title: string;
}

/** Which labels Settings asks for. */
export interface LabelSettings {
  autoTitles: boolean;
  autoTags: boolean;
  autoSummaries: boolean;
}

/** What labelling needs of the agents and of the History, through the hub and commands. */
export interface LabelSources {
  transcript(agent: AgentId, chatId: ChatId, cwd: string): Promise<Entry[]>;
  ask(agent: AgentId, instructions: string, text: string, signal: AbortSignal): Promise<string>;
  rename(chatId: ChatId, title: string): Promise<void>;
  tagsOf(chatId: ChatId): Promise<readonly string[]>;
  setTags(chatId: ChatId, tags: readonly string[]): Promise<void>;
  setSummary(chatId: ChatId, summary: string): Promise<void>;
  tagList(): Promise<readonly string[]>;
}

/** After how many of your messages a chat is labelled again: every this many. */
export const EVERY = 5;
/** How long the model may take over one chat's labels. */
const ASK_TIMEOUT_MS = 60_000;

/** Whether a chat with this many of your messages is due its labels: after the first, then every few. */
export function due(turns: number): boolean {
  return turns === 1 || (turns > 0 && turns % EVERY === 0);
}

/**
 * Labels chats on the agent's model for quick jobs, as Settings asks: a
 * title, never over one you gave; tags from your tag list, never one you
 * took off; and a summary. One chat at a time.
 */
export class Labeller {
  private queue: Promise<void> = Promise.resolve();
  private readonly waiting = new Set<ChatId>();
  private readonly stopping = new AbortController();

  constructor(
    private readonly sources: LabelSources,
    private readonly store: LabelStore,
    private readonly settings: () => LabelSettings,
    private readonly log: (message: string) => void,
  ) {}

  /** Whether Settings asks for any label at all. */
  on(): boolean {
    const { autoTitles, autoTags, autoSummaries } = this.settings();
    return autoTitles || autoTags || autoSummaries;
  }

  /** A turn ended in the chat: it's labelled if it's due, after any chat before it. */
  turnEnded(chat: ChatToLabel): void {
    if (!this.on() || this.waiting.has(chat.id)) return;
    this.waiting.add(chat.id);
    void this.enqueue(async () => {
      this.waiting.delete(chat.id);
      await this.label(chat, false);
    });
  }

  /** Labels a past chat never labelled, whatever its count of messages; settles once it's done. */
  labelPast(chat: ChatToLabel): Promise<void> {
    return this.enqueue(() => this.label(chat, true));
  }

  /** The chat's tags changed: any added here that are gone, you took off. */
  tagsNow(chatId: ChatId, tags: readonly string[]): void {
    this.store.tagsNow(chatId, tags);
  }

  /** Settles once every chat queued so far is labelled. */
  settled(): Promise<void> {
    return this.queue;
  }

  /** Stops the chat under way and any waiting. */
  stop(): void {
    this.stopping.abort();
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.queue.then(async () => {
      if (this.stopping.signal.aborted) return;
      await job().catch((error: unknown) =>
        this.log(
          `Couldn't label a chat: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    });
    this.queue = run;
    return run;
  }

  private async label(chat: ChatToLabel, past: boolean): Promise<void> {
    const settings = this.settings();
    const entries = await this.sources.transcript(chat.agent, chat.id, chat.cwd);
    const turns = entries.filter((entry) => entry.kind === 'user').length;
    const before = this.store.labelled(chat.id);
    if (!turns || (past ? before : !due(turns) || (before && before.turns >= turns))) return;
    const wanted: Wanted = {
      // A title you gave stays.
      title: settings.autoTitles && !this.store.isNamedByYou(chat.id),
      summary: settings.autoSummaries,
      tags: settings.autoTags ? await this.sources.tagList() : [],
    };
    if (!wanted.title && !wanted.summary && !wanted.tags.length) {
      this.store.label(chat.id, turns);
      return;
    }
    const signal = AbortSignal.any([this.stopping.signal, AbortSignal.timeout(ASK_TIMEOUT_MS)]);
    const answer = await this.sources.ask(
      chat.agent,
      labelPrompt(wanted),
      chatText(chat.title, entries),
      signal,
    );
    const labels = readLabels(answer, wanted);
    let title: string | undefined;
    if (labels.title && labels.title !== chat.title) {
      await this.sources.rename(chat.id, labels.title);
      title = labels.title;
    }
    if (labels.summary) await this.sources.setSummary(chat.id, labels.summary);
    if (labels.tags.length) await this.addTags(chat.id, labels.tags);
    this.store.label(chat.id, turns, title);
  }

  /** Adds the tags the chat hasn't got, but not those you took off it. */
  private async addTags(chatId: ChatId, tags: readonly string[]): Promise<void> {
    const has = await this.sources.tagsOf(chatId);
    const kept = new Set(has.map((tag) => tag.toLowerCase()));
    const refused = this.store.refused(chatId);
    const adding = tags.filter(
      (tag) => !kept.has(tag.toLowerCase()) && !refused.has(tag.toLowerCase()),
    );
    if (!adding.length) return;
    await this.sources.setTags(chatId, [...has, ...adding]);
    this.store.added(chatId, adding);
  }
}
