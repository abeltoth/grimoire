import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import type { Card, CardChat, CardColumn } from '@grimoire/contract';
import { type Chapter, Chats } from '@ui/app/core/chats';
import { Wording } from '@ui/app/core/wording';
import { Icon, type IconName } from '@ui/design-system/icon';
import { Board, COLUMNS } from './board';
import { CardForm } from './card-form';

/** A chat's live status as a card shows it, with the ribbons' icon and motion; "not open" when it's closed. */
const STATUS: Record<Chapter['status'], { text: string; icon?: IconName; motion?: string }> = {
  writing: { text: 'writing', icon: 'quill', motion: 'quill' },
  thinking: { text: 'thinking', icon: 'circle', motion: 'spin' },
  waiting: { text: 'waiting for you', icon: 'bell', motion: 'breathe' },
  idle: { text: 'idle', icon: 'moon' },
  blank: { text: 'blank page', icon: 'page' },
};

/** A chat begun from a card, as its card lists it. */
interface ListedChat {
  chat: CardChat;
  title: string;
  /** The live status, shown for the card's latest chat only. */
  status?: { text: string; icon?: IconName; motion?: string; tone: string };
}

/**
 * The Kanban board: your tasks as index cards in To do, In progress and
 * Done, each column in your order. Cards are dragged between and within
 * columns, or moved with a card's Move to. A card begins a new chat in its
 * folder, lists the chats it began with the latest one's live status, and
 * stays until you close it; closed cards are kept, to open again. An empty
 * card at the foot of To do writes a new one. The board can show one
 * folder's cards only.
 */
@Component({
  selector: 'gr-kanban-page',
  imports: [CardForm, Icon],
  templateUrl: './kanban-page.html',
  styleUrl: './kanban-page.css',
})
export class KanbanPage {
  protected readonly board = inject(Board);
  protected readonly chats = inject(Chats);
  protected readonly wording = inject(Wording);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  protected readonly columns = COLUMNS;

  /** The card written out to change, or 'new' for one being added. */
  protected readonly editing = signal<string | null>(null);
  /** The card whose Move to is open. */
  protected readonly moving = signal<string | null>(null);
  /** The card being dragged, and the column it's over. */
  protected readonly dragging = signal<string | null>(null);
  protected readonly over = signal<CardColumn | null>(null);
  /** The folder whose cards show; all when null. */
  private readonly picked = signal<string | null>(null);
  protected readonly showClosed = signal(false);
  /** The titles of chats that aren't open in the book: as the agents list them, or as they were while open. */
  private readonly titles = signal<ReadonlyMap<string, string>>(new Map());

  /** The folders the cards on the board are in, in the order they first appear. */
  protected readonly folders = computed(() => [...new Set(this.board.open().map((card) => card.cwd))]);
  /** The folder whose cards show, while it has any. */
  protected readonly folder = computed(() => {
    const picked = this.picked();
    return picked && this.folders().includes(picked) ? picked : null;
  });
  private readonly shown = computed(() => {
    const folder = this.folder();
    return (this.board.all() ?? []).filter((card) => !folder || card.cwd === folder);
  });
  protected readonly byColumn = computed(() => {
    const open = this.shown().filter((card) => card.closedAt === undefined);
    return Object.fromEntries(
      COLUMNS.map(({ column }) => [column, open.filter((card) => card.column === column)]),
    ) as Record<CardColumn, Card[]>;
  });
  /** The closed cards, the last closed first. */
  protected readonly closed = computed(() =>
    this.shown()
      .filter((card) => card.closedAt !== undefined)
      .sort((a, b) => b.closedAt! - a.closedAt!),
  );

  constructor() {
    void this.board.load();
    void this.loadTitles();
    // A chat closed while the board shows keeps the title it had.
    effect(() => {
      const named = this.chats.all().filter((chapter) => chapter.title && chapter.status !== 'blank');
      if (!named.length) return;
      untracked(() =>
        this.titles.update((titles) => new Map([...titles, ...named.map((c) => [c.id, c.title] as const)])),
      );
    });
  }

  protected pick(folder: string | null): void {
    this.picked.set(folder);
  }

