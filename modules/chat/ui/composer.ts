import { Component, inject, input, linkedSignal } from '@angular/core';
import { Icon } from '@ui/design-system/icon';
import { Chats } from '@ui/app/core/chats';

/**
 * The next page, tucked under the transcript: where you write the next
 * entry. Enter sends it; Shift+Enter starts a new line.
 */
@Component({
  selector: 'gr-composer',
  imports: [Icon],
  templateUrl: './composer.html',
  styleUrl: './composer.css',
  host: { role: 'region', 'aria-label': 'Next page' },
})
export class Composer {
  private readonly chats = inject(Chats);

  readonly chapterId = input.required<string>();

  /** What you're writing; a fresh page for each chapter. */
  protected readonly draft = linkedSignal({ source: this.chapterId, computation: () => '' });

  protected enter(event: Event, entry: HTMLTextAreaElement): void {
    const key = event as KeyboardEvent;
    if (key.shiftKey || key.isComposing) return;
    key.preventDefault();
    this.send(entry);
  }

  protected send(entry: HTMLTextAreaElement): void {
    const text = entry.value.trim();
    if (!text) return;
    // Cleared on the element too: Enter can come before the last keystroke is rendered.
    entry.value = '';
    this.draft.set('');
    void this.chats.send(this.chapterId(), text);
  }
}
