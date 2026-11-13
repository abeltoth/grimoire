import {
  Component,
  DestroyRef,
  ElementRef,
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
import { ChatList } from '@ui/app/core/chat-list';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { Settings } from '@ui/app/core/settings';
import { Wording } from '@ui/app/core/wording';
import {
  type ListedChat,
  dated,
  numeral,
  partTitle,
  partsOf,
  projectOf,
  tagsOf,
  withTags,
} from './chat-groups';
import { byDate } from './date-groups';
import { PinsAndTags } from './pins-and-tags';
import { TagEditor } from './tag-editor';
import { TagListPanel } from './tag-list-panel';

/** How long the search field waits for you to stop writing before it searches. */
const SEARCH_DELAY_MS = 150;

/** A heading's worth of the list: a project's part, or a stretch of days. */
interface Section {
  key: string;
  /** Above the title, in small capitals: "Part I"; none for a stretch of days. */
  over?: string;
  title: string;
  /** After the title: the project's folder. */
  folderName?: string;
  /** Each chat's project, when the section mixes them. */
  projects?: ReadonlyMap<ChatId, string>;
  chats: ListedChat[];
}

/**
 * The History page: every chat you've had, by when it was last written in
 * or in parts by the project it ran in, each chat with its tags and the
 * day it was last written in. The list keeps up as chats are written in.
 * Searching for words narrows the list to the chats with them, each with the
 * passage that has them; tags narrow it too, and "+ Tag" on a chat adds
 * one. A chat's title, or Enter in the search field, opens it on the left
 * page, and the history stays open beside it.
 */
@Component({
  selector: 'gr-history-page',
  imports: [TagEditor, TagListPanel],
  templateUrl: './history-page.html',
  styleUrl: './history-page.css',
})
export class HistoryPage {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  protected readonly list = inject(ChatList);
  protected readonly catalog = inject(AgentCatalog);
  private readonly pinsAndTags = inject(PinsAndTags);
  private readonly settings = inject(Settings);
  protected readonly wording = inject(Wording);
  private readonly pending = inject(PendingTasks);
  private readonly searchField = viewChild.required<ElementRef<HTMLInputElement>>('searchField');

  /** Every agent's chats; undefined until they've answered. */
  private readonly saved = signal<readonly ChatSummary[] | undefined>(undefined);
  /** Those chats with their pins and tags. */
  protected readonly listed = computed(() =>
    this.saved()?.map((chat): ListedChat => ({
      ...chat,
      pins: this.pinsAndTags.pins(chat.id),
      tags: this.pinsAndTags.tags(chat.id),
      summary: this.pinsAndTags.summary(chat.id),
    })),
  );
  /** The tags the list is narrowed to. */
  private readonly picked = signal<readonly string[]>([]);
  protected readonly failed = signal<string | null>(null);
  /** The chat whose summary is being written anew. */
  protected readonly editingSummary = signal<ChatId | null>(null);
  private readonly summaryField = viewChild<ElementRef<HTMLInputElement>>('summaryField');
  /** Whether your tag list shows, to change it. */
  protected readonly showTagList = signal(false);
  /** What's searched for. */
  protected readonly query = signal('');
  /** The chats with what's searched for, by chat; null while nothing is. */
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
  /** How the list is grouped: by date or by project. */
  protected readonly group = computed(() => this.settings.all().historyGroup);
  protected readonly sections = computed((): Section[] | undefined => {
    const listed = this.listed();
    if (!listed) return undefined;
    const home = this.catalog.folders().home;
    const hits = this.hits();
    const found = withTags(
      hits ? listed.filter((chat) => hits.has(chat.id)) : listed,
      this.narrowedTo(),
    );
    if (this.group() === 'project') {
      return partsOf(found, home).map((part, i) => ({
        key: part.folder,
        over: `Part ${numeral(i + 1)}`,
        title: partTitle(part.folder, home),
        folderName: this.catalog.folderName(part.folder),
        chats: part.chats,
      }));
    }
    const projects = new Map(
      found.map((chat) => [chat.id, partTitle(projectOf(chat.cwd ?? home), home)]),
    );
    return byDate(found, this.now()).map((group) => ({ ...group, projects }));
  });

  /** How many chats have what's searched for, while something is. */
  protected readonly count = computed(() => {
    if (!this.hits()) return this.searching() ? 'Looking…' : '';
    const count = this.sections()?.reduce((sum, part) => sum + part.chats.length, 0) ?? 0;
    const [one, many] = this.wording.plain() ? ['chat', 'chats'] : ['chapter', 'chapters'];
    return `${count} ${count === 1 ? one : many}`;
  });

  protected readonly dated = dated;
  /** When the list was last read, which the stretches of days count back from. */
  private readonly now = signal(Date.now());
  /** Counts the reads of the list, so an answer to an older one is dropped. */
  private loads = 0;

  constructor() {
    // List the chats once the agents are known.
    effect(() => {
      if (this.catalog.agents().length) untracked(() => void this.load());
    });
    // Keep up with chats renamed on their own pages.
    const stop = this.bridge.on('agents.title', ({ chatId, title }) => this.retitle(chatId, title));
    inject(DestroyRef).onDestroy(stop);
    // A turn that ended moved its chat to the top, or listed it for the first time.
    const stopTurns = this.bridge.on('agents.turnEnded', () => void this.load());
    inject(DestroyRef).onDestroy(stopTurns);
    afterNextRender(() => this.searchField().nativeElement.focus());
    afterRenderEffect(() => this.summaryField()?.nativeElement.focus());
    inject(DestroyRef).onDestroy(() => this.stopWaiting());
  }

  /** The passage a chat has what's searched for in, unless that's its title. */
  protected hitOf(chat: ListedChat): SearchHit | undefined {
    const hit = this.hits()?.get(chat.id);
    return hit?.kind === 'title' ? undefined : hit;
  }

  /** Who wrote a passage: you, or the agent. */
  protected byOf(hit: SearchHit): string {
    return hit.kind === 'you' ? 'You' : this.catalog.agentName(hit.agent);
  }

  /** Searches for what's written, once you stop writing; nothing written lists every chat again. */
  protected setQuery(query: string): void {
    this.query.set(query);
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
    }, SEARCH_DELAY_MS);
    this.waiting = { timer, done };
  }

  /** Enter in the search field opens the first chat listed. */
  protected openFirst(): void {
    const first = this.sections()?.[0]?.chats[0];
    if (first) this.open(first);
  }

  protected groupBy(group: 'date' | 'project'): void {
    if (group !== this.group()) void this.settings.set({ historyGroup: group });
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

  protected open(chat: ListedChat): void {
    void this.list.openChat(chat);
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
    const load = ++this.loads;
    const done = this.pending.add();
    try {
      const chats = await this.catalog.pastChats();
      if (load !== this.loads) return;
      this.now.set(Date.now());
      this.saved.set(chats);
    } finally {
      done();
    }
  }

  /** Keeps the summary written, unless Esc was pressed; a blank one takes it away. */
  protected finishSummary(chat: ListedChat, field: HTMLInputElement, keep: boolean): void {
    if (this.editingSummary() !== chat.id) return;
    this.editingSummary.set(null);
    const summary = field.value.trim();
    if (!keep || summary === (chat.summary ?? '')) return;
    this.failed.set(null);
    this.pinsAndTags.setSummary(chat.id, summary).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      this.failed.set(`The summary couldn’t be kept: ${reason}`);
    });
  }

  protected async tag(chat: ListedChat, tags: readonly string[]): Promise<void> {
    this.failed.set(null);
    try {
      await this.pinsAndTags.tag(chat.id, tags);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.failed.set(`The tags couldn’t be kept: ${reason}`);
    }
  }

  private retitle(chatId: ChatId, title: string): void {
    this.saved.update((saved) =>
      saved?.map((chat) => (chat.id === chatId ? { ...chat, title } : chat)),
    );
  }
}
