import {
  Component,
  booleanAttribute,
  computed,
  input,
  numberAttribute,
  output,
} from '@angular/core';

/** The chat tab's colour: the chat's status, or the approvals and New chat tabs. */
export type ChatTabTone = 'open' | 'thinking' | 'waiting' | 'idle' | 'approval' | 'new';

/**
 * A chat tab marker hanging from the book's foot. Its icon goes inside; its
 * heading and meta are read out, and shown on a label when you point at it.
 */
@Component({
  selector: 'gr-chat-tab',
  templateUrl: './chat-tab.html',
  styleUrl: './chat-tab.css',
  host: {
    '[attr.data-tone]': 'tone()',
    '[class.right]': "side() === 'right'",
    '[class.current]': 'current()',
    '[class.beside]': 'beside()',
    '[class.sheen]': "current() && tone() === 'open'",
  },
})
export class ChatTab {
  /** Which side of the spine the chat tab hangs on; its label lies toward the spine. */
  readonly side = input.required<'left' | 'right'>();
  readonly tone = input.required<ChatTabTone>();
  readonly heading = input.required<string>();
  readonly meta = input.required<string>();
  /** The chat on the open spread. */
  readonly current = input(false, { transform: booleanAttribute });
  /** The chat on the right page, beside the open one. */
  readonly beside = input(false, { transform: booleanAttribute });
  /** Read out instead of the heading and meta. */
  readonly label = input<string>();
  /** The number pressed into a wax seal on the chat tab; none at 0. */
  readonly approval = input(0, { transform: numberAttribute });
  /** For a chat tab that opens something: whether it's open. */
  readonly expanded = input<boolean>();
  /** Shows the chat tab, but it does nothing yet. */
  readonly unavailable = input(false, { transform: booleanAttribute });

  readonly picked = output<void>();
  /** Middle-clicked, to close what it marks. */
  readonly dismissed = output<void>();
  /** Right-clicked, to open the settings of what it marks. */
  readonly settings = output<void>();

  protected readonly motes = computed(() => this.tone() === 'waiting');

  protected pick(): void {
    if (!this.unavailable()) this.picked.emit();
  }

  protected auxClick(event: MouseEvent): void {
    if (event.button === 1 && !this.unavailable()) this.dismissed.emit();
  }

  protected contextMenu(event: MouseEvent): void {
    event.preventDefault();
    if (!this.unavailable()) this.settings.emit();
  }
}
