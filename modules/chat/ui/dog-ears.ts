import { Component, inject, input } from '@angular/core';
import type { DogEar } from '@grimoire/contract';
import { type Chapter, Chats } from '@ui/app/core/chats';
import { Wording } from '@ui/app/core/wording';

/**
 * The page's dog-ears: fold the top corner down to pin the chapter, the
 * bottom one to star it. A blank chapter has nothing to keep them on yet.
 */
@Component({
  selector: 'gr-dog-ears',
  template: `
    <button
      type="button"
      class="dog pin"
      [class.folded]="folded('pin')"
      [attr.aria-disabled]="blank() ? true : null"
      [attr.aria-label]="
        folded('pin')
          ? wording.say('Pinned. Unfold to unpin', 'Pinned. Unpin')
          : wording.say('Pin this chapter', 'Pin this chat')
      "
      (click)="toggle('pin')"
    ></button>
    <button
      type="button"
      class="dog star"
      [class.folded]="folded('star')"
      [attr.aria-disabled]="blank() ? true : null"
      [attr.aria-label]="
        folded('star')
          ? wording.say('Starred. Unfold to unstar', 'Starred. Unstar')
          : wording.say('Star this chapter', 'Star this chat')
      "
      (click)="toggle('star')"
    ></button>
  `,
  styleUrl: './dog-ears.css',
})
export class DogEars {
  private readonly chats = inject(Chats);
  protected readonly wording = inject(Wording);
  readonly chapter = input.required<Chapter>();

  protected blank(): boolean {
    return this.chapter().status === 'blank';
  }

  protected folded(dogEar: DogEar): boolean {
    return this.chapter().dogEars.includes(dogEar);
  }

  protected toggle(dogEar: DogEar): void {
    if (this.blank()) return;
    void this.chats.dogEar(this.chapter().id, dogEar, !this.folded(dogEar));
  }
}
