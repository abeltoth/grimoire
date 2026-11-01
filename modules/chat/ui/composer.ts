import {
  Component,
  ElementRef,
  computed,
  inject,
  input,
  linkedSignal,
  viewChild,
} from '@angular/core';
import type { ContextUsage, QueuedEntry } from '@grimoire/contract';
import { Icon } from '@ui/design-system/icon';
import { Chats } from '@ui/app/core/chats';

/**
 * The next page, tucked under the transcript: where you write the next
 * entry. Enter sends it; Shift+Enter starts a new line. What you send
 * while a turn runs waits above it until the turn ends.
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
  /** A blank chapter's composer: it takes the first entry. */
  readonly first = input(false);
  readonly queued = input<readonly QueuedEntry[]>([]);
  /** How full the context window is: the chapter's page allowance. */
  readonly context = input<ContextUsage>();

  /** The share of the allowance used, in percent; missing until the agent reports it. */
  protected readonly used = computed(() => {
    const context = this.context();
    return context?.limit ? Math.round((context.used / context.limit) * 100) : undefined;
  });

  private readonly entry = viewChild.required<ElementRef<HTMLTextAreaElement>>('entry');

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

  /** Puts messages back on the page, after what you're writing, to edit or send again. */
  takeBack(texts: readonly string[]): void {
    if (!texts.length) return;
    this.draft.update((draft) => [draft.trim(), ...texts].filter(Boolean).join('\n\n'));
    const entry = this.entry().nativeElement;
    entry.value = this.draft();
    entry.focus();
    entry.setSelectionRange(entry.value.length, entry.value.length);
  }

  protected async edit(queued: QueuedEntry): Promise<void> {
    if (await this.chats.unqueue(this.chapterId(), queued.id)) this.takeBack([queued.text]);
  }

  protected remove(queued: QueuedEntry): void {
    void this.chats.unqueue(this.chapterId(), queued.id);
  }
}
