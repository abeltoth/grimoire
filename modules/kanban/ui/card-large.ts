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
import type { Card } from '@grimoire/contract';
import { Board } from './board';

/**
 * A card opened large over the board, with what the board puts in it: the
 * card written out to change, and its buttons. A click beside it or
 * Escape puts it away, and so does the card being closed.
 */
@Component({
  selector: 'gr-card-large',
  templateUrl: './card-large.html',
  styleUrl: './card-large.css',
})
export class CardLarge {
  private readonly board = inject(Board);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly shown = signal<string | null>(null);

  /** The open card as the board has it now, so a change made while it's large shows. */
  readonly card = computed(() => {
    const id = this.shown();
    const card = this.board.all()?.find((c) => c.id === id);
    return card && card.closedAt === undefined ? card : null;
  });

  constructor() {
    effect(() => {
      if (this.shown() && !this.card()) untracked(() => this.close());
    });
  }

  open(card: Card): void {
    this.shown.set(card.id);
    this.dialog().nativeElement.showModal();
  }

  close(): void {
    const dialog = this.dialog().nativeElement;
    if (dialog.hasAttribute('open')) dialog.close();
  }

  /** Only a click on the backdrop closes it, so a click in the card doesn't. */
  protected closeBeside(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.close();
  }
}
