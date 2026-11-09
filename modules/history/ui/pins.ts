import { Component, inject, input } from '@angular/core';
import type { Mark } from '@grimoire/contract';
import { type Chat, Chats } from '@ui/app/core/chats';
import { Wording } from '@ui/app/core/wording';

/**
 * The page's pins: fold the top corner down to pin the chat, the
 * bottom one to star it. A blank chat has nothing to keep them on yet.
 */
@Component({
  selector: 'gr-pins',
  template: `
    <button
      type="button"
      class="dog pin"
      [class.folded]="has('pin')"
      [attr.aria-disabled]="blank() ? true : null"
      [attr.aria-label]="
        has('pin')
          ? wording.say('Pinned. Unfold to unpin', 'Pinned. Unpin')
          : wording.say('Pin this chapter', 'Pin this chat')
      "
      (click)="toggle('pin')"
    ></button>
    <button
      type="button"
      class="dog star"
      [class.folded]="has('star')"
      [attr.aria-disabled]="blank() ? true : null"
      [attr.aria-label]="
        has('star')
          ? wording.say('Starred. Unfold to unstar', 'Starred. Unstar')
          : wording.say('Star this chapter', 'Star this chat')
      "
      (click)="toggle('star')"
    ></button>
  `,
  styleUrl: './pins.css',
})
export class Pins {
  private readonly chats = inject(Chats);
  protected readonly wording = inject(Wording);
  readonly chat = input.required<Chat>();

  protected blank(): boolean {
    return this.chat().status === 'blank';
  }

  protected has(mark: Mark): boolean {
    return this.chat().pins.includes(mark);
  }

  protected toggle(mark: Mark): void {
    if (this.blank()) return;
    void this.chats.pin(this.chat().id, mark, !this.has(mark));
  }
}
