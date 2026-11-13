import type { Editor } from '@grimoire/contract';
import type { Emit } from '../events';
import type { ChatState, ChatTable, HubStore } from './chat-table';

/**
 * Which of the open chats sent one entry in parallel edits: the
 * one kept for them while that's open, else the one opened first. The
 * others only read; a chat sent in parallel with none open edits, as does
 * any other chat.
 */
export class Editors {
  constructor(
    private readonly emit: Emit,
    private readonly table: ChatTable,
    private readonly store: HubStore,
  ) {}

  /** Gives the open chats sent one entry in parallel one chat that edits; each chat that changed hears so. */
  settle(): void {
    const order = this.store.chats.list().map((chat) => chat.chatId);
    const place = (chat: ChatState) =>
      order.includes(chat.id) ? order.indexOf(chat.id) : order.length;
    const groups = new Map<string, ChatState[]>();
    for (const chat of this.table.chats.values()) {
      const group = this.store.parallels.groupOf(chat.id);
      groups.set(group, [...(groups.get(group) ?? []), chat]);
    }
    for (const [group, chats] of groups) {
      const kept = this.store.parallels.editorOf(group);
      const editor =
        chats.find((chat) => chat.id === kept) ??
        chats.reduce((first, chat) => (place(chat) < place(first) ? chat : first));
      // Kept only for chats sent in parallel; a chat on its own edits without.
      const parallel = kept !== undefined || chats.length > 1 || group !== editor.id;
      if (parallel && editor.id !== kept) this.store.parallels.setEditor(group, editor.id);
      for (const chat of chats) {
        const by = chat === editor ? undefined : editor.id;
        if (chat.editor === by) continue;
        chat.editor = by;
        this.emit('agents.readOnly', { chatId: chat.id, readOnly: this.readOnlyOf(chat) ?? null });
      }
    }
  }

  /** Makes the chat the one that edits of those sent in parallel: the chat that edited only reads from now on. */
  takeOver(chat: ChatState): void {
    this.store.parallels.setEditor(this.store.parallels.groupOf(chat.id), chat.id);
    this.settle();
  }

  /** The chat that edits in place of one that only reads; undefined for a chat that edits. */
  readOnlyOf(chat: ChatState): Editor | undefined {
    return chat.editor
      ? { chatId: chat.editor, title: this.table.chats.get(chat.editor)?.title ?? '' }
      : undefined;
  }

  /** The chats that only read while this one edits hear its new title. */
  retitled(chat: ChatState): void {
    for (const reader of this.table.chats.values()) {
      const readOnly = reader.editor === chat.id && this.readOnlyOf(reader);
      if (readOnly) this.emit('agents.readOnly', { chatId: reader.id, readOnly });
    }
  }

  /** Who edits in place of a chat that only reads, as what it's told says. */
  editing(chat: ChatState): string {
    const title = chat.editor && this.table.chats.get(chat.editor)?.title;
    return `${title ? `"${title}"` : 'Another chat'} is editing this project`;
  }
}
