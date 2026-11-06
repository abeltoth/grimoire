import {
  Component,
  booleanAttribute,
  computed,
  input,
  numberAttribute,
  output,
} from '@angular/core';

/** The ribbon's colour: the chapter's status, or the seal and New chapter ribbons. */
export type RibbonTone = 'open' | 'thinking' | 'waiting' | 'idle' | 'seal' | 'new';

/**
 * A ribbon marker hanging from the book's foot. Its icon goes inside; its
 * heading and meta are read out, and shown on a slip when you point at it.
 */
@Component({
  selector: 'gr-ribbon',
  templateUrl: './ribbon.html',
  styleUrl: './ribbon.css',
  host: {
    '[attr.data-tone]': 'tone()',
    '[class.right]': "side() === 'right'",
    '[class.current]': 'current()',
    '[class.beside]': 'beside()',
    '[class.sheen]': "current() && tone() === 'open'",
  },
})
export class Ribbon {
  /** Which side of the spine the ribbon hangs on; its slip lies toward the spine. */
  readonly side = input.required<'left' | 'right'>();
  readonly tone = input.required<RibbonTone>();
  readonly heading = input.required<string>();
  readonly meta = input.required<string>();
  /** The chapter on the open spread. */
  readonly current = input(false, { transform: booleanAttribute });
  /** The chapter on the facing page, beside the open one. */
  readonly beside = input(false, { transform: booleanAttribute });
  /** Read out instead of the heading and meta. */
  readonly label = input<string>();
  /** The number pressed into a wax seal on the ribbon; none at 0. */
  readonly seal = input(0, { transform: numberAttribute });
  /** For a ribbon that opens something: whether it's open. */
  readonly expanded = input<boolean>();
  /** Shows the ribbon, but it does nothing yet. */
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
