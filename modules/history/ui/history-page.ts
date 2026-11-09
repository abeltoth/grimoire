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
import type { ChatId, ChatSummary, SearchHit } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';
import { Wording } from '@ui/app/core/wording';
import { Icon } from '@ui/design-system/icon';
import { dated, keptTags, numeral, partTitle, partsOf, tagsOf, withTags } from './chat-groups';

/** How long the look-up waits for you to stop writing before it searches. */
const LOOK_UP_DELAY_MS = 150;

/**
 * The History page: every chat you've had, in parts by the project it
 * ran in, each chat with its tags and the day it was last written in.
 * Looking up words narrows the list to the chats with them, each with the
 * passage that has them; tags narrow it too, and "+ Tag" on a chat adds
 * one. A chat's title, or Enter in the look-up, opens it on the left
 * page, and the history stays open beside it.
 */
@Component({
  selector: 'gr-history-page',
  imports: [Icon],
  templateUrl: './history-page.html',
  styleUrl: './history-page.css',
})
export class HistoryPage {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  protected readonly chats = inject(Chats);
  protected readonly wording = inject(Wording);
  private readonly pending = inject(PendingTasks);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  private readonly lookUpField = viewChild.required<ElementRef<HTMLInputElement>>('lookUpField');

  /** Every agent's chats; undefined until they've answered. */
  private readonly listed = signal<readonly ChatSummary[] | undefined>(undefined);
  /** The tags the list is narrowed to. */
  private readonly picked = signal<readonly string[]>([]);
  /** The chat a new tag is being written for. */
  protected readonly adding = signal<ChatId | null>(null);
  protected readonly failed = signal<string | null>(null);
  /** What's looked up. */
  protected readonly lookUp = signal('');
  /** The chats with what's looked up, by chat; null while nothing is. */
  protected readonly hits = signal<ReadonlyMap<ChatId, SearchHit> | null>(null);
  protected readonly searching = signal(false);
  protected readonly searchFailed = signal<string | null>(null);
  /** The search waiting for you to stop writing. */
  private waiting: { timer: ReturnType<typeof setTimeout>; done: () => void } | undefined;
  /** Counts the searches, so an answer to an older one is dropped. */
  private searches = 0;

  /** Every tag on a chat, for the list to be narrowed by. */
  protected readonly tags = computed(() => tagsOf(this.listed() ?? []));
  /** The picked tags that some chat still has. */
  protected readonly narrowedTo = computed(() => {
    const tags = new Set(this.tags().map((tag) => tag.toLowerCase()));
    return this.picked().filter((tag) => tags.has(tag.toLowerCase()));
  });
  protected readonly parts = computed(() => {
    const listed = this.listed();
    if (!listed) return undefined;
    const home = this.chats.folders().home;
    const hits = this.hits();
    const found = hits ? listed.filter((chat) => hits.has(chat.id)) : listed;
    return partsOf(withTags(found, this.narrowedTo()), home).map((part, i) => ({
      ...part,
      numeral: numeral(i + 1),
      title: partTitle(part.folder, home),
      folderName: this.chats.folderName(part.folder),
    }));
  });

  /** How many chats have what's looked up, while something is. */
  protected readonly count = computed(() => {
    if (!this.hits()) return this.searching() ? 'Looking…' : '';
    const count = this.parts()?.reduce((sum, part) => sum + part.chats.length, 0) ?? 0;
    const [one, many] = this.wording.plain() ? ['chat', 'chats'] : ['chapter', 'chapters'];
    return `${count} ${count === 1 ? one : many}`;
  });

  protected readonly dated = dated;

  constructor() {
    // List the chats once the agents are known.
    effect(() => {
      if (this.chats.agents().length) untracked(() => void this.load());
    });
    // Keep up with changes made on the chats themselves.
    const stops = [
      this.bridge.on('agents.tags', ({ chatId, tags }) => this.change(chatId, { tags })),
      this.bridge.on('agents.pins', ({ chatId, pins }) => this.change(chatId, { pins })),
      this.bridge.on('agents.title', ({ chatId, title }) => this.change(chatId, { title })),
    ];
    inject(DestroyRef).onDestroy(() => stops.forEach((stop) => stop()));
    afterRenderEffect(() => this.field()?.nativeElement.focus());
    afterNextRender(() => this.lookUpField().nativeElement.focus());
    inject(DestroyRef).onDestroy(() => this.stopWaiting());
  }

  /** The passage a chat has what's looked up in, unless that's its title. */
  protected hitOf(chat: ChatSummary): SearchHit | undefined {
    const hit = this.hits()?.get(chat.id);
    return hit?.kind === 'title' ? undefined : hit;
  }

  /** Who wrote a passage: you, or the agent. */
  protected byOf(hit: SearchHit): string {
    return hit.kind === 'you' ? 'You' : this.chats.agentName(hit.agent);
  }

  /** Looks up what's written, once you stop writing; nothing written lists every chat again. */
  protected look(query: string): void {
    this.lookUp.set(query);
    this.stopWaiting();
    this.searches++;
    if (!query.trim()) {
      this.hits.set(null);
      this.searching.set(false);
      this.searchFailed.set(null);
      return;
    }
    this.searching.set(true);
    const done = this.pending.add();
    const timer = setTimeout(() => {
      this.waiting = undefined;
      void this.search(query).finally(done);
    }, LOOK_UP_DELAY_MS);
    this.waiting = { timer, done };
  }

  /** Enter in the look-up opens the first chat listed. */
  protected openFirst(): void {
    const first = this.parts()?.[0]?.chats[0];
    if (first) this.open(first);
  }

  protected isPicked(tag: string): boolean {
    return this.narrowedTo().some((picked) => picked.toLowerCase() === tag.toLowerCase());
  }

  /** Narrows the list to chats with this tag too, or widens it again. */
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

  private async search(query: string): Promise<void> {
    const search = this.searches;
    try {
      const hits = (await this.bridge.invoke('search.chats', { query })) ?? [];
      if (search !== this.searches) return;
      this.hits.set(new Map(hits.map((hit) => [hit.chatId, hit])));
      this.searchFailed.set(null);
    } catch (error) {
      if (search !== this.searches) return;
      const reason = error instanceof Error ? error.message : String(error);
      this.searchFailed.set(
        this.wording.say(
          `The chapters couldn’t be looked through: ${reason}`,
          `The chats couldn’t be searched: ${reason}`,
        ),
      );
    } finally {
      if (search === this.searches) this.searching.set(false);
    }
  }

  private stopWaiting(): void {
    if (!this.waiting) return;
    clearTimeout(this.waiting.timer);
    this.waiting.done();
    this.waiting = undefined;
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
