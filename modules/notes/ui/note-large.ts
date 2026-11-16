import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import type { Note } from '@grimoire/contract';
import { NoteList } from './notes';

/**
 * A note opened large over the page, to read it whole; a click beside it
 * or Escape puts it away.
 */
@Component({
  selector: 'gr-note-large',
  templateUrl: './note-large.html',
  styleUrl: './note-large.css',
})
export class NoteLarge {
  private readonly notes = inject(NoteList);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly shown = signal<string | null>(null);

  /** The note as the list has it now, so a change made while it's open shows. */
  protected readonly note = computed(() => {
    const id = this.shown();
    return this.notes.all()?.find((note) => note.id === id) ?? null;
  });

  open(note: Note): void {
    this.shown.set(note.id);
    this.dialog().nativeElement.showModal();
  }

  /** Only a click on the backdrop closes it, so its text can be selected. */
  protected closeBeside(event: MouseEvent): void {
    const dialog = this.dialog().nativeElement;
    if (event.target === dialog) dialog.close();
  }
}