  protected columnName(column: CardColumn): string {
    return COLUMNS.find((c) => c.column === column)!.label;
  }

  /** The card's chats, oldest first, the latest with its live status. */
  protected chatsOf(card: Card): ListedChat[] {
    const open = this.chats.all();
    return card.chats.map((chat, i) => {
      const chapter = open.find((c) => c.id === chat.chatId);
      const title = chapter?.title || this.titles().get(chat.chatId) || this.wording.untitled();
      if (i !== card.chats.length - 1) return { chat, title };
      const status = chapter ? STATUS[chapter.status] : { text: 'not open' };
      const text = chapter?.status === 'blank' ? this.wording.say('blank page', 'new chat') : status.text;
      return { chat, title, status: { ...status, text, tone: chapter?.status ?? 'closed' } };
    });
  }

  /** "In progress · ~/git/grimoire", for a closed card. */
  protected closedLine(card: Card): string {
    return `${this.columnName(card.column)} · ${this.chats.folderName(card.cwd)}`;
  }

  /** Where Move to can take a card: the other columns, and up or down its own. */
  protected movesOf(card: Card): { label: string; column: CardColumn; before?: string }[] {
    const column = this.byColumn()[card.column];
    const at = column.findIndex((c) => c.id === card.id);
    const moves: { label: string; column: CardColumn; before?: string }[] = COLUMNS.filter(
      (c) => c.column !== card.column,
    ).map((c) => ({ label: c.label, column: c.column }));
    if (at > 0) moves.push({ label: 'Up', column: card.column, before: column[at - 1]!.id });
    if (at !== -1 && at < column.length - 1) {
      moves.push({ label: 'Down', column: card.column, before: column[at + 2]?.id });
    }
    return moves;
  }

  protected openMoves(card: Card): void {
    this.moving.set(card.id);
    this.focusIn(card.id, '.moves button');
  }

  protected async move(card: Card, to: { column: CardColumn; before?: string }): Promise<void> {
    this.moving.set(null);
    await this.board.move(card.id, to.column, to.before);
    this.focusIn(card.id, '.move');
  }

  protected closeMoves(card: Card): void {
    this.moving.set(null);
    this.focusIn(card.id, '.move');
  }

  protected dragStart(event: DragEvent, card: Card): void {
    if (this.editing() === card.id) return event.preventDefault();
    this.dragging.set(card.id);
    this.moving.set(null);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.title);
    }
  }

  protected dragOver(event: DragEvent, column: CardColumn): void {
    if (!this.dragging()) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.over.set(column);
  }

  protected dragLeave(event: DragEvent, column: CardColumn): void {
    const into = event.relatedTarget as Node | null;
    if (!into || !(event.currentTarget as HTMLElement).contains(into)) {
      if (this.over() === column) this.over.set(null);
    }
  }

  /** Drops the card dragged before the card it's over, or after it from its lower half, or at the column's foot. */
  protected drop(event: DragEvent, column: CardColumn): void {
    const id = this.dragging();
    this.dragEnd();
    if (!id) return;
    event.preventDefault();
    const target = (event.target as Element).closest<HTMLElement>('[data-card]');
    const cards = this.byColumn()[column];
    let before: string | undefined;
    if (target) {
      const at = cards.findIndex((card) => card.id === target.dataset['card']);
      const { top, height } = target.getBoundingClientRect();
      const below = height > 0 && event.clientY > top + height / 2;
      before = cards[below ? at + 1 : at]?.id;
    }
    if (before === id) return;
    void this.board.move(id, column, before);
  }

  protected dragEnd(): void {
    this.dragging.set(null);
    this.over.set(null);
  }

  /** Focuses a control on a card once the board has drawn it, such as its Move to after a move. */
  private focusIn(id: string, selector: string): void {
    afterNextRender(
      () => this.host.querySelector<HTMLElement>(`[data-card="${id}"] ${selector}`)?.focus(),
      { injector: this.injector },
    );
  }

  private async loadTitles(): Promise<void> {
    const past = await this.chats.pastChats().catch(() => []);
    this.titles.update((titles) => new Map([...past.map((chat) => [chat.id, chat.title] as const), ...titles]));
  }
}
