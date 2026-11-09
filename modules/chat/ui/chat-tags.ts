import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  inject,
  input,
  linkedSignal,
  viewChild,
} from '@angular/core';
import { Icon } from '@ui/design-system/icon';
import { type Chat, Chats } from '@ui/app/core/chats';

/**
 * A chat's tags, as plain-text labels after its title. "+ Tag" writes a
 * new one in place: Enter or leaving the field keeps it, Esc doesn't. Each
 * label's cross takes it off.
 */
@Component({
  selector: 'gr-chat-tags',
  imports: [Icon],
  templateUrl: './chat-tags.html',
  styleUrl: './chat-tags.css',
  host: { role: 'group', 'aria-label': 'Tags' },
})
export class ChatTags {
  private readonly chats = inject(Chats);
  private readonly injector = inject(Injector);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  private readonly addButton = viewChild<ElementRef<HTMLButtonElement>>('addButton');

  readonly chat = input.required<Chat>();

  /** Whether a new tag is being written; never on a chat you've just turned to. */
  protected readonly adding = linkedSignal({
    source: () => this.chat().id,
    computation: () => false,
  });

  constructor() {
    afterRenderEffect(() => this.field()?.nativeElement.focus());
  }

  protected finish(field: HTMLInputElement, keep: boolean, refocus: boolean): void {
    if (!this.adding()) return;
    this.adding.set(false);
    const { id, tags } = this.chat();
    if (keep) void this.chats.tag(id, [...tags, field.value]);
    if (refocus) this.focusAdd();
  }

  protected remove(tag: string): void {
    const { id, tags } = this.chat();
    void this.chats.tag(
      id,
      tags.filter((kept) => kept !== tag),
    );
    this.focusAdd();
  }

  private focusAdd(): void {
    afterNextRender(() => this.addButton()?.nativeElement.focus(), { injector: this.injector });
  }
}
