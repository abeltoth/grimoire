import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  booleanAttribute,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  viewChild,
} from '@angular/core';
import { Icon } from '@ui/design-system/icon';
import { PinsAndTags } from './pins-and-tags';

/** Numbers the editors, so each one's list of suggestions has its own ID. */
let editors = 0;

/**
 * A chat's tags, as plain-text labels. "+ Tag" writes a new one in place,
 * suggesting your tag list and the tags other chats have: Enter or leaving
 * the field keeps it, Esc doesn't. Each label's cross takes it off.
 */
@Component({
  selector: 'gr-tag-editor',
  imports: [Icon],
  templateUrl: './tag-editor.html',
  styleUrl: './tag-editor.css',
  host: { role: 'group', 'aria-label': 'Tags', '[class.quiet]': 'quiet()' },
})
export class TagEditor {
  private readonly pinsAndTags = inject(PinsAndTags);
  private readonly injector = inject(Injector);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  private readonly addButton = viewChild<ElementRef<HTMLButtonElement>>('addButton');

  /** Whose tags these are; writing a new one stops when it changes. */
  readonly owner = input.required<string>();
  readonly tags = input.required<readonly string[]>();
  /** "+ Tag" shows only on the row you point at or reach, written over what follows. */
  readonly quiet = input(false, { transform: booleanAttribute });
  /** The tags as you changed them, before they're kept. */
  readonly changed = output<string[]>();

  protected readonly listId = `gr-tag-suggestions-${++editors}`;
  /** The tags to suggest: every one there is, but those on this chat. */
  protected readonly suggestions = computed(() => {
    const has = new Set(this.tags().map((tag) => tag.toLowerCase()));
    return this.pinsAndTags.known().filter((tag) => !has.has(tag.toLowerCase()));
  });

  /** Whether a new tag is being written; never on a chat you've just turned to. */
  protected readonly adding = linkedSignal({
    source: () => this.owner(),
    computation: () => false,
  });

  constructor() {
    afterRenderEffect(() => this.field()?.nativeElement.focus());
  }

  protected finish(field: HTMLInputElement, keep: boolean, refocus: boolean): void {
    if (!this.adding()) return;
    this.adding.set(false);
    if (keep && field.value.trim()) this.changed.emit([...this.tags(), field.value]);
    if (refocus) this.focusAdd();
  }

  protected remove(tag: string): void {
    this.changed.emit(this.tags().filter((kept) => kept !== tag));
    this.focusAdd();
  }

  private focusAdd(): void {
    afterNextRender(() => this.addButton()?.nativeElement.focus(), { injector: this.injector });
  }
}
