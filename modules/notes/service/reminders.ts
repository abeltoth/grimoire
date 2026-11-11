import type { EventName, EventPayload, Note } from '@grimoire/contract';
import type { NoteStore } from './store';

type Emit = <K extends EventName>(event: K, payload: EventPayload<K>) => void;

/**
 * Tells every window of the notes when they change: after a command, and
 * when a reminder comes due, which a check every so often notices; a
 * reminder whose time passed while the service wasn't running is due as
 * soon as it's back.
 */
export class Reminders {
  /** The notes due as last told, by ID. */
  private told = '';

  constructor(
    private readonly store: NoteStore,
    private readonly emit: Emit,
  ) {}

  /** Tells every window of the notes, and returns them. */
  changed(notes: Note[] = this.store.list()): Note[] {
    this.told = dueIds(notes);
    this.emit('notes.changed', { notes });
    return notes;
  }

  /** Tells every window of the notes when the ones due aren't those last told. */
  check(): void {
    const notes = this.store.list();
    if (dueIds(notes) !== this.told) this.changed(notes);
  }

  /** Checks now and every `ms`, which also notices a time passed while the computer slept. */
  checkEvery(ms: number): () => void {
    this.check();
    const timer = setInterval(() => this.check(), ms);
    timer.unref();
    return () => clearInterval(timer);
  }
}

function dueIds(notes: Note[]): string {
  return notes
    .filter((note) => note.due)
    .map((note) => note.id)
    .join(' ');
}
