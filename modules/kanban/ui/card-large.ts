import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import type { Card } from '@grimoire/contract';
import { Board } from './board';

/**
 * A card opened large over the board, to read its title and notes whole;
 * a click beside it or Escape puts it away.
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

  /** The card as the board has it now, so a change made while it's open shows. */
  protected readonly card = computed(() => {
    const id = this.shown();
    return this.board.all()?.find((card) => card.id === id) ?? null;
  });

  open(card: Card): void {
    this.shown.set(card.id);
    this.dialog().nativeElement.showModal();
  }

  /** Only a click on the backdrop closes it, so its text can be selected. */
  protected closeBeside(event: MouseEvent): void {
    const dialog = this.dialog().nativeElement;
    if (event.target === dialog) dialog.close();
  }
}
