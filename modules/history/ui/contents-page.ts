import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  PendingTasks,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { ChatId, ChatSummary } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';
import { Icon } from '@ui/design-system/icon';
import { dated, keptTags, numeral, partTitle, partsOf, tagsOf, withTags } from './contents';

/**
 * The Table of contents: every chat you've had, in parts by the project it
 * ran in, each chapter with its tags and the day it was last written in.
 * Tags narrow the list, and "+ Tag" on a chapter adds one. A chapter's
 * title opens it on the left page, and the contents stay open beside it.
 */
@Component({
  selector: 'gr-contents-page',
  imports: [Icon],
  templateUrl: './contents-page.html',
  styleUrl: './contents-page.css',
})
export class ContentsPage {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  protected readonly chats = inject(Chats);
  private readonly pending = inject(PendingTasks);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  /** Every agent's chats; undefined until they've answered. */
  private readonly listed = signal<readonly ChatSummary[] | undefined>(undefined);
  /** The tags the list is narrowed to. */
  private readonly picked = signal<readonly string[]>([]);
  /** The chapter a new tag is being written for. */
  protected readonly adding = signal<ChatId | null>(null);
  protected readonly failed = signal<string | null>(null);

  /** Every tag on a chapter, for the list to be narrowed by. */
  protected readonly tags = computed(() => tagsOf(this.listed() ?? []));
  /** The picked tags that some chapter still has. */
  protected readonly narrowedTo = computed(() => {
    const tags = new Set(this.tags().map((tag) => tag.toLowerCase()));
    return this.picked().filter((tag) => tags.has(tag.toLowerCase()));
  });
  protected readonly parts = computed(() => {
    const listed = this.listed();
    if (!listed) return undefined;
    const home = this.chats.folders().home;
    return partsOf(withTags(listed, this.narrowedTo()), home).map((part, i) => ({
      ...part,
      numeral: numeral(i + 1),
      title: partTitle(part.folder, home),
      folderName: this.chats.folderName(part.folder),
    }));
  });

  protected readonly dated = dated;

  constructor() {
    // List the chats once the agents are known.
    effect(() => {
      if (this.chats.agents().length) untracked(() => void this.load());
    });
    // Keep up with changes made on the chapters themselves.
    const stops = [
      this.bridge.on('agents.tags', ({ chatId, tags }) => this.change(chatId, { tags })),
      this.bridge.on('agents.dogEars', ({ chatId, dogEars }) => this.change(chatId, { dogEars })),
      this.bridge.on('agents.title', ({ chatId, title }) => this.change(chatId, { title })),
    ];
    inject(DestroyRef).onDestroy(() => stops.forEach((stop) => stop()));
    afterRenderEffect(() => this.field()?.nativeElement.focus());
  }

  protected isPicked(tag: string): boolean {
    return this.narrowedTo().some((picked) => picked.toLowerCase() === tag.toLowerCase());
  }

  /** Narrows the list to chapters with this tag too, or widens it again. */
  protected pick(tag: string): void {
    this.picked.set(
      this.isPicked(tag)
        ? this.narrowedTo().filter((picked) => picked.toLowerCase() !== tag.toLowerCase())
        : [...this.narrowedTo(), tag],
    );
  }

  protected showAll(): void {
    this.picked.set([]);
  }

  protected open(chat: ChatSummary): void {
    void this.chats.openChat(chat);
  }

  protected finish(
    chat: ChatSummary,
    field: HTMLInputElement,
    keep: boolean,
    refocus: boolean,
  ): void {
    if (this.adding() !== chat.id) return;
    this.adding.set(null);
    if (keep) void this.tag(chat, [...chat.tags, field.value]);
    if (refocus) this.focusAdd(chat.id);
  }

  protected untag(chat: ChatSummary, tag: string): void {
    void this.tag(
      chat,
      chat.tags.filter((kept) => kept !== tag),
    );
    this.focusAdd(chat.id);
  }

  private async load(): Promise<void> {
    const done = this.pending.add();
    try {
      // A service from before tags were listed sends none.
      const chats = await this.chats.pastChats();
      this.listed.set(chats.map((chat) => ({ ...chat, tags: chat.tags ?? [] })));
    } finally {
      done();
    }
  }

  private async tag(chat: ChatSummary, tags: readonly string[]): Promise<void> {
    const kept = keptTags(tags);
    if (kept.join('\n') === chat.tags.join('\n')) return;
    this.failed.set(null);
    this.change(chat.id, { tags: kept });
    try {
      await this.bridge.invoke('agents.tag', { chatId: chat.id, tags: kept });
    } catch (error) {
      this.change(chat.id, { tags: chat.tags });
      const reason = error instanceof Error ? error.message : String(error);
      this.failed.set(`The tags couldn’t be kept: ${reason}`);
    }
  }

  private change(chatId: ChatId, change: Partial<ChatSummary>): void {
    this.listed.update((listed) =>
      listed?.map((chat) => (chat.id === chatId ? { ...chat, ...change } : chat)),
    );
  }

  private focusAdd(chatId: ChatId): void {
    afterNextRender(
      () => this.host.querySelector<HTMLButtonElement>(`[data-chat="${chatId}"] .add`)?.focus(),
      { injector: this.injector },
    );
  }
}
