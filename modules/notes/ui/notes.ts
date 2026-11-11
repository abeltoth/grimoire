import { Injectable, computed, inject, signal } from '@angular/core';
import type { Note, NoteChat, NoteDraft } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { ChatList } from '@ui/app/core/chat-list';
import { NewChats } from '@ui/app/core/new-chats';

/** A note's first line, which names it, and the rest under it. */
export function splitNote(text: string): { title: string; rest: string } {
  const [first = '', ...rest] = text.trim().split('\n');
  return { title: first.trim(), rest: rest.join('\n').trim() };
}

/**
 * The notes, as the window sees them: a mirror of the service's, kept
 * current by its events. A note can begin a chat with its text written
 * in, open the chat it was made in, or go on the Kanban board as a task,
 * which marks it done.
 */
@Injectable({ providedIn: 'root' })
export class NoteList {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly list = inject(ChatList);
  private readonly newChats = inject(NewChats);
  private readonly catalog = inject(AgentCatalog);

  /** Every note as the service listed it last; undefined until it has. */
  readonly all = signal<readonly Note[] | undefined>(undefined);
  /** Why the last change failed, until the next one. */
  readonly failed = signal<string | null>(null);
  /** Whether a new note is being written, asked for from anywhere with New note. */
  readonly composing = signal(false);

  /** The notes not done: those due first, soonest due first, then pinned ones, then the rest, newest first. */
  readonly open = computed(() => {
    const open = (this.all() ?? []).filter((note) => note.doneAt === undefined);
    const rank = (note: Note) => (note.due ? 0 : note.pinned ? 1 : 2);
    return open
      .map((note, at) => ({ note, at }))
      .sort(
        (a, b) =>
          rank(a.note) - rank(b.note) ||
          (a.note.due && b.note.due ? a.note.remindAt! - b.note.remindAt! : a.at - b.at),
      )
      .map(({ note }) => note);
  });
  readonly done = computed(() => (this.all() ?? []).filter((note) => note.doneAt !== undefined));
  readonly due = computed(() => this.open().filter((note) => note.due));
  /** The notes not done that the chat you're on made. */
  readonly ofCurrentChat = computed(() => {
    const id = this.list.currentId();
    return id ? this.open().filter((note) => note.madeIn?.chatId === id) : [];
  });

  constructor() {
    this.bridge.on('notes.changed', ({ notes }) => this.all.set(notes));
    void this.load();
  }

  async load(): Promise<void> {
    try {
      const notes = await this.bridge.invoke('notes.list', {});
      if (notes) this.all.set(notes);
    } catch (error) {
      this.fail(error);
    }
  }

  /** Saves a note; false when the service turned it away, and why shows. */
  save(draft: NoteDraft): Promise<boolean> {
    return this.change(() => this.bridge.invoke('notes.save', draft));
  }

  /** Pins a note above the others, or unpins it. */
  pin(note: Note, pinned: boolean): Promise<boolean> {
    return this.save({ ...draftOf(note), pinned });
  }

  /** Sets a note's reminder, or clears it when `at` is left out. */
  remind(note: Note, at?: number): Promise<boolean> {
    const { remindAt: _, ...draft } = draftOf(note);
    return this.save({ ...draft, ...(at !== undefined ? { remindAt: at } : {}) });
  }

  markDone(id: string, done: boolean): Promise<boolean> {
    return this.change(() => this.bridge.invoke('notes.done', { id, done }));
  }

  remove(id: string): Promise<boolean> {
    return this.change(() => this.bridge.invoke('notes.remove', { id }));
  }

  /**
   * Opens a new chat with the note's text written in, not sent, in the
   * folder of the chat it was made in, or where new chats begin.
   */
  newChat(note: Note): void {
    const { agent, settings } = this.newChats.startOf();
    const cwd = note.madeIn?.cwd ?? settings.cwd;
    this.list.newChat({
      agent,
      settings: { ...settings, ...(cwd ? { cwd } : {}) },
      prompt: note.text,
    });
  }

  /** Turns to the chat a note was made in, opening it again when it was closed. */
  async openChat(chat: NoteChat): Promise<void> {
    if (this.list.has(chat.chatId)) return this.list.open(chat.chatId);
    await this.list.openChat({
      id: chat.chatId,
      agent: chat.agent,
      title: '',
      cwd: chat.cwd,
      updatedAt: 0,
    });
  }

  /**
   * Puts the note on the Kanban board as a task, its first line the title
   * and the rest its notes, in the folder of the chat it was made in, or
   * the chat you're on's; then marks the note done.
   */
  async toKanban(note: Note): Promise<boolean> {
    const { title, rest } = splitNote(note.text);
    const cwd =
      note.madeIn?.cwd ?? this.list.current()?.settings.cwd ?? this.catalog.folders().home;
    this.failed.set(null);
    try {
      await this.bridge.invoke('kanban.save', { title, notes: rest, cwd });
    } catch (error) {
      this.fail(error);
      return false;
    }
    return this.markDone(note.id, true);
  }

  private async change(request: () => Promise<Note[]>): Promise<boolean> {
    this.failed.set(null);
    try {
      this.all.set(await request());
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }

  private fail(error: unknown): void {
    this.failed.set(error instanceof Error ? error.message : String(error));
  }
}

/** A note as it's saved again, its reminder kept. */
function draftOf(note: Note): NoteDraft {
  return {
    id: note.id,
    text: note.text,
    pinned: note.pinned,
    ...(note.remindAt !== undefined ? { remindAt: note.remindAt } : {}),
  };
}
