import { Injectable, type WritableSignal, computed, inject, signal } from '@angular/core';
import type { ChatId, Mark } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { ChatList } from '@ui/app/core/chat-list';
import { NewChats } from '@ui/app/core/new-chats';
import { keptTags, tagsOf } from './chat-groups';

/**
 * Which chats are pinned or starred, your tags for them, your tag list
 * and each chat's summary, as the service keeps them. A blank chat's tags stay here until it
 * begins, then go to its chat.
 */
@Injectable({ providedIn: 'root' })
export class PinsAndTags {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly list = inject(ChatList);
  private readonly newChats = inject(NewChats);
  private readonly pinned = signal<ReadonlyMap<ChatId, readonly Mark[]>>(new Map());
  private readonly tagged = signal<ReadonlyMap<ChatId, readonly string[]>>(new Map());
  private readonly summaries = signal<ReadonlyMap<ChatId, string>>(new Map());
  /** Your tag list, in your order. */
  readonly tagList = signal<readonly string[]>([]);
  /** Every tag there is to pick: your list in its order, then the others chats have, alphabetically. */
  readonly known = computed(() => {
    const listed = new Set(this.tagList().map((tag) => tag.toLowerCase()));
    const used = tagsOf([...this.tagged().values()].map((tags) => ({ tags })));
    return [...this.tagList(), ...used.filter((tag) => !listed.has(tag.toLowerCase()))];
  });

  constructor() {
    this.bridge.on('history.pins', ({ chatId, pins }) => put(this.pinned, chatId, pins));
    this.bridge.on('history.tags', ({ chatId, tags }) => put(this.tagged, chatId, tags));
    this.bridge.on('history.tagListChanged', ({ tags }) => this.tagList.set(tags));
    this.bridge.on('history.summary', ({ chatId, summary }) =>
      this.summaries.update((all) => {
        const next = new Map(all);
        if (summary) next.set(chatId, summary);
        else next.delete(chatId);
        return next;
      }),
    );
    this.newChats.onBegun((blankId, chat) => {
      const tags = this.tags(blankId);
      put(this.tagged, blankId, []);
      if (tags.length)
        this.tag(chat.id, tags).catch((error: unknown) => this.list.fail(chat.id, error));
    });
    void this.load();
  }

  pins(chatId: ChatId): readonly Mark[] {
    return this.pinned().get(chatId) ?? [];
  }

  /** A chat's tags, in the order you added them. */
  tags(chatId: ChatId): readonly string[] {
    return this.tagged().get(chatId) ?? [];
  }

  /** Puts a mark on a chat, or takes it off; it shows once the service has kept it. */
  pin(chatId: ChatId, mark: Mark, on: boolean): Promise<void> {
    return this.bridge.invoke('history.pin', { chatId, mark, on });
  }

  /**
   * Sets a chat's tags as they're kept: trimmed, without blanks, each once
   * whatever its case. They show at once, and go back if the service can't
   * keep them.
   */
  async tag(chatId: ChatId, tags: readonly string[]): Promise<void> {
    const before = this.tags(chatId);
    const kept = keptTags(tags);
    if (kept.join('\n') === before.join('\n')) return;
    put(this.tagged, chatId, kept);
    if (this.list.all().find((chat) => chat.id === chatId)?.status === 'blank') return;
    try {
      await this.bridge.invoke('history.tag', { chatId, tags: kept });
    } catch (error) {
      put(this.tagged, chatId, before);
      throw error;
    }
  }

  /** A line on what the chat is about; undefined when it has none. */
  summary(chatId: ChatId): string | undefined {
    return this.summaries().get(chatId);
  }

  /** Sets a chat's summary; it shows once the service has kept it. */
  setSummary(chatId: ChatId, summary: string): Promise<void> {
    return this.bridge.invoke('history.setSummary', { chatId, summary });
  }

  /** Sets your tag list; it shows once the service has kept it. */
  setList(tags: readonly string[]): Promise<void> {
    return this.bridge.invoke('history.setTagList', { tags: [...tags] });
  }

  /** Names a tag anew on every chat and in your list, merging it where both are. */
  rename(from: string, to: string): Promise<void> {
    return this.bridge.invoke('history.renameTag', { from, to });
  }

  /** A service that can't answer leaves every chat without pins, tags or summary, and the list empty. */
  private async load(): Promise<void> {
    const [{ pins, tags, summaries }, list] = await Promise.all([
      this.bridge
        .invoke('history.pinsAndTags', {})
        .catch(() => ({ pins: {}, tags: {}, summaries: {} })),
      this.bridge.invoke('history.tagList', {}).catch(() => []),
    ]);
    this.pinned.set(new Map(Object.entries(pins)));
    this.tagged.set(new Map(Object.entries(tags)));
    this.summaries.set(new Map(Object.entries(summaries ?? {})));
    this.tagList.set(list ?? []);
  }
}

/** Sets a chat's list in one of the maps; an empty one leaves it out. */
function put<T>(
  map: WritableSignal<ReadonlyMap<ChatId, readonly T[]>>,
  chatId: ChatId,
  list: readonly T[],
): void {
  map.update((all) => {
    const next = new Map(all);
    if (list.length) next.set(chatId, list);
    else next.delete(chatId);
    return next;
  });
}
