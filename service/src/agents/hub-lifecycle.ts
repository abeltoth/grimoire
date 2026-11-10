import type { ChatId } from '@grimoire/contract';
import type { Accounts } from './accounts';
import type { Approvals } from './approvals';
import type { ChatTable, HubStore } from './chat-table';
import type { Editors } from './editors';

/**
 * How the hub puts its open chats away: one when you close it, all of
 * them when another profile is put in use or the service stops, and only
 * once none of them is busy.
 */
export class HubLifecycle {
  constructor(
    private readonly table: ChatTable,
    private readonly store: HubStore,
    private readonly approvals: Approvals,
    private readonly editors: Editors,
    private readonly accounts: Accounts,
  ) {}

  /**
   * Closes an open chat: it's no longer open after a restart. When it
   * edited, the chat sent in parallel with it opened first after it edits from now on.
   */
  close(chatId: ChatId): void {
    this.store.chats.remove(chatId);
    this.release(chatId);
    this.editors.settle();
  }

  /** Stops every chat and spare process, for when the service stops; chats reopen when it starts again. */
  closeAll(): void {
    this.accounts.cancelAll();
    this.putAway();
    for (const adapter of this.table.adapters.values()) adapter.dispose?.();
  }

  /**
   * Why the open chats can't be put away now, naming those that are busy:
   * a turn runs or an approval waits in them, or a sign-in is under way.
   * Undefined when they can.
   */
  busy(): string | undefined {
    if (this.accounts.signingIn()) return 'A sign-in is under way: finish or cancel it first';
    const busy = [...this.table.chats.values()].filter(
      (chat) => chat.status !== 'idle' || this.approvals.has(chat),
    );
    if (!busy.length) return undefined;
    const names = busy
      .map((chat) => (chat.title ? `"${chat.title}"` : 'an untitled chat'))
      .join(', ');
    return `Wait for ${names} to finish, or stop ${busy.length === 1 ? 'it' : 'them'}, first`;
  }

  /**
   * Stops every open chat's process and forgets the chats, but keeps their
   * chats, as when another profile is put in use: they reopen when it's
   * back. Who the agents were signed in as is forgotten too.
   */
  putAway(): void {
    for (const id of [...this.table.chats.keys()]) this.release(id);
    this.accounts.forget();
  }

  private release(chatId: ChatId): void {
    const chat = this.table.chats.get(chatId);
    if (!chat) return;
    this.table.chats.delete(chatId);
    this.approvals.denyAll(chat);
    chat.live?.close();
    clearTimeout(chat.flushTimer);
  }
}
