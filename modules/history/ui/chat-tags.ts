import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { type Chat } from '@ui/app/core/chat';
import { ChatList } from '@ui/app/core/chat-list';
import { Wording } from '@ui/app/core/wording';
import { Icon } from '@ui/design-system/icon';
import { PinsAndTags } from './pins-and-tags';
import { TagEditor } from './tag-editor';

/**
 * A chat's tags, as a small mark after its title with how many there are:
 * pointing at it names them, and a click opens a card that writes and takes
 * them off in place. Esc or a click elsewhere closes it.
 */
@Component({
  selector: 'gr-chat-tags',
  imports: [Icon, TagEditor],
  templateUrl: './chat-tags.html',
  styleUrl: './chat-tags.css',
  host: {
    '(document:pointerdown)': 'pointerDown($event)',
    '(keydown.escape)': 'escape($event)',
  },
})
export class ChatTags {
  private readonly list = inject(ChatList);
  private readonly pinsAndTags = inject(PinsAndTags);
  private readonly wording = inject(Wording);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly toggle = viewChild.required<ElementRef<HTMLButtonElement>>('toggle');
  private readonly card = viewChild<ElementRef<HTMLElement>>('card');

  readonly chat = input.required<Chat>();
  protected readonly tags = computed(() => this.pinsAndTags.tags(this.chat().id));
  protected readonly label = computed(() => {
    const tags = this.tags();
    return tags.length
      ? `Tags: ${tags.join(', ')}`
      : this.wording.say('Tag this chapter', 'Tag this chat');
  });

  /** Whether the card is open; never on a chat you've just turned to. */
  protected readonly open = linkedSignal({
    source: () => this.chat().id,
    computation: () => false,
  });
  /** How far left the card moves so it ends within the page header. */
  protected readonly shift = signal(0);

  constructor() {
    // Focus moves into the card as it opens, onto "+ Tag".
    afterRenderEffect(() => this.card()?.nativeElement.querySelector<HTMLElement>('.add')?.focus());
    afterRenderEffect(() => {
      this.tags();
      const card = this.card()?.nativeElement;
      if (!card) return;
      const end = (this.host.closest('gr-page-header') ?? document.body).getBoundingClientRect();
      const start = this.host.getBoundingClientRect().left;
      this.shift.set(Math.min(0, end.right - start - card.offsetWidth));
    });
  }

  protected save(tags: readonly string[]): void {
    const { id } = this.chat();
    this.pinsAndTags.tag(id, tags).catch((error: unknown) => this.list.fail(id, error));
  }

  protected pointerDown(event: PointerEvent): void {
    const target = event.target as Node | null;
    if (this.open() && target && !this.host.contains(target)) this.open.set(false);
  }

  /** Esc closes the card, and isn't also the chat page's Esc, which stops the chat. */
  protected escape(event: Event): void {
    // Esc in the field puts the new tag away; the card stays open.
    if (!this.open() || event.defaultPrevented) return;
    event.preventDefault();
    this.open.set(false);
    this.toggle().nativeElement.focus();
  }
}
