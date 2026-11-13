import { Component, computed, inject, input } from '@angular/core';
import { type Chat } from '@ui/app/core/chat';
import { ChatList } from '@ui/app/core/chat-list';
import { PinsAndTags } from './pins-and-tags';
import { TagEditor } from './tag-editor';

/** A chat's tags, as plain-text labels after its title, written and taken off in place. */
@Component({
  selector: 'gr-chat-tags',
  imports: [TagEditor],
  template: `<gr-tag-editor [owner]="chat().id" [tags]="tags()" (changed)="save($event)" />`,
  styleUrl: './chat-tags.css',
})
export class ChatTags {
  private readonly list = inject(ChatList);
  private readonly pinsAndTags = inject(PinsAndTags);

  readonly chat = input.required<Chat>();
  protected readonly tags = computed(() => this.pinsAndTags.tags(this.chat().id));

  protected save(tags: readonly string[]): void {
    const { id } = this.chat();
    this.pinsAndTags.tag(id, tags).catch((error: unknown) => this.list.fail(id, error));
  }
}
