import { Injectable, type WritableSignal, inject, signal } from '@angular/core';
import type { ChatId, Mark } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';
import { keptTags } from './chat-groups';

/**
 * Which chats are pinned or starred, and your tags for them, as the
 * service keeps them (ADR-009). A blank chat's tags stay here until it
 * begins, then go to its chat.
 */
@Injectable({ providedIn: 'root' })
export class PinsAndTags {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly chats = inject(Chats);
  private readonly pinned = signal<ReadonlyMap<ChatId, readonly Mark[]>>(new Map());
  private readonly tagged = signal<ReadonlyMap<ChatId, readonly string[]>>(new Map());

  constructor() {
    this.bridge.on('history.pins', ({ chatId, pins }) => put(this.pinned, chatId, pins));
    this.bridge.on('history.tags', ({ chatId, tags }) => put(this.tagged, chatId, tags));
    this.chats.onBegun((blankId, chat) => {
      const tags = this.tags(blankId);
      put(this.tagged, blankId, []);
      if (tags.length) this.tag(chat.id, tags).catch((error: unknown) => this.chats.fail(chat.id, error));
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
    if (this.chats.all().find((chat) => chat.id === chatId)?.status === 'blank') return;
    try {
      await this.bridge.invoke('history.tag', { chatId, tags: kept });
    } catch (error) {
      put(this.tagged, chatId, before);
      throw error;
    }
  }

  /** A service that can't answer leaves every chat without pins or tags. */
  private async load(): Promise<void> {
    const { pins, tags } = await this.bridge
      .invoke('history.pinsAndTags', {})
      .catch(() => ({ pins: {}, tags: {} }));
    this.pinned.set(new Map(Object.entries(pins)));
    this.tagged.set(new Map(Object.entries(tags)));
  }
}

/** Sets a chat's list in one of the maps; an empty one leaves it out. */
function put<T>(map: WritableSignal<ReadonlyMap<ChatId, readonly T[]>>, chatId: ChatId, list: readonly T[]): void {
  map.update((all) => {
    const next = new Map(all);
    if (list.length) next.set(chatId, list);
    else next.delete(chatId);
    return next;
  });
}
