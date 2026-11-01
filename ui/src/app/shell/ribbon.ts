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
 * A ribbon marker: it drops out of the book's foot, creases and lies flat
 * on the desk, pointing away from the spine. Its icon goes inside.
 */
@Component({
  selector: 'gr-ribbon',
  templateUrl: './ribbon.html',
  styleUrl: './ribbon.css',
  host: {
    '[attr.data-tone]': 'tone()',
    '[class.right]': "side() === 'right'",
    '[class.current]': 'current()',
    '[class.sheen]': "current() && tone() === 'open'",
  },
})
export class Ribbon {
  /** Which half of the desk the ribbon lies on; it points away from the spine. */
  readonly side = input.required<'left' | 'right'>();
  readonly tone = input.required<RibbonTone>();
  readonly heading = input.required<string>();
  readonly meta = input.required<string>();
  /** The chapter on the open spread. */
  readonly current = input(false, { transform: booleanAttribute });
  /** Read out instead of the heading and meta. */
  readonly label = input<string>();
  /** The number pressed into a wax seal on the ribbon; none at 0. */
  readonly seal = input(0, { transform: numberAttribute });
  /** Shows the ribbon, but it does nothing yet. */
  readonly unavailable = input(false, { transform: booleanAttribute });

  readonly picked = output<void>();

  protected readonly motes = computed(() => this.tone() === 'waiting');

  protected pick(): void {
    if (!this.unavailable()) this.picked.emit();
  }
}
