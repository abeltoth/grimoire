import { Component, inject, input } from '@angular/core';
import type { FollowUp } from '@grimoire/contract';
import { Chats } from '@ui/app/core/chats';
import { Wording } from '@ui/app/core/wording';

/**
 * The separate tasks the agent offered after its last reply, as cards
 * under it: each its title and its prompt's first line. Clicking one
 * opens a new chapter with the task written in, not sent; that card goes,
 * and the others stay until a turn begins.
 */
@Component({
  selector: 'gr-follow-ups',
  templateUrl: './follow-ups.html',
  styleUrl: './follow-ups.css',
})
export class FollowUps {
  protected readonly chats = inject(Chats);
  protected readonly wording = inject(Wording);

  readonly chapterId = input.required<string>();
  readonly followUps = input.required<readonly FollowUp[]>();

  /** The prompt's first line that has words, which the card shows. */
  protected firstLine(prompt: string): string {
    return prompt.split('\n').find((line) => line.trim())?.trim() ?? '';
  }
}
