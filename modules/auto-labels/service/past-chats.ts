import { homedir } from 'node:os';
import type { AgentCapability, AgentId, ChatSummary, LabelProgress } from '@grimoire/contract';
import type { LabelStore } from './label-store';
import type { ChatToLabel, Labeller } from './labeller';
import { SUGGEST_PROMPT, readSuggestions, titlesText } from './prompt';

/** What labelling past chats needs of the agents, through the hub. */
export interface PastSources {
  agents(): readonly { id: AgentId; capabilities: readonly AgentCapability[] }[];
  listChats(agent: AgentId): Promise<ChatSummary[]>;
  ask(agent: AgentId, instructions: string, text: string, signal: AbortSignal): Promise<string>;
}

/** How long the model may take to suggest tags. */
const SUGGEST_TIMEOUT_MS = 60_000;

/**
 * Your past chats, labelled when you ask: those never labelled, one at a
 * time, telling how far it's come; and tags suggested from their titles.
 */
export class PastChats {
  private progress: LabelProgress = { done: 0, total: 0, running: false };
  private stopped = false;

  constructor(
    private readonly sources: PastSources,
    private readonly labeller: Labeller,
    private readonly store: LabelStore,
    private readonly told: (progress: LabelProgress) => void,
  ) {}

  where(): LabelProgress {
    return this.progress;
  }

  async count(): Promise<number> {
    return (await this.unlabelled()).length;
  }

  /** Labels every past chat never labelled, unless that's under way; settles once it's done or stopped. */
  async start(): Promise<void> {
    if (this.progress.running) return;
    this.stopped = false;
    this.tell({ done: 0, total: 0, running: true });
    const chats = await this.unlabelled().catch(() => []);
    this.tell({ done: 0, total: chats.length, running: true });
    for (const [i, chat] of chats.entries()) {
      if (this.stopped) break;
      await this.labeller.labelPast(chat);
      this.tell({ done: i + 1, total: chats.length, running: true });
    }
    this.tell({ ...this.progress, running: false });
  }

  /** Stops after the chat under way. */
  stop(): void {
    this.stopped = true;
  }

  /** Tags that would sort your chats, from their titles, newest first; none when no agent can say. */
  async suggest(): Promise<string[]> {
    const agent = this.askers()[0];
    if (!agent) return [];
    const chats = await this.chats();
    const answer = await this.sources.ask(
      agent,
      SUGGEST_PROMPT,
      titlesText(chats.map((chat) => chat.title)),
      AbortSignal.timeout(SUGGEST_TIMEOUT_MS),
    );
    return readSuggestions(answer);
  }

  private askers(): AgentId[] {
    return this.sources
      .agents()
      .filter((agent) => agent.capabilities.includes('ask'))
      .map((agent) => agent.id);
  }

  /** Every chat of the agents that answer prompts, newest first. */
  private async chats(): Promise<ChatSummary[]> {
    const lists = await Promise.all(
      this.askers().map((agent) => this.sources.listChats(agent).catch(() => [])),
    );
    return lists.flat().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private async unlabelled(): Promise<ChatToLabel[]> {
    const labelled = this.store.all();
    return (await this.chats())
      .filter((chat) => !labelled.has(chat.id))
      .map((chat) => ({
        id: chat.id,
        agent: chat.agent,
        cwd: chat.cwd ?? homedir(),
        title: chat.title,
      }));
  }

  private tell(progress: LabelProgress): void {
    this.progress = progress;
    this.told(progress);
  }
}
