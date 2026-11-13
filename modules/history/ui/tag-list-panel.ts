import {
  Component,
  type ElementRef,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { PinsAndTags } from './pins-and-tags';

/**
 * Your tag list, kept beside the History: the tags you mean to use, in
 * your order. Naming a tag anew renames it on every chat, and naming it as
 * another tag merges the two. Tags chats have that aren't on the list can
 * be added to it.
 */
@Component({
  selector: 'gr-tag-list-panel',
  templateUrl: './tag-list-panel.html',
  styleUrl: './tag-list-panel.css',
  host: { role: 'region', 'aria-label': 'Tag list' },
})
export class TagListPanel {
  private readonly pinsAndTags = inject(PinsAndTags);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  protected readonly list = this.pinsAndTags.tagList;
  /** Tags chats have that aren't on the list. */
  protected readonly others = computed(() => this.pinsAndTags.known().slice(this.list().length));
  /** The tag being named anew. */
  protected readonly renaming = signal<string | null>(null);
  protected readonly failed = signal<string | null>(null);

  constructor() {
    afterRenderEffect(() => {
      const field = this.field()?.nativeElement;
      field?.focus();
      field?.select();
    });
  }

  protected add(field: HTMLInputElement): void {
    const tag = field.value.trim();
    field.value = '';
    if (tag) void this.keep([...this.list(), tag]);
  }

  protected remove(tag: string): void {
    void this.keep(this.list().filter((kept) => kept !== tag));
  }

  /** Moves a tag one place up the list. */
  protected up(index: number): void {
    const list = [...this.list()];
    [list[index - 1], list[index]] = [list[index]!, list[index - 1]!];
    void this.keep(list);
  }

  protected finishRename(tag: string, field: HTMLInputElement, keep: boolean): void {
    if (this.renaming() !== tag) return;
    this.renaming.set(null);
    const to = field.value.trim();
    if (keep && to && to !== tag) void this.run(() => this.pinsAndTags.rename(tag, to));
  }

  protected keep(list: readonly string[]): Promise<void> {
    return this.run(() => this.pinsAndTags.setList(list));
  }

  private async run(change: () => Promise<void>): Promise<void> {
    this.failed.set(null);
    try {
      await change();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.failed.set(`The tag list couldn’t be kept: ${reason}`);
    }
  }
}
