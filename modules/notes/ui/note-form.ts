import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import type { Note } from '@grimoire/contract';
import { NoteList } from './notes';
import { fromInput, inAnHour, toInput, tomorrowMorning } from './when';

/**
 * A note written out to save, in its place on the page: its text, and
 * when to be reminded of it, picked from a few quick times or set to the
 * minute. Ctrl+Enter (⌘+Enter on a Mac) saves; Escape puts it away.
 */
@Component({
  selector: 'gr-note-form',
  templateUrl: './note-form.html',
  styleUrl: './note-form.css',
})
export class NoteForm {
  /** The note changed; a new one when left out. */
  readonly note = input<Note>();
  /** Saved, or put away. */
  readonly done = output<void>();

  private readonly notes = inject(NoteList);

  protected readonly text = linkedSignal(() => this.note()?.text ?? '');
  /** The reminder as the field holds it, "2026-11-14T09:00"; empty for none. */
  protected readonly remindAt = linkedSignal(() => {
    const at = this.note()?.remindAt;
    return at === undefined ? '' : toInput(at);
  });
  protected readonly saving = signal(false);
  protected readonly complete = computed(() => !!this.text().trim());

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => host.querySelector<HTMLTextAreaElement>('.text')?.focus());
  }

  protected inAnHour(): void {
    this.remindAt.set(toInput(inAnHour(Date.now())));
  }

  protected tomorrow(): void {
    this.remindAt.set(toInput(tomorrowMorning(Date.now())));
  }

  protected saveOnShortcut(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    void this.save();
  }

  protected async save(): Promise<void> {
    if (!this.complete() || this.saving()) return;
    this.saving.set(true);
    try {
      const at = fromInput(this.remindAt());
      const note = this.note();
      const saved = await this.notes.save({
        ...(note ? { id: note.id } : {}),
        text: this.text(),
        pinned: note?.pinned ?? false,
        ...(at !== undefined ? { remindAt: at } : {}),
      });
      if (saved) this.done.emit();
    } finally {
      this.saving.set(false);
    }
  }
}
