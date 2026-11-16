import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { Note } from '@grimoire/contract';
import { NoteList } from './notes';

/**
 * A note opened large over the page, with what the page puts in it: the
 * note written out to change, and its buttons. A click beside it or
 * Escape puts it away, and so does the note being done or deleted.
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

  /** The open note as the list has it now, so a change made while it's large shows. */
  readonly note = computed(() => {
    const id = this.shown();
    const note = this.notes.all()?.find((n) => n.id === id);
    return note && note.doneAt === undefined ? note : null;
  });

  constructor() {
    effect(() => {
      if (this.shown() && !this.note()) untracked(() => this.close());
    });
  }

  open(note: Note): void {
    this.shown.set(note.id);
    this.dialog().nativeElement.showModal();
  }

  close(): void {
    const dialog = this.dialog().nativeElement;
    if (dialog.hasAttribute('open')) dialog.close();
  }

  /** Only a click on the backdrop closes it, so a click in the note doesn't. */
  protected closeBeside(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.close();
  }
}
