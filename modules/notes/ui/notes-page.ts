import { Component, inject, signal } from '@angular/core';
import type { Note } from '@grimoire/contract';
import { Wording } from '@ui/app/core/wording';
import { NoteForm } from './note-form';
import { NoteList } from './notes';
import { inAnHour, tomorrowMorning, whenLabel } from './when';

/**
 * Your notes, each a slip on the page: those whose reminder is due first,
 * edged in rubric with a quick snooze, then pinned ones, then the rest,
 * newest first. A note begins a chat with its text written in, goes on
 * the Kanban board as a task, or opens the chat whose agent made it.
 * Done notes are kept below, folded away, to open again.
 */
@Component({
  selector: 'gr-notes-page',
  imports: [NoteForm],
  templateUrl: './notes-page.html',
  styleUrl: './notes-page.css',
})
export class NotesPage {
  protected readonly notes = inject(NoteList);
  protected readonly wording = inject(Wording);

  /** The note written out to change. */
  protected readonly editing = signal<string | null>(null);
  protected readonly showDone = signal(false);

  /** What a note's reminder line says: when it's due, or was. */
  protected reminderLine(note: Note): string {
    const when = whenLabel(note.remindAt!, Date.now());
    return note.due ? `Due ${when}` : `Reminds you ${when}`;
  }

  protected snooze(note: Note, until: 'hour' | 'tomorrow'): void {
    const now = Date.now();
    void this.notes.remind(note, until === 'hour' ? inAnHour(now) : tomorrowMorning(now));
  }
}
