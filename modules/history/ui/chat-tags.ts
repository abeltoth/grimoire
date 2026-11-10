import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  input,
  linkedSignal,
  viewChild,
} from '@angular/core';
import { Icon } from '@ui/design-system/icon';
import { type Chat } from '@ui/app/core/chat';
import { ChatList } from '@ui/app/core/chat-list';
import { PinsAndTags } from './pins-and-tags';

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
  private readonly list = inject(ChatList);
  private readonly pinsAndTags = inject(PinsAndTags);
  private readonly injector = inject(Injector);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  private readonly addButton = viewChild<ElementRef<HTMLButtonElement>>('addButton');

  readonly chat = input.required<Chat>();
  protected readonly tags = computed(() => this.pinsAndTags.tags(this.chat().id));

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
    if (keep) this.save([...this.tags(), field.value]);
    if (refocus) this.focusAdd();
  }

  protected remove(tag: string): void {
    this.save(this.tags().filter((kept) => kept !== tag));
    this.focusAdd();
  }

  private save(tags: readonly string[]): void {
    const { id } = this.chat();
    this.pinsAndTags.tag(id, tags).catch((error: unknown) => this.list.fail(id, error));
  }

  private focusAdd(): void {
    afterNextRender(() => this.addButton()?.nativeElement.focus(), { injector: this.injector });
  }
}
