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
  untracked,
} from '@angular/core';
import type { Card } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';
import { Board } from './board';

const RECENT_FOLDERS = 3;

/**
 * A card written out to save, in its place on the board: its title, its
 * notes, and the folder its chats begin in, the chat you're on's for a
 * new one.
 */
@Component({
  selector: 'gr-card-form',
  templateUrl: './card-form.html',
  styleUrl: './card-form.css',
})
export class CardForm {
  /** The card changed; a new one when left out. */
  readonly card = input<Card>();
  /** Saved, or put away. */
  readonly done = output<void>();

  protected readonly chats = inject(Chats);
  private readonly board = inject(Board);
  private readonly bridge = inject(GRIMOIRE_BRIDGE);

  protected readonly title = linkedSignal(() => this.card()?.title ?? '');
  protected readonly notes = linkedSignal(() => this.card()?.notes ?? '');
  protected readonly cwd = linkedSignal<string>(
    () =>
      this.card()?.cwd ??
      untracked(() => this.chats.current()?.settings.cwd ?? this.chats.folders().home),
  );
  protected readonly saving = signal(false);

  protected readonly folders = computed(() => {
    const current = this.cwd();
    const others = this.chats.folders().recent.filter((cwd) => cwd !== current);
    return [...(current ? [current] : []), ...others].slice(0, RECENT_FOLDERS);
  });
  protected readonly complete = computed(() => !!this.title().trim() && !!this.cwd());

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => host.querySelector<HTMLInputElement>('.name')?.focus());
  }

  protected async chooseFolder(): Promise<void> {
    const cwd = await this.bridge.chooseFolder().catch(() => null);
    if (cwd) this.cwd.set(cwd);
  }

  protected async save(): Promise<void> {
    if (!this.complete() || this.saving()) return;
    this.saving.set(true);
    try {
      const saved = await this.board.save({
        ...(this.card() ? { id: this.card()!.id } : {}),
        title: this.title(),
        notes: this.notes(),
        cwd: this.cwd(),
      });
      if (saved) this.done.emit();
    } finally {
      this.saving.set(false);
    }
  }
}
