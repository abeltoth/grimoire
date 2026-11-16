import {
  Component,
  type ElementRef,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Icon } from '@ui/design-system/icon';
import { PinsAndTags } from './pins-and-tags';

/** How many tags show at once, on the list and among those on chats; "Show more" adds as many again. */
export const TAGS_AT_ONCE = 60;

/**
 * Your tag list, on the Settings page: the tags you mean to use, A to Z.
 * It opens on demand, in columns, so many tags at a time, and one
 * field finds tags or adds one. Naming a tag anew renames it on every chat,
 * and naming it as another tag merges the two. Tags chats have that aren't
 * on the list can be added to it.
 */
@Component({
  selector: 'gr-tag-settings',
  imports: [Icon],
  templateUrl: './tag-settings.html',
  styleUrl: './tag-settings.css',
})
export class TagSettings {
  private readonly pinsAndTags = inject(PinsAndTags);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  protected readonly list = this.pinsAndTags.tagList;
  protected readonly open = signal(false);
  /** What the find field holds, trimmed. */
  protected readonly query = signal('');
  private readonly listLimit = signal(TAGS_AT_ONCE);
  private readonly othersLimit = signal(TAGS_AT_ONCE);

  /** The listed tags the find field matches. */
  private readonly found = computed(() =>
    matching(
      [...this.list()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
      this.query(),
    ),
  );
  /** Tags chats have that aren't on the list, as the find field matches them. */
  private readonly foundOthers = computed(() =>
    matching(this.pinsAndTags.known().slice(this.list().length), this.query()),
  );
  protected readonly shown = computed(() => this.found().slice(0, this.listLimit()));
  protected readonly more = computed(() => this.found().length - this.shown().length);
  protected readonly others = computed(() => this.foundOthers().slice(0, this.othersLimit()));
  protected readonly moreOthers = computed(() => this.foundOthers().length - this.others().length);
  /** Whether the find field holds a tag the list hasn't, so Enter adds it. */
  protected readonly addable = computed(() => {
    const wanted = this.query().toLowerCase();
    return !!wanted && !this.list().some((tag) => tag.toLowerCase() === wanted);
  });

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

  protected toggle(): void {
    this.open.update((open) => !open);
    this.find('');
  }

  protected find(query: string): void {
    this.query.set(query.trim());
    this.listLimit.set(TAGS_AT_ONCE);
    this.othersLimit.set(TAGS_AT_ONCE);
  }

  protected showMore(): void {
    this.listLimit.update((limit) => limit + TAGS_AT_ONCE);
  }

  protected showMoreOthers(): void {
    this.othersLimit.update((limit) => limit + TAGS_AT_ONCE);
  }

  /** Adds what the find field holds, unless the list has it already. */
  protected add(field: HTMLInputElement): void {
    if (!this.addable()) return;
    const tag = this.query();
    field.value = '';
    this.find('');
    void this.keep([...this.list(), tag]);
  }

  protected remove(tag: string): void {
    void this.keep(this.list().filter((kept) => kept !== tag));
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

/** The tags with these letters in them, whatever their case; every tag when there are none. */
function matching(tags: readonly string[], query: string): readonly string[] {
  const wanted = query.toLowerCase();
  return wanted ? tags.filter((tag) => tag.toLowerCase().includes(wanted)) : tags;
}
