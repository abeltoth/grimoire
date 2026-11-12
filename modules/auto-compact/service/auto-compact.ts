import type { AgentCapability, ChatId, ChatStatus, PromptCache } from '@grimoire/contract';

/** How long before the cache runs out a chat is compacted: room for the compaction's first request to still read it. */
export const LEAD_MS = 90_000;

/** The smallest context worth compacting: below it, re-reading the whole chat costs little. */
export const MIN_TOKENS = 40_000;

/** The open chats, as the hub shows them. */
export interface Chats {
  glance(
    chatId: ChatId,
  ):
    | { status: ChatStatus; capabilities: readonly AgentCapability[]; cache?: PromptCache }
    | undefined;
  send(chatId: ChatId, text: string): void;
}

/**
 * Compacts an idle open chat shortly before its prompt cache runs out,
 * while `on` says so, so the compaction reads the chat from the cache and
 * going on later re-reads only the summary.
 */
export class AutoCompact {
  /** The cache each chat's last turn left. */
  private readonly caches = new Map<ChatId, PromptCache>();
  private readonly timers = new Map<ChatId, ReturnType<typeof setTimeout>>();
  /** Chats compacted here with nothing written since, so another compaction would only sum up the summary. */
  private readonly compacted = new Set<ChatId>();

  constructor(
    private readonly chats: Chats,
    private readonly on: () => boolean,
    private readonly log: (message: string) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** A turn left this in the chat's cache. */
  cached(chatId: ChatId, cache: PromptCache): void {
    this.caches.set(chatId, cache);
    this.schedule(chatId);
  }

  /** You wrote in the chat: it's worth compacting again. */
  wrote(chatId: ChatId, text: string): void {
    if (text.trim() !== '/compact') this.compacted.delete(chatId);
  }

  /** The setting may have changed: the chats are planned again. */
  reconsider(): void {
    for (const chatId of this.caches.keys()) this.schedule(chatId);
  }

  /** The chats were put away, as when another profile is put in use or the service stops. */
  forget(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.caches.clear();
    this.compacted.clear();
  }

  private schedule(chatId: ChatId): void {
    clearTimeout(this.timers.get(chatId));
    this.timers.delete(chatId);
    const cache = this.caches.get(chatId);
    if (!cache || !this.on() || cache.tokens < MIN_TOKENS || this.compacted.has(chatId)) return;
    const delay = cache.until - LEAD_MS - this.now();
    if (delay <= 0) return;
    this.timers.set(
      chatId,
      setTimeout(() => this.fire(chatId, cache), delay),
    );
  }

  private fire(chatId: ChatId, cache: PromptCache): void {
    this.timers.delete(chatId);
    const chat = this.chats.glance(chatId);
    if (!chat) {
      this.caches.delete(chatId);
      this.compacted.delete(chatId);
      return;
    }
    // A timer can fire late, as after the computer slept: once the cache has run out, compacting saves nothing.
    if (
      !this.on() ||
      chat.status !== 'idle' ||
      !chat.capabilities.includes('compact') ||
      chat.cache?.until !== cache.until ||
      this.now() >= cache.until
    )
      return;
    this.compacted.add(chatId);
    try {
      this.chats.send(chatId, '/compact');
      this.log(`Compacting chat ${chatId} before its prompt cache runs out`);
    } catch (error) {
      this.log(`Couldn't compact chat ${chatId}: ${(error as Error).message}`);
    }
  }
}
